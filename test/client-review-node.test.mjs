import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { parseBridgeCard } from '../src/client-contract.ts';

const require=createRequire(new URL('../package.json',import.meta.url));
const packageRoot=resolve(new URL('..',import.meta.url).pathname);
const sdkRoot=process.env.BRIDGE_REVIEW_SDK_ROOT??packageRoot;
const preview={kind:'success',text:'─── Handoff · standard → ptc (review numbers and paths) ───\n## Goal\nRed 2 + blue 3 = 5.\n───────────────────────────────────────────\nSource 90 chars · user messages 1/1 · worker synthetic · 1s\nPreview ID: preview-12345678\n\nReview and run: /bridge ptc --go'};
const meta={bridge:{version:1,outcome:preview}};
const item=(seq,type,data)=>({type:'event',event:{seq,type,time:1000+seq,data,...(type==='tool/result'?{surfaceOp:'append'}:{})}});
const native=(name='bridge_prepare',payload=meta,isError=false)=>[
  item(0,'turn/start',{turn:1}),item(1,'step/start',{turn:1,step:1}),
  item(2,'tool/call',{turn:1,step:1,callId:'native-call',name,arguments:'{}'}),
  item(3,'tool/result',{turn:1,step:1,message:{id:'result-message',role:'tool',source:{kind:'tool',callId:'native-call'},toolCallId:'native-call',isError,content:[]},...(payload===undefined?{}:{meta:payload})}),
  item(4,'step/end',{turn:1,step:1}),item(5,'turn/end',{turn:1,reason:{kind:'completed'}}),
];
function store(initial){let value=initial;const listeners=new Set();return {getSnapshot:()=>value,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},set:next=>{value=next;for(const listener of listeners)listener();}};}
async function setup(){
  const path=new URL('../src/client-review-node.ts',import.meta.url);
  assert.ok(existsSync(path),'Bridge needs its own public turn-level review projection, not a hidden Tool card');
  const {createBridgeReviewDefinition}=await import(path.href);
  assert.equal(typeof createBridgeReviewDefinition,'function');
  const factories=new Map();
  const sandbox={AbortController,queueMicrotask,console,setTimeout,clearTimeout,window:{__ModuleLoader__:{load:({id,factory})=>factories.set(id,factory)}}};
  for(const name of ['dsh-client-ui-conversation','dsh-client-ui-chat']){
    vm.runInNewContext(await readFile(resolve(sdkRoot,'node_modules/@deepseek-ai',name,'lib/client.js'),'utf8'),sandbox);
  }
  const load=id=>{
    if(id==='@deepseek-ai/dsh-client-store')return {createSnapshotStore:store,notifySubscribers:listeners=>{for(const listener of listeners)listener();},defineStore:()=>()=>({})};
    if(id==='@deepseek-ai/dsh-client-ui-primitives')return new Proxy({},{get:()=>()=>null});
    if(id==='@deepseek-ai/dsh-client-ui-slots'||id==='react-dom'||id==='@tanstack/react-virtual')return {};
    return require(id);
  };
  const conversation=factories.get('@deepseek-ai/dsh-client-ui-conversation')(load);
  const chat=factories.get('@deepseek-ai/dsh-client-ui-chat')(load);
  const {Context}=require('@deepseek-ai/cordis');const ctx=new Context();
  const ui=new conversation.UiConversation(ctx,{});
  const halt=new Error('Only public Chat business registrations are needed; no DOM mount.');
  ctx.provide('uiSession',{provide(){throw halt;}});
  assert.throws(()=>chat.apply(ctx),error=>error===halt);
  const off=ui.events.register(createBridgeReviewDefinition());
  const engine=new conversation.ConversationNodeAssembler(ui.events,ui.views,ui.groups);
  engine.activateTarget('chat');
  return {engine,ui,off,ctx,definition:createBridgeReviewDefinition(),close:()=>ctx.fiber.dispose()};
}
function mirrors(engine){const snapshot=engine.get('chat');return snapshot.order.map(key=>snapshot.nodes.get(key)).filter(node=>node.kind==='dsh-bridge-review');}

