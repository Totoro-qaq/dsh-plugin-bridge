import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import * as plugin from '../src/index.ts';
import { createBridgeCommand } from '../src/command.ts';
import { createBridgeHostFromRpc } from '../src/host.ts';
import { createApiProxyRpc } from '../src/api-rpc.ts';
import { parseBridgeCard, buildBridgeMigrationCommand } from '../src/client-contract.ts';
import { createFakeHost } from './fake-host.mjs';

const CONFIG = { modelTier:'current', sourceCharBudget:60000, summaryCharBudget:2400,
  goalRounds:1, inject:'both', lang:'zh', previewTimeoutMs:5000 };
function deferred() { let resolve; const promise=new Promise(r=>{resolve=r;}); return {promise,resolve}; }
function context(sessionId='source',callId='call-1',extra={}) {
  const controller=new AbortController(); let conclusions=0;
  const exec={agent:{id:sessionId,session:{id:sessionId}},callId,signal:controller.signal,
    concludeTurn(){conclusions++;},...extra};
  return {exec,controller,get conclusions(){return conclusions;}};
}
function setup(handler=async()=>({kind:'success',text:'Preview ready'}),options={}) {
  assert.equal(typeof plugin.createBridgeNaturalLanguage,'function','Bridge must expose the optional natural-language preview entry');
  const calls=[],workers=new Set();
  const service=plugin.createBridgeNaturalLanguage({
    handler:async invocation=>{calls.push(invocation);return handler(invocation);},workerSessionIds:workers,...options,
  });
  return {service,tool:service.tool,calls,workers};
}

test('natural language uses a unique preview-only tool and public pure presentation metadata',async()=>{
  const outcome={kind:'success',text:'编辑稿与数字 17'};
  const s=setup(async()=>outcome); const caller=context('current-session');
  try {
    assert.equal(s.tool.name,'bridge_prepare');
    assert.equal(s.tool.parameters.additionalProperties,false);
    assert.deepEqual(Object.keys(s.tool.parameters.properties).sort(),['lang','targetPreset']);
    assert.equal(s.tool.isConcurrencySafe,undefined,'preview is exclusive by default');
    const value=await s.tool.execute({targetPreset:'ptc',lang:'en'},caller.exec);
    assert.deepEqual(value,outcome);
    assert.deepEqual(s.tool.output.presentationMeta({},value),{bridge:{version:1,outcome}});
    assert.doesNotMatch(JSON.stringify(s.tool.output.render({},value)),/编辑稿|17|--go|summary64/);
    assert.match(JSON.stringify(s.tool.output.render({},value)),/confirm|review/i);
    assert.equal(caller.conclusions,1,'only the current successful model turn is concluded');
    assert.equal(s.calls.length,1);
    assert.equal(s.calls[0].agent.session.id,'current-session');
    assert.equal(s.calls[0].rawInput,'ptc --lang en');
    assert.equal(s.calls[0].signal.aborted,false);
  } finally {await s.service.dispose();}
});

test('omitting target returns the existing picker; old tool contexts without concludeTurn still preview',async()=>{
  const s=setup();const caller=context('source','call-1',{concludeTurn:undefined});
  try {await s.tool.execute({},caller.exec);assert.equal(s.calls[0].rawInput,'');}
  finally{await s.service.dispose();}
});

test('parameters cannot smuggle migration authorization, another session, arbitrary commands or malformed language',async()=>{
  const s=setup();
  try {
    for(const args of [null,[],42,'ptc',
      {targetPreset:'ptc --go'},{targetPreset:'ptc\n--go'},{targetPreset:'PTC'},{targetPreset:''},
      {targetPreset:'../ptc'},{targetPreset:'x'.repeat(129)},{targetPreset:4},
      {lang:'fr'},{lang:0},{sessionId:'victim'},{go:true},{continue:true},{file:'/secret'},
      {summary:'injected'},{summary64:'abc'},{rawInput:'ptc --go'},{targetPreset:'ptc',extra:true}]) {
      await assert.rejects(s.tool.execute(args,context().exec),/invalid|parameter|target|language/i);
    }
    assert.equal(s.calls.length,0);
  }finally{await s.service.dispose();}
});

test('caller identity is host-owned, consistent and mandatory; worker sessions cannot recurse',async()=>{
  const s=setup();
  try{
    for(const agent of [undefined,{}, {id:'source',session:{id:'victim'}}, {id:' '}, {session:{header:{id:''}}}]){
      await assert.rejects(s.tool.execute({},context('source','call-1',{agent}).exec),/session|identity/i);
    }
    s.workers.add('worker');
    await assert.rejects(s.tool.execute({targetPreset:'ptc'},context('worker').exec),/worker|recursive/i);
    assert.equal(s.calls.length,0);
    const old=context('old','call-2',{agent:{session:{header:{id:'old'}}}});
    await s.tool.execute({lang:'auto'},old.exec);
    assert.equal(s.calls[0].agent.session.id,'old');
    assert.equal(s.calls[0].rawInput,'--lang auto');
  }finally{await s.service.dispose();}
});

