import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeHost } from './fake-host.mjs';
import { createBridgeHostFromRpc } from '../src/host.ts';
import { createApiProxyHost, createApiProxyRpc } from '../src/api-rpc.ts';
import { createRpc } from '../src/rpc.ts';
import { createDshAlphaHost } from '../src/dsh-alpha-host.ts';
import { createBridgeCommand } from '../src/command.ts';
import { waitIdle, previewMigration } from '../src/migrate.ts';

const CONFIG={modelTier:'current',sourceCharBudget:60000,summaryCharBudget:2400,goalRounds:1,inject:'both',lang:'en',previewTimeoutMs:5000};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('waitIdle does not swallow repeated AbortError history failures',async()=>{
  const fake=createFakeHost();const base=createBridgeHostFromRpc(fake.rpc);
  const stop=new AbortController();const timer=setTimeout(()=>stop.abort(new Error('caller stopped')),15);
  const host={...base,sessions:{...base.sessions,history:async()=>{throw Object.assign(new Error('cancelled inspect'),{name:'AbortError'});}}};
  try{
    await assert.rejects(waitIdle(host,'worker',{pollMs:5,timeoutMs:150,startGraceMs:300,signal:stop.signal}),/cancelled inspect|caller stopped/);
  }finally{clearTimeout(timer);}
});

test('waitIdle abort interrupts a long poll sleep instead of waiting for the full interval',async()=>{
  const fake=createFakeHost();const host=createBridgeHostFromRpc(fake.rpc);const stop=new AbortController();
  const pending=waitIdle(host,fake.sourceSessionId,{pollMs:300,timeoutMs:250,startGraceMs:500,signal:stop.signal});
  const observed=pending.then(()=>({state:'returned'}),error=>({state:'aborted',error}));
  stop.abort(new Error('stop sleeping'));
  try{
    const winner=await Promise.race([observed,pause(80).then(()=>({state:'still waiting'}))]);
    assert.equal(winner.state,'aborted');assert.match(winner.error.message,/stop sleeping/);
  }finally{await observed;}
});

test('history receives the explicit wait signal through the semantic Host port',async()=>{
  const fake=createFakeHost();const base=createBridgeHostFromRpc(fake.rpc);const stop=new AbortController();
  let actual;
  const host={...base,sessions:{...base.sessions,history:async(_request,options)=>{
    actual=options?.signal;return {events:[{event:{type:'turn/end',seq:1,data:{reason:{kind:'completed'}}}}]};
  }}};
  assert.equal((await waitIdle(host,'worker',{pollMs:1,signal:stop.signal})).idle,true);
  assert.equal(actual,stop.signal);
});

test('a pending read-only history Promise cannot prevent cancellation from reaching owned worker cleanup',async()=>{
  const fake=createFakeHost();const base=createBridgeHostFromRpc(fake.rpc);const stop=new AbortController();
  let release,entered;const reading=new Promise(r=>{entered=r;});const blocked=new Promise(r=>{release=r;});
  const host={...base,sessions:{...base.sessions,history:async()=>{entered();await blocked;return {events:[]};}}};
  const pending=waitIdle(host,'worker',{pollMs:1,timeoutMs:1000,startGraceMs:1000,signal:stop.signal});
  const observed=pending.then(()=>({state:'returned'}),error=>({state:'aborted',error}));
  try{
    await reading;stop.abort(new Error('stop pending history'));
    assert.equal((await Promise.race([observed,pause(80).then(()=>({state:'still waiting'}))])).state,'aborted');
  }finally{release();await observed;}
});

test('optional fourth RPC signal cancels HTTP history without losing the abort error',async()=>{
  const stop=new AbortController();let entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const rpc=createRpc({api:'https://synthetic.invalid/api',fetchImpl:async(_url,options)=>{
    entered();return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  }});
  const reason=new Error('explicit history cancellation');
  // AbortSignal.timeout is unref'ed; the regression's pre-fix HTTP mock must
  // keep its event loop alive until that timeout proves the wrong error.
  const keepAlive=setTimeout(()=>{},1500);
  const pending=rpc('session.history',{},1000,stop.signal);pending.catch(()=>{});
  try{await started;stop.abort(reason);await assert.rejects(pending,error=>error===reason);}
  finally{stop.abort(reason);clearTimeout(keepAlive);}
});

