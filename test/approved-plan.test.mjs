import test from 'node:test';
import assert from 'node:assert/strict';
import * as plugin from '../src/index.ts';
import * as contract from '../src/client-contract.ts';
import { createBridgeCommand, parseBridgeInput } from '../src/command.ts';
import { createBridgeHostFromRpc } from '../src/host.ts';
import { createApiProxyRpc } from '../src/api-rpc.ts';
import { createFakeHost } from './fake-host.mjs';

const PLAN = '# 执行验收计划\r\n\r\n1. 创建 `result.txt`，内容必须是 PLAN-8472。\r\n2. 验证完整内容，不得发布或部署。\r\n';
const CONFIG = { modelTier:'current', sourceCharBudget:60000, summaryCharBudget:2400,
  goalRounds:1, inject:'both', lang:'zh', previewTimeoutMs:5000 };
const payload = (plan = PLAN, callId = 'plan-call-1') => Buffer.from(JSON.stringify({callId,plan})).toString('base64');
function deferred() {
  let resolve, reject;
  const promise = new Promise((a,b) => {resolve=a;reject=b;});
  return {promise,resolve,reject};
}
function setup(options = {},deps = {}) {
  assert.equal(typeof plugin.createPlanApprovalBridge,'function','the approved-plan workflow is not implemented');
  const raw = createFakeHost(options);
  const fake = {...raw,...raw.state};
  const base = createBridgeHostFromRpc(createApiProxyRpc(fake.apiProxy));
  const { hostTransform, ...serviceDeps } = deps;
  const host = hostTransform ? hostTransform(base, fake) : base;
  const service = plugin.createPlanApprovalBridge({hostFor:()=>host,config:CONFIG,...serviceDeps});
  const command = createBridgeCommand({hostFor:()=>host,config:CONFIG,planApprovals:service});
  const review = deferred();
  const request = {agent:{session:{id:fake.sourceSessionId}},questions:[{
    id:'plan-review',question:'Approve?',detail:PLAN,
    options:[{label:'Approve'},{label:'Keep planning'}],
    intent:{kind:'plan-review',approve:'Approve',callId:'plan-call-1'},
  }]};
  const observed = service.observe(request,()=>review.promise);
  observed.catch(()=>{});
  const invoke = rawInput => command.handler({agent:{session:{id:fake.sourceSessionId}},rawInput,attachments:[]});
  const finish = () => {review.resolve({answers:[{id:'plan-review',selected:['Keep planning']}]});service.dispose();};
  return {fake,host,service,command,request,review,observed,invoke,finish};
}

test('approved-plan transport is an explicit approval action, separate from --continue',()=>{
  const parsed = parseBridgeInput(`--approve-plan64 ${payload()} --lang zh`);
  assert.equal(parsed.error,undefined);
  assert.equal(parsed.approvePlan64,payload());
  assert.equal(parsed.autoContinue,false);
});

test('native plan button carries the exact reviewed Unicode/CRLF plan',()=>{
  assert.equal(typeof contract.buildBridgePlanApprovalCommand,'function');
  const line = contract.buildBridgePlanApprovalCommand({callId:'plan-call-1',plan:PLAN},'zh');
  const encoded = /--approve-plan64\s+(\S+)/.exec(line)?.[1];
  assert.ok(encoded);
  assert.deepEqual(JSON.parse(Buffer.from(encoded,'base64').toString('utf8')),{callId:'plan-call-1',plan:PLAN});
});

test('ordinary plan review delegates unchanged and creates no execution session',async()=>{
  const s=setup();
  try {
    const answer={answers:[{id:'plan-review',selected:['Approve']}]};
    s.review.resolve(answer);
    assert.equal(await s.observed,answer);
    assert.equal(s.fake.calls.filter(c=>c.method==='session.create').length,0);
    assert.equal(s.fake.calls.filter(c=>c.method==='session.cancel').length,0);
  } finally {s.finish();}
});