test('one source cannot start concurrent workers; replaying one call is idempotent and session keys remain separate',async()=>{
  const gate=deferred();const s=setup(async()=>{await gate.promise;return {kind:'success',text:'ready'};});
  const a=context('source','same'); const b=context('source','other'); const other=context('elsewhere','same');
  try{
    const first=s.tool.execute({targetPreset:'ptc'},a.exec);
    const replay=s.tool.execute({targetPreset:'ptc'},a.exec);
    await assert.rejects(s.tool.execute({targetPreset:'code'},b.exec),/already|progress/i);
    await assert.rejects(s.tool.execute({targetPreset:'code'},a.exec),/same call|changed|different/i);
    const parallel=s.tool.execute({targetPreset:'ptc'},other.exec);
    await new Promise(r=>setImmediate(r));
    assert.equal(s.calls.length,2);
    gate.resolve();
    assert.deepEqual(await first,await replay);await parallel;
    assert.equal(a.conclusions,1);assert.equal(other.conclusions,1);
    await s.tool.execute({targetPreset:'ptc'},a.exec);
    assert.equal(s.calls.length,2,'settled replay cannot spend on a second worker');
  }finally{gate.resolve();await s.service.dispose();}
});

test('abort and disposal never expose a late successful preview and drain owned work',async()=>{
  const gate=deferred();const s=setup(async()=>{await gate.promise;return {kind:'success',text:'late preview'};});
  const caller=context();
  const active=s.tool.execute({targetPreset:'ptc'},caller.exec);active.catch(()=>{});
  await new Promise(r=>setImmediate(r));
  let drained=false;const disposal=s.service.dispose().then(()=>{drained=true;});
  try{
    assert.equal(s.calls[0].signal.aborted,true);
    await new Promise(r=>setImmediate(r));assert.equal(drained,false);
    gate.resolve();await assert.rejects(active,/abort|disposed|unloaded/i);await disposal;
    assert.equal(caller.conclusions,0);
    await assert.rejects(s.tool.execute({},context().exec),/disposed|unloaded/i);
    assert.equal(s.calls.length,1);
  }finally{gate.resolve();await disposal;}
  const a=setup();const cancelled=context();cancelled.controller.abort();
  try{await assert.rejects(a.tool.execute({},cancelled.exec));assert.equal(a.calls.length,0);}
  finally{await a.service.dispose();}
});

test('worker failure and thrown preparation release the source lock and do not conclude its turn',async()=>{
  let count=0;const s=setup(async()=>{if(++count===1)throw new Error('worker rejected');return {kind:'error',text:'worker missing credential'};});
  try{
    const a=context();await assert.rejects(s.tool.execute({targetPreset:'ptc'},a.exec),/worker rejected/);
    const b=context('source','retry');const value=await s.tool.execute({targetPreset:'ptc'},b.exec);
    assert.equal(value.kind,'error');assert.equal(a.conclusions+b.conclusions,0);
    assert.match(JSON.stringify(s.tool.output.render({},value)),/missing credential/);
    assert.equal(s.calls.length,2);
  }finally{await s.service.dispose();}
});

test('cache expiry and bounded retention allow an explicit new preparation without evicting active calls',async()=>{
  let now=0;const s=setup(undefined,{now:()=>now});
  try{
    const a=context();await s.tool.execute({},a.exec);now=31*60_000;
    await s.tool.execute({},context().exec);assert.equal(s.calls.length,2);
    for(let i=0;i<140;i++)await s.tool.execute({},context('source',`bounded-${i}`).exec);
    const before=s.calls.length;await s.tool.execute({},context('source','bounded-139').exec);
    assert.equal(s.calls.length,before);
    await s.tool.execute({},context('source','bounded-0').exec);assert.equal(s.calls.length,before+1);
  }finally{await s.service.dispose();}
});

test('actual command preview and confirmation share the original pending record and block cross-session replay',async()=>{
  const raw=createFakeHost();const fake={...raw,...raw.state};
  const host=createBridgeHostFromRpc(createApiProxyRpc(fake.apiProxy));const workers=new Set();
  const command=createBridgeCommand({hostFor:()=>host,config:CONFIG,pollMs:1,workerSessionIds:workers});
  const s=setup(command.handler,{workerSessionIds:workers});const caller=context(fake.sourceSessionId);
  try{
    const result=await s.tool.execute({targetPreset:'code'},caller.exec);const card=parseBridgeCard(result);
    assert.equal(card.phase,'preview');assert.ok(card.previewId);
    assert.equal(fake.calls.filter(c=>c.method==='session.create').length,1,'only summary worker exists before human confirmation');
    assert.equal(fake.goals.length,0);assert.equal(workers.size,0);
    const line=buildBridgeMigrationCommand('code',card.summary,card.lang,card.previewId);
    const wrong=await command.handler({agent:{session:{id:'victim'}},rawInput:line.replace(/^\/bridge\s+/, '')});
    assert.equal(wrong.kind,'error');assert.equal(fake.goals.length,0);
    const approved=await command.handler({agent:{session:{id:fake.sourceSessionId}},rawInput:line.replace(/^\/bridge\s+/, '')});
    assert.equal(approved.kind,'success',approved.text);assert.equal(fake.goals.length,1);
  }finally{await s.service.dispose();}
});