test('optional fourth RPC signal reaches legacy API history while three-argument callers retain their captured signal',async()=>{
  const outer=new AbortController(),call=new AbortController();let actual;
  const rpc=createApiProxyRpc({sessions:{history:async(_request,signal)=>{actual=signal;return {result:{ok:true,value:{events:[]}}};}},workspace:{},goals:{},agentPresets:{}},outer.signal);
  await rpc('session.history',{},100);assert.equal(actual,outer.signal);
  await rpc('session.history',{},100,call.signal);
  call.abort(new Error('inner cancelled'));assert.equal(actual.aborted,true);assert.equal(outer.signal.aborted,false);
});

test('failed worker cleanup waits for cancel to settle before archival and releases only its own guard',async()=>{
  const fake=createFakeHost();const base=createBridgeHostFromRpc(fake.rpc);const workers=new Set(['someone-else']);
  let workerId,active=true,stopsAt=Infinity,archived=false,cancelled=false;
  const running=()=>active&&Date.now()<stopsAt;
  const host={...base,sessions:{...base.sessions,
    list:async request=>{const result=await base.sessions.list(request);return {items:result.items.map(row=>row.sessionId===workerId?{...row,running:running()}:row)};},
    history:async(request,options)=>request.sessionId!==workerId?base.sessions.history(request,options):{
      events:[{event:{type:'turn/start',seq:1,data:{}}},...(!running()?[{event:{type:'turn/end',seq:2,data:{reason:{kind:'aborted'}}}}]:[])],
    },
    prompt:async request=>{workerId=request.sessionId;throw new Error('worker stream failed');},
    cancel:async request=>{assert.equal(request.sessionId,workerId);cancelled=true;stopsAt=Date.now()+25;return {accepted:true};},
  },workspaces:{...base.workspaces,archiveSession:async request=>{
    assert.equal(request.sessionId,workerId);if(running())throw new Error('workspace/session-active');archived=true;return {};
  }}};
  await assert.rejects(previewMigration(host,{sessionId:fake.sourceSessionId,pollMs:1,workerTimeoutMs:100,
    workerSessionIds:workers,cleanupHostFor:()=>host,cleanupTimeoutMs:250}),/worker stream failed/);
  active=false;
  assert.equal(cancelled,true);assert.equal(archived,true,'archive must not be swallowed while the cancelled turn still runs');
  assert.deepEqual([...workers],['someone-else']);
});

test('archival failure is surfaced and keeps the owned worker excluded from recursive calls',async()=>{
  const fake=createFakeHost();const base=createBridgeHostFromRpc(fake.rpc);const workers=new Set();let workerId;
  const host={...base,sessions:{...base.sessions,create:async request=>{const made=await base.sessions.create(request);workerId=made.sessionId;return made;}},
    workspaces:{...base.workspaces,archiveSession:async()=>{throw new Error('archive storage refused');}}};
  await assert.rejects(previewMigration(host,{sessionId:fake.sourceSessionId,pollMs:1,workerTimeoutMs:100,
    workerSessionIds:workers,cleanupHostFor:()=>host,cleanupTimeoutMs:200}),/cleanup|archive storage refused/);
  assert.equal(workers.has(workerId),true);
});

test('a cleanup failure preserves the original provider failure identity and records both failures',async()=>{
  const fake=createFakeHost({workerReply:'',workerTurnEnd:{kind:'error',error:{code:'MISSING_CREDENTIAL',message:'no credential'}}});
  const base=createBridgeHostFromRpc(fake.rpc);const workers=new Set();
  const host={...base,workspaces:{...base.workspaces,archiveSession:async()=>{throw new Error('archive disk refused');}}};
  await assert.rejects(previewMigration(host,{sessionId:fake.sourceSessionId,pollMs:1,workerTimeoutMs:100,workerSessionIds:workers,
    cleanupHostFor:()=>host,cleanupTimeoutMs:100}),error=>error.code==='worker-failed'
      &&error.details.turnEnd.code==='MISSING_CREDENTIAL'&&error.details.cleanupFailure.code==='worker-cleanup-failed');
  assert.equal(workers.size,1);
  const command=createBridgeCommand({hostFor:()=>host,config:CONFIG,pollMs:1,workerSessionIds:workers});
  const outcome=await command.handler({agent:{session:{id:fake.sourceSessionId}},rawInput:'code'});
  assert.equal(outcome.kind,'error');assert.match(outcome.text,/MISSING_CREDENTIAL/);
  assert.match(outcome.text,/cleanup also failed/);assert.match(outcome.text,/archive disk refused/);
});