test('explicit approval stops planning and executes the entire plan in a fresh same-preset session',async()=>{
  const s=setup();
  try {
    const result=await s.invoke(`--approve-plan64 ${payload()}`);
    assert.equal(result.kind,'success',result.text);
    const creates=s.fake.calls.filter(c=>c.method==='session.create');
    assert.equal(creates.length,1);
    assert.equal(creates[0].payload.agentPreset,'minimal');
    const cancel=s.fake.calls.findIndex(c=>c.method==='session.cancel'&&c.payload.sessionId===s.fake.sourceSessionId);
    const create=s.fake.calls.findIndex(c=>c.method==='session.create');
    assert.ok(cancel>=0&&cancel<create,'the planning turn must stop before implementation is admitted');
    assert.equal(s.fake.goals[0].objective,PLAN,'approval must not summarize or rewrite the plan');
    assert.equal(s.fake.pausedGoals.length,1);
    const prompt=s.fake.calls.find(c=>c.method==='session.prompt');
    assert.notEqual(prompt.payload.sessionId,s.fake.sourceSessionId);
    const text=prompt.payload.content.find(c=>c.type==='text').text;
    assert.ok(text.includes(PLAN));
    assert.match(text,/已批准|approved/i);
    assert.match(text,/开始执行|execute/i);
    assert.doesNotMatch(text,/另一套工具模式/);
    assert.equal(contract.parseBridgeCard(result).phase,'migrated');
  } finally {s.finish();}
});

test('review text changed or a review from another call cannot grant execution',async()=>{
  const s=setup();
  try {
    for(const encoded of [payload(PLAN+'\n部署生产'),payload(PLAN,'other-call')]){
      const r=await s.invoke(`--approve-plan64 ${encoded}`);
      assert.equal(r.kind,'error');
    }
    assert.equal(s.fake.calls.filter(c=>['session.cancel','session.create','session.prompt'].includes(c.method)).length,0);
  } finally {s.finish();}
});

test('approval remains bound to its source session',async()=>{
  const s=setup();
  try {
    const r=await s.command.handler({agent:{session:{id:'another-session'}},rawInput:`--approve-plan64 ${payload()}`,attachments:[]});
    assert.equal(r.kind,'error');
    assert.equal(s.fake.calls.filter(c=>c.method==='session.create').length,0);
  } finally {s.finish();}
});

test('two approval clicks create one execution session and return the same target',async()=>{
  const s=setup();
  try {
    const [a,b]=await Promise.all([s.invoke(`--approve-plan64 ${payload()}`),s.invoke(`--approve-plan64 ${payload()}`)]);
    assert.equal(a.kind,'success',a.text);
    assert.deepEqual(b,a);
    assert.equal(s.fake.calls.filter(c=>c.method==='session.create').length,1);
    assert.equal(s.fake.calls.filter(c=>c.method==='session.prompt').length,1);
  } finally {s.finish();}
});

test('a native in-place approval that already settled makes the Bridge action stale',async()=>{
  const s=setup();
  try {
    s.review.resolve({answers:[{id:'plan-review',selected:['Approve']}]});
    await s.observed;
    const r=await s.invoke(`--approve-plan64 ${payload()}`);
    assert.equal(r.kind,'error');
    assert.equal(s.fake.calls.filter(c=>c.method==='session.create').length,0);
  } finally {s.finish();}
});

test('a concurrent native answer cannot resume in-place execution after Bridge claimed approval',async()=>{
  const s=setup();
  try {
    const result=s.invoke(`--approve-plan64 ${payload()}`);
    await new Promise(r=>setImmediate(r));
    s.review.resolve({answers:[{id:'plan-review',selected:['Approve']}]});
    await assert.rejects(s.observed,/Bridge|新会话|execution/i);
    assert.equal((await result).kind,'success');
  } finally {s.finish();}
});

test('a create failure can retry the already-approved plan without cancelling newer source work',async()=>{
  const s=setup({failTargetCreateOnce:'minimal'});
  try {
    const first=await s.invoke(`--approve-plan64 ${payload()}`);
    assert.equal(first.kind,'error');
    const token=/--approved-plan\s+([a-zA-Z0-9-]+)/.exec(first.text)?.[1];
    assert.ok(token,first.text);
    const retry=await s.invoke(`--approved-plan ${token}`);
    assert.equal(retry.kind,'success',retry.text);
    assert.equal(s.fake.calls.filter(c=>c.method==='session.cancel').length,1);
    assert.equal(s.fake.calls.filter(c=>c.method==='session.prompt').length,1);
    assert.equal(s.fake.goals[0].objective,PLAN);
  } finally {s.finish();}
});

function planDirectoryHost(state) {
  return (base, fake) => ({ ...base, sessions: { ...base.sessions,
    list: async request => {
      const result = await base.sessions.list(request);
      return { ...result, items: result.items.map(row => row.sessionId === fake.sourceSessionId
        ? { ...row, currentCwd: state.currentCwd } : row) };
    },
    cancel: async request => {
      const result = await base.sessions.cancel(request);
      if (state.afterCancel !== undefined) state.currentCwd = state.afterCancel;
      return result;
    },
  } });
}