test('official assembler places the same pending preview outside process groups without replacing the Tool node',async()=>{
  const s=await setup();try{
    s.engine.replaceWindow(native(),false);s.engine.flush();
    const nodes=mirrors(s.engine);assert.equal(nodes.length,1);assert.equal(nodes[0].groupTree,'turn');
    assert.equal(parseBridgeCard(nodes[0].data.outcome).previewId,'preview-12345678');
    const grouped=s.engine.grouped('chat');assert.ok(grouped.entries.some(entry=>entry.kind==='node'&&entry.key===nodes[0].key),
      'the review must be a root node, not a member behind the completed/process disclosure');
    const snapshot=s.engine.get('chat');const tool=snapshot.order.map(key=>snapshot.nodes.get(key)).find(node=>node.kind==='tool-call');
    assert.ok(tool);assert.equal(tool.data.root.kind,'tool-result','the original Tool must settle, not remain a running ghost');
    assert.equal(tool.data.root.callId,'native-call');assert.equal(tool.data.root.isError,false);
    assert.equal(s.ui.groups.entries().length,1,'Bridge must not replace the official global grouping rule');
    assert.ok(!s.definition.match(native()[2].event)?.exclusive);
  }finally{await s.close();}
});

test('native review needs the real same-call bridge_prepare head and trusted result metadata',async()=>{
  const s=await setup();try{
    for(const events of [native('another_tool'),native('bridge_prepare',{}),native('bridge_prepare',meta,true),native('bridge_prepare',{bridge:{version:2,outcome:preview}})]){
      s.engine.replaceWindow(events,false);s.engine.flush();assert.equal(mirrors(s.engine).length,0);
    }
    const mismatch=native();mismatch[3].event.data.message.toolCallId='different-call';
    s.engine.replaceWindow(mismatch,false);s.engine.flush();assert.equal(mirrors(s.engine).length,0);
  }finally{await s.close();}
});

test('missing headers fail closed until prepend restores the exact native call; registry unload removes only the mirror',async()=>{
  const s=await setup();try{
    const events=native();s.engine.replaceWindow(events.slice(3),true);s.engine.flush();assert.equal(mirrors(s.engine).length,0);
    s.engine.prepend(events.slice(0,3),false);s.engine.flush();assert.equal(mirrors(s.engine).length,1);
    s.engine.rebuildRegistry();s.engine.flush();assert.equal(mirrors(s.engine).length,1,'rebuild must not duplicate one preview');
    s.off();s.engine.rebuildRegistry();s.engine.flush();assert.equal(mirrors(s.engine).length,0);
    const snapshot=s.engine.get('chat');assert.ok(snapshot.order.some(key=>snapshot.nodes.get(key).kind==='tool-call'));
  }finally{await s.close();}
});

test('PTC nested dispatch has its own sub-call identity and never treats parent run_code as a Bridge review',async()=>{
  const s=await setup();try{
    const events=[item(0,'turn/start',{turn:1}),item(1,'step/start',{turn:1,step:1}),
      item(2,'tool/call',{turn:1,step:1,callId:'program',name:'run_code',arguments:'{}'}),
      item(3,'tool/ptc-dispatch-start',{rootCallId:'program',parentCallId:'program',subCallId:'program:ptc:1',name:'bridge_prepare',arguments:{}}),
      item(4,'tool/ptc-dispatch',{rootCallId:'program',parentCallId:'program',subCallId:'program:ptc:1',name:'bridge_prepare',arguments:{},isError:false,content:[],meta}),
      item(5,'step/end',{turn:1,step:1}),item(6,'turn/end',{turn:1,reason:{kind:'completed'}})];
    s.engine.replaceWindow(events,false);s.engine.flush();const nodes=mirrors(s.engine);
    assert.equal(nodes.length,1);assert.match(nodes[0].id,/program:ptc:1/);assert.equal(nodes[0].groupTree,'turn');
    events[4].event.data.name='another_tool';s.engine.replaceWindow(events,false);s.engine.flush();assert.equal(mirrors(s.engine).length,0);
    events[4].event.data.name='bridge_prepare';delete events[4].event.data.meta;
    s.engine.replaceWindow(events,false);s.engine.flush();assert.equal(mirrors(s.engine).length,0,'older PTC logs without metadata stay non-actionable');
  }finally{await s.close();}
});

test('no actionable mirror is created for cancelled, malformed, or allegedly already migrated tool results',async()=>{
  const s=await setup();try{
    for(const outcome of [{kind:'success',text:'Created a new session in the ptc preset.\nTarget session: synthetic · target-session\nThe source session is untouched.'},
      {kind:'success',text:'not a Bridge preview'}, {kind:'error',text:'worker rejected'}]){
      s.engine.replaceWindow(native('bridge_prepare',{bridge:{version:1,outcome}}),false);s.engine.flush();
      const nodes=mirrors(s.engine);
      if(outcome.kind==='error'){assert.equal(nodes.length,1);assert.equal(nodes[0].data.outcome.kind,'error');}
      else assert.equal(nodes.length,0);
    }
  }finally{await s.close();}
});