test('worker identity is present before prompt dispatch and released on failure',async()=>{
  const raw=createFakeHost();const fake={...raw,...raw.state};const base=createBridgeHostFromRpc(createApiProxyRpc(fake.apiProxy));
  const workers=new Set();let workerId;let s;
  const host={...base,sessions:{...base.sessions,
    prompt:async request=>{workerId=request.sessionId;assert.equal(workers.has(workerId),true);
      await assert.rejects(s.tool.execute({targetPreset:'code'},context(workerId,'recursive').exec),/worker|recursive/i);
      throw new Error('worker dispatch failed');},
  }};
  const command=createBridgeCommand({hostFor:()=>host,config:CONFIG,pollMs:1,workerSessionIds:workers});
  s=setup(command.handler,{workerSessionIds:workers});
  try{
    const result=await s.tool.execute({targetPreset:'code'},context(fake.sourceSessionId).exec);
    assert.equal(result.kind,'error');assert.match(result.text,/worker dispatch failed/);
    assert.equal(workers.size,0);assert.ok(fake.archived.includes(workerId));
    assert.equal(fake.calls.filter(c=>c.method==='session.cancel'&&c.payload.sessionId===workerId).length,1,
      'a failed preparation must stop its own worker rather than merely hide it');
    assert.equal(fake.calls.filter(c=>c.method==='session.cancel'&&c.payload.sessionId===fake.sourceSessionId).length,0);
  }finally{await s.service.dispose();}
});

test('a cancelled late worker result cannot leave a pending preview that a later --go could consume',async()=>{
  const raw=createFakeHost();const fake={...raw,...raw.state};const base=createBridgeHostFromRpc(createApiProxyRpc(fake.apiProxy));
  const controller=new AbortController();
  const host={...base,sessions:{...base.sessions,prompt:async request=>{
    const value=await base.sessions.prompt(request);controller.abort(new Error('Cancelled preview'));return value;
  }}};
  const command=createBridgeCommand({hostFor:()=>host,config:CONFIG,pollMs:1,workerSessionIds:new Set()});
  const result=await command.handler({agent:{session:{id:fake.sourceSessionId}},rawInput:'code',signal:controller.signal});
  assert.equal(result.kind,'error');
  const later=await command.handler({agent:{session:{id:fake.sourceSessionId}},rawInput:'code --go'});
  assert.equal(later.kind,'error');assert.equal(fake.goals.length,0);
});

test('manual command and natural-language entry cannot prepare two simultaneous workers for the same source',async()=>{
  const raw=createFakeHost();const fake={...raw,...raw.state};const base=createBridgeHostFromRpc(createApiProxyRpc(fake.apiProxy));
  const gate=deferred(),entered=deferred();
  const host={...base,sessions:{...base.sessions,prompt:async request=>{
    entered.resolve();await gate.promise;return base.sessions.prompt(request);
  }}};
  const workers=new Set();const command=createBridgeCommand({hostFor:()=>host,config:CONFIG,pollMs:1,workerSessionIds:workers});
  const s=setup(command.handler,{workerSessionIds:workers});
  const first=command.handler({agent:{session:{id:fake.sourceSessionId}},rawInput:'code'});
  let concurrent;
  try{
    await entered.promise;
    concurrent=s.tool.execute({targetPreset:'code'},context(fake.sourceSessionId).exec);
    await new Promise(r=>setImmediate(r));
    assert.equal(fake.calls.filter(c=>c.method==='session.create').length,1);
    const refused=await concurrent;
    assert.equal(refused.kind,'error');assert.match(refused.text,/already|正在|生成/);
    gate.resolve();assert.equal((await first).kind,'success');
    assert.equal(workers.size,0);
  }finally{gate.resolve();await first;await concurrent;await s.service.dispose();}
});

test('config defaults to natural language on, may turn it off, and no optional tools service blocks commands',async()=>{
  assert.equal(plugin.Config({}).naturalLanguage,true);
  assert.equal(plugin.Config({naturalLanguage:false}).naturalLanguage,false);
  assert.throws(()=>plugin.Config({naturalLanguage:'yes'}));
  for(const enabled of [false,true]){
    const ctx=new Context();const commands=[];
    ctx.provide('commands',{register(command){commands.push(command);return()=>{};}});
    const fiber=ctx.plugin(plugin.default,{naturalLanguage:enabled});
    await new Promise(r=>setImmediate(r));
    assert.equal(commands.length,1);assert.deepEqual(plugin.inject,['commands']);
    await fiber.dispose();
  }
});