test('approved-plan execution reads the switched directory after stopping the planning turn', async () => {
  const state = { currentCwd: '/work/shop/.worktrees/review', afterCancel: '/work/shop/.worktrees/execution' };
  const s = setup({}, { hostTransform: planDirectoryHost(state) });
  try {
    const result = await s.invoke(`--approve-plan64 ${payload()}`);
    assert.equal(result.kind, 'success', result.text);
    assert.deepEqual(s.fake.calls.find(call => call.method === 'session.create').payload, {
      cwd: '/work/shop/.worktrees/execution', agentPreset: 'minimal',
    });
    assert.equal(s.fake.goals[0].objective, PLAN);
    assert.equal(s.fake.pausedGoals.length, 1);
    assert.ok(s.fake.calls.find(call => call.method === 'session.prompt').payload.content[0].text.includes(PLAN));
    assert.equal(s.fake.calls.filter(call => call.method === 'session.cancel').length, 1);
  } finally { s.finish(); }
});

test('approved-plan create retry uses the new directory without repeating source cancellation', async () => {
  const state = { currentCwd: '/work/shop/.worktrees/first' };
  const s = setup({ failTargetCreateOnce: 'minimal' }, { hostTransform: planDirectoryHost(state) });
  try {
    const first = await s.invoke(`--approve-plan64 ${payload()}`);
    assert.equal(first.kind, 'error');
    const token = /--approved-plan\s+([a-zA-Z0-9-]+)/.exec(first.text)?.[1];
    assert.ok(token, first.text);
    state.currentCwd = '/work/shop/.worktrees/retry';
    const retry = await s.invoke(`--approved-plan ${token}`);
    assert.equal(retry.kind, 'success', retry.text);
    assert.deepEqual(s.fake.calls.filter(call => call.method === 'session.create').map(call => call.payload), [
      { cwd: '/work/shop/.worktrees/first', agentPreset: 'minimal' },
      { cwd: '/work/shop/.worktrees/retry', agentPreset: 'minimal' },
    ]);
    assert.equal(s.fake.calls.filter(call => call.method === 'session.cancel').length, 1);
    assert.equal(s.fake.goals[0].objective, PLAN);
  } finally { s.finish(); }
});

test('approved-plan malformed current directory never creates or starts an execution target', async () => {
  const s = setup({}, { hostTransform: planDirectoryHost({ currentCwd: 'relative/worktree' }) });
  try {
    const result = await s.invoke(`--approve-plan64 ${payload()}`);
    assert.equal(result.kind, 'error');
    assert.match(result.text, /invalid-current-cwd/);
    assert.equal(s.fake.calls.filter(call => call.method === 'session.create' || call.method === 'session.prompt').length, 0);
    assert.equal(s.fake.goals.length, 0);
  } finally { s.finish(); }
});

test('approved-plan unchanged directory still creates in the original workspace', async () => {
  const s = setup({}, { hostTransform: planDirectoryHost({ currentCwd: null }) });
  try {
    const result = await s.invoke(`--approve-plan64 ${payload()}`);
    assert.equal(result.kind, 'success', result.text);
    assert.deepEqual(s.fake.calls.find(call => call.method === 'session.create').payload, {
      workspaceId: 'ws-1', agentPreset: 'minimal',
    });
  } finally { s.finish(); }
});

test('source cancellation failure admits no execution session',async()=>{
  const s=setup();
  try {
    const old=s.host.sessions.cancel;
    const broken={...s.host,sessions:{...s.host.sessions,cancel:async()=>{throw Error('cancel failed');}}};
    const service=plugin.createPlanApprovalBridge({hostFor:()=>broken,config:CONFIG});
    const observed=service.observe(s.request,()=>s.review.promise);observed.catch(()=>{});
    const r=await service.execute({sessionId:s.fake.sourceSessionId,approvePlan64:payload(),lang:'zh'});
    assert.equal(r.kind,'error');
    assert.equal(s.fake.calls.filter(c=>c.method==='session.create').length,0);
    assert.equal(typeof old,'function');
    service.dispose();
  } finally {s.finish();}
});