test('cleanup port resolution failure is also visible without erasing the primary provider error',async()=>{
  const fake=createFakeHost({workerReply:'',workerTurnEnd:{kind:'error',error:{code:'MISSING_CREDENTIAL',message:'no credential'}}});
  const workers=new Set();
  await assert.rejects(previewMigration(createBridgeHostFromRpc(fake.rpc),{sessionId:fake.sourceSessionId,pollMs:1,
    workerTimeoutMs:100,workerSessionIds:workers,cleanupHostFor:()=>{throw new Error('cleanup context unavailable');}}),
    error=>error.code==='worker-failed'&&error.details.cleanupFailure.code==='worker-cleanup-failed'
      &&error.details.cleanupFailure.message.includes('cleanup context unavailable'));
  assert.equal(workers.size,1);
});

test('a worker that never retires hits the independent cleanup budget without false archival or guard release',async()=>{
  const fake=createFakeHost();const base=createBridgeHostFromRpc(fake.rpc);const workers=new Set();let workerId,archives=0;
  const host={...base,sessions:{...base.sessions,
    list:async request=>{const result=await base.sessions.list(request);return {items:result.items.map(row=>row.sessionId===workerId?{...row,running:true}:row)};},
    prompt:async request=>{workerId=request.sessionId;throw new Error('worker transport failed');},cancel:async()=>({accepted:true}),
  },workspaces:{...base.workspaces,archiveSession:async()=>{archives++;return {};}}};
  const started=Date.now();
  await assert.rejects(previewMigration(host,{sessionId:fake.sourceSessionId,pollMs:1,workerSessionIds:workers,
    cleanupHostFor:()=>host,cleanupTimeoutMs:25}),error=>error.code==='worker-cleanup-failed');
  assert.ok(Date.now()-started<250);assert.equal(archives,0);assert.equal(workers.has(workerId),true);
});

test('aborted legacy invocation uses a fresh cleanup signal, not the cancelled API proxy port',async()=>{
  const fake=createFakeHost();const stop=new AbortController();let workerId,cleaned=false;
  const proxy=Object.fromEntries(Object.entries(fake.apiProxy).map(([domain,methods])=>[domain,
    Object.fromEntries(Object.entries(methods).map(([method,fn])=>[method,async(request,signal)=>{
      signal?.throwIfAborted();
      if(domain==='sessions'&&method==='prompt'){
        workerId=request.payload.sessionId;stop.abort(new Error('legacy request cancelled'));throw stop.signal.reason;
      }
      if(domain==='workspace'&&method==='archiveSession'){
        assert.equal(request.payload.sessionId,workerId);assert.equal(signal.aborted,false);cleaned=true;
      }
      return fn(request,signal);
    }]))]));
  const command=createBridgeCommand({hostFor:signal=>createApiProxyHost(proxy,signal),config:CONFIG,pollMs:1,workerSessionIds:new Set()});
  const outcome=await command.handler({agent:{session:{id:fake.sourceSessionId}},rawInput:'code',signal:stop.signal});
  assert.equal(outcome.kind,'error');assert.equal(cleaned,true);
});

test('typed archive preserves stopActivity, while legacy RPC does not invent a new request field',async()=>{
  let typed,legacy;
  const host=createDshAlphaHost({workspaceController:{archiveSession:async request=>{typed=request;return {};}}});
  await host.workspaces.archiveSession({sessionId:'owned-worker',stopActivity:true});
  assert.deepEqual(typed,{sessionId:'owned-worker',stopActivity:true});
  const old=createBridgeHostFromRpc(async(_method,payload)=>{legacy=payload;return {};});
  await old.workspaces.archiveSession({sessionId:'owned-worker',stopActivity:true});
  assert.deepEqual(legacy,{sessionId:'owned-worker'});
});