test('unloading Bridge preserves ordinary pending plan approval and rejects new Bridge actions',async()=>{
  const s=setup();
  try {
    s.service.dispose();
    const answer={answers:[{id:'plan-review',selected:['Approve']}]};
    s.review.resolve(answer);
    assert.equal(await s.observed,answer);
    const r=await s.invoke(`--approve-plan64 ${payload()}`);
    assert.equal(r.kind,'error');
    assert.equal(s.fake.calls.filter(c=>c.method==='session.create').length,0);
  } finally {s.finish();}
});

test('invalid approval payloads do not cancel the plan or create sessions',async()=>{
  const s=setup();
  try {
    for(const encoded of ['***',Buffer.from('null').toString('base64'),Buffer.from(JSON.stringify({callId:'plan-call-1',plan:''})).toString('base64')]){
      assert.equal((await s.invoke(`--approve-plan64 ${encoded}`)).kind,'error');
    }
    assert.equal(s.fake.calls.filter(c=>c.method==='session.create'||c.method==='session.cancel').length,0);
  } finally {s.finish();}
});

test('generic questions and already-aborted requests keep their original answerer flow',async()=>{
  const s=setup();
  try {
    const answer={answers:[{id:'general',selected:['yes']}]};
    assert.equal(await s.service.observe({agent:s.request.agent,questions:[{id:'general',question:'yes?'}]},()=>Promise.resolve(answer)),answer);
    const controller=new AbortController();controller.abort();
    assert.equal(await s.service.observe({...s.request,signal:controller.signal},()=>Promise.resolve(answer)),answer);
    assert.equal(s.fake.calls.filter(c=>c.method==='session.create').length,0);
  } finally {s.finish();}
});

test('a source review cancelled after rendering cannot stop newer work or authorize a target',async()=>{
  const s=setup();
  try {
    const controller=new AbortController();
    const service=plugin.createPlanApprovalBridge({hostFor:()=>s.host,config:CONFIG});
    const observed=service.observe({...s.request,signal:controller.signal},()=>s.review.promise);observed.catch(()=>{});
    controller.abort();
    const r=await service.execute({sessionId:s.fake.sourceSessionId,approvePlan64:payload(),lang:'zh'});
    assert.equal(r.kind,'error');
    assert.equal(s.fake.calls.filter(c=>c.method==='session.cancel'||c.method==='session.create').length,0);
    service.dispose();
  } finally {s.finish();}
});

test('unloading during source cancellation admits no new target',async()=>{
  const s=setup();
  try {
    const gate=deferred();
    const host={...s.host,sessions:{...s.host.sessions,cancel:()=>gate.promise}};
    const service=plugin.createPlanApprovalBridge({hostFor:()=>host,config:CONFIG});
    const observed=service.observe(s.request,()=>s.review.promise);observed.catch(()=>{});
    const running=service.execute({sessionId:s.fake.sourceSessionId,approvePlan64:payload(),lang:'zh'});
    await new Promise(r=>setImmediate(r));
    service.dispose();gate.resolve({});
    assert.equal((await running).kind,'error');
    assert.equal(s.fake.calls.filter(c=>c.method==='session.create').length,0);
  } finally {s.finish();}
});

test('an explicitly unaccepted source cancellation cannot start implementation',async()=>{
  const s=setup();
  try {
    const host={...s.host,sessions:{...s.host.sessions,cancel:async()=>({accepted:false})}};
    const service=plugin.createPlanApprovalBridge({hostFor:()=>host,config:CONFIG});
    const observed=service.observe(s.request,()=>s.review.promise);observed.catch(()=>{});
    const r=await service.execute({sessionId:s.fake.sourceSessionId,approvePlan64:payload(),lang:'zh'});
    assert.equal(r.kind,'error');
    assert.equal(s.fake.calls.filter(c=>c.method==='session.create').length,0);
    service.dispose();
  } finally {s.finish();}
});

test('expired approval retry and another-session retry authorize no additional target',async()=>{
  let clock=100;
  const s=setup({failTargetCreateOnce:'minimal'},{now:()=>clock});
  try {
    const first=await s.invoke(`--approve-plan64 ${payload()}`);
    const token=/--approved-plan\s+([a-zA-Z0-9-]+)/.exec(first.text)?.[1];
    assert.ok(token,first.text);
    assert.equal((await s.command.handler({agent:{session:{id:'other-session'}},rawInput:`--approved-plan ${token}`})).kind,'error');
    clock+=31*60000;
    assert.equal((await s.invoke(`--approved-plan ${token}`)).kind,'error');
    assert.equal(s.fake.calls.filter(c=>c.method==='session.create').length,1);
  } finally {s.finish();}
});

test('retry after source user requirements change stops instead of executing the old plan',async()=>{
  const s=setup({failTargetCreateOnce:'minimal'});
  try {
    const first=await s.invoke(`--approve-plan64 ${payload()}`);
    const token=/--approved-plan\s+([a-zA-Z0-9-]+)/.exec(first.text)?.[1];
    assert.ok(token);
    s.fake.sessions.get(s.fake.sourceSessionId).events.push({event:{seq:900,type:'user/message',data:{content:[{type:'text',text:'任务已取消，禁止执行旧计划。'}]}}});
    assert.equal((await s.invoke(`--approved-plan ${token}`)).kind,'error');
    assert.equal(s.fake.calls.filter(c=>c.method==='session.create').length,1);
    assert.equal(s.fake.calls.filter(c=>c.method==='session.prompt').length,0);
  } finally {s.finish();}
});

test('English approval results and completed replay point to the same execution session',async()=>{
  const s=setup();
  try {
    const first=await s.invoke(`--approve-plan64 ${payload()} --lang en`);
    assert.equal(first.kind,'success',first.text);
    assert.match(first.text,/complete approved plan/i);
    assert.equal(contract.parseBridgeCard(first).lang,'en');
    assert.deepEqual(await s.invoke(`--approve-plan64 ${payload()} --lang en`),first);
    assert.equal(s.fake.calls.filter(c=>c.method==='session.create').length,1);
  } finally {s.finish();}
});

test('invalid execution preset and oversized or non-UTF8 approval payloads preserve the planning turn',async()=>{
  const s=setup();
  try {
    const inputs=[`missing-preset --approve-plan64 ${payload()}`,
      `--approve-plan64 ${payload('x'.repeat(contract.MAX_APPROVED_PLAN_CHARS+1))}`,
      `--approve-plan64 ${Buffer.from([255,254,253]).toString('base64')}`];
    for(const input of inputs)assert.equal((await s.invoke(input)).kind,'error');
    assert.throws(()=>contract.buildBridgePlanApprovalCommand({callId:'x',plan:'x'.repeat(contract.MAX_APPROVED_PLAN_CHARS+1)},'zh'));
    assert.equal(s.fake.calls.filter(c=>c.method==='session.cancel'||c.method==='session.create').length,0);
  } finally {s.finish();}
});

test('an approved plan longer than the summary budget is transferred without compression',async()=>{
  const s=setup();
  try {
    const longPlan='# 完整批准计划\n\n'+('必须保留这一条具体验收条件及编号。\n'.repeat(500))+'\n最后验证 TOKEN-END-3917。';
    const review={...s.request,questions:[{...s.request.questions[0],detail:longPlan,intent:{...s.request.questions[0].intent,callId:'long-plan-call'}}]};
    const pending=deferred();
    const observed=s.service.observe(review,()=>pending.promise);observed.catch(()=>{});
    assert.equal((await s.invoke(`--approve-plan64 ${payload(longPlan,'long-plan-call')}`)).kind,'success');
    assert.ok(longPlan.length>CONFIG.summaryCharBudget);
    assert.equal(s.fake.goals[0].objective,longPlan);
    assert.ok(s.fake.calls.find(c=>c.method==='session.prompt').payload.content.some(c=>c.type==='text'&&c.text.includes(longPlan)));
    pending.resolve({answers:[]});
  } finally {s.finish();}
});

test('old retry authority is retired when the bounded approval history fills',async()=>{
  const s=setup({failTargetCreateOnce:'minimal'});
  try {
    const first=await s.invoke(`--approve-plan64 ${payload()}`);
    const token=/--approved-plan\s+([a-zA-Z0-9-]+)/.exec(first.text)?.[1];
    assert.ok(token);
    for(let i=2;i<=65;i++){
      const pending=deferred(),callId=`bounded-plan-${i}`;
      const observed=s.service.observe({...s.request,questions:[{...s.request.questions[0],intent:{...s.request.questions[0].intent,callId}}]},()=>pending.promise);
      observed.catch(()=>{});
      assert.equal((await s.invoke(`--approve-plan64 ${payload(PLAN,callId)}`)).kind,'success');
      pending.resolve({answers:[]});
    }
    const before=s.fake.calls.filter(c=>c.method==='session.create').length;
    assert.equal((await s.invoke(`--approved-plan ${token}`)).kind,'error');
    assert.equal(s.fake.calls.filter(c=>c.method==='session.create').length,before);
  } finally {s.finish();}
});
