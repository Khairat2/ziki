import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../scripts/ziki.mjs';

function harness() {
  let stored = JSON.stringify({ base: 'https://ziki.dev', token: 'ACCOUNT_SECRET', management: true });
  const agents = [], credentials = new Map(), events = [], calls = [], outputs = [];
  let broken = false, timestamp = 1000;
  const deps = {
    storage: (action, value) => action === 'get' ? stored : (stored = action === 'set' ? value : null),
    output: s => outputs.push(JSON.parse(s)),
    now: () => timestamp, sleep: async ms => { timestamp += ms; },
    call: async (url, options) => {
      const u = new URL(url), b = options.body; calls.push({ url: u, ...options });
      if (b?.action === 'workspaces') return { workspaces: Array.from({ length: 20 }, (_, i) => ({ tenant: { id: `t${i}`, name: `Team ${i}`, projects: [{ id: `p${i}`, name: 'App' }, { id: `p${i}b`, name: 'Other app' }] } })) };
      if (b?.action === 'agents') return { agents: agents.map(({ rawKey, ...a }) => a) };
      if (b?.action === 'ensure') return { connections: b.agents.map(a => {
        let agent = agents.find(row => row.workspaceId === b.workspaceId && row.name === a.name);
        const reused = Boolean(agent);
        if (!agent) { agent = { agentId: `a${agents.length}`, name: a.name, level: a.role === 'working' ? 'contributor' : 'reviewer', workspaceId: b.workspaceId }; agents.push(agent); }
        const key = `${agent.agentId}/${b.projectId}`;
        credentials.set(`SECRET_${key}`, { ...agent, projectId: b.projectId });
        return { ...agent, projectId: b.projectId, rawKey: `SECRET_${key}`, reused };
      }) };
      if (b?.action === 'reconnect') {
        const agent = agents.find(a => a.agentId === b.agentId && a.workspaceId === b.workspaceId);
        if (!agent) throw Error('403');
        const key = `SECRET_${b.agentId}/${b.projectId}`; credentials.set(key, { ...agent, projectId: b.projectId });
        return { ...agent, projectId: b.projectId, rawKey: key, reused: true };
      }
      if (b?.action === 'activity') return { questions: [{ id: 'question', body: 'Which branch?' }], approvals: [{ id: 'pending', status: 'pending' }] };
      const c = credentials.get(options.token);
      if (!c) throw Error('401');
      if (u.pathname.endsWith('/agents/me')) return { id: broken ? 'wrong-agent' : c.agentId, tenant_id: c.workspaceId, project_id: c.projectId, name: c.name, level: c.level };
      if (u.pathname.endsWith('/notes')) return { notes: 'Zedu builds collaborative software', standingInstructions: 'Read requirements', version: 2, syncRequired: true };
      if (u.pathname.endsWith('/issues')) return { items: [{ id: u.searchParams.get('stage') === 'ready' ? 'candidate' : 'issue', title: 'Repair login' }], nextCursor: null };
      if (u.pathname.endsWith('/events')) { events.push({ project: c.projectId, after: u.searchParams.get('after') }); return { events: [{ id: `e${events.length}`, type: 'issue.created' }], cursor: `cursor-${events.length}`, hasMore: false }; }
      return { id: c.projectId, goal: 'Build Zedu', workflow: { maxActiveClaims: 2 } };
    },
  };
  return { deps, agents, calls, outputs, events, config: () => JSON.parse(stored), breakVerification: () => { broken = true; } };
}

test('twenty workspaces with four identities persist across fresh invocations without credential output', async () => {
  const h = harness();
  for (let i = 0; i < 20; i++) await main(['agents', 'ensure', `t${i}`, `p${i}`], { ...h.deps, input: async () => Array.from({ length: 4 }, (_, j) => ({ name: `Agent ${j}`, role: j % 2 ? 'reviewing' : 'working' })) });
  assert.equal(h.agents.length, 80); assert.equal(Object.keys(h.config().connections).length, 80);
  await main(['agents', 'list'], { ...h.deps });
  assert.equal(h.outputs.at(-1).agents.length, 80);
  await main(['agents', 'use', 't0', 'p0', 'a0'], { ...h.deps });
  await main(['agents', 'ensure', 't0', 'p0'], { ...h.deps, input: async () => [{ name: 'Agent 0', role: 'working' }] });
  assert.equal(h.agents.length, 80); assert.equal(h.outputs.at(-1).agents[0].reused, true);
  await main(['switch', 't0', 'p0'], { ...h.deps });
  assert.equal(h.config().active.agentId, 'a0'); assert.equal(h.outputs.at(-1).verified, true);
  assert.ok(!JSON.stringify(h.outputs).includes('ACCOUNT_SECRET')); assert.ok(!JSON.stringify(h.outputs).includes('SECRET_'));
});

test('verification failure is reported and does not activate a mismatched identity', async () => {
  const h = harness(); h.breakVerification();
  await main(['agents', 'ensure', 't0', 'p0'], { ...h.deps, input: async () => [{ name: 'Ummi', role: 'working' }] });
  assert.equal(h.outputs.at(-1).agents[0].verified, false);
  await main(['agents', 'use', 't0', 'p0', 'a0'], h.deps);
  assert.equal(h.outputs.at(-1).verified, false); assert.equal(h.config().active, undefined);
});

test('summary reads real context and readiness-filtered candidates without bidding or auto-acknowledging', async () => {
  const h = harness();
  await main(['agents', 'ensure', 't0', 'p0'], { ...h.deps, input: async () => [{ name: 'Ummi', role: 'working' }] });
  await main(['agents', 'use', 't0', 'p0', 'a0'], h.deps);
  await main(['summary'], h.deps);
  const summary = h.outputs.at(-1);
  assert.match(summary.context.notes, /Zedu/); assert.equal(summary.biddingCandidates.items[0].id, 'candidate');
  assert.match(summary.biddingRules, /not guaranteed eligible/);
  assert.ok(!h.calls.some(c => c.url.pathname.endsWith('/bid') || (c.url.pathname.endsWith('/notes') && c.method === 'POST')));
});

test('watch covers every active workspace project, saves separate cursors and reports no scheduler', async () => {
  const h = harness();
  await main(['agents', 'ensure', 't0', 'p0'], { ...h.deps, input: async () => [{ name: 'Ummi', role: 'working' }] });
  await main(['agents', 'use', 't0', 'p0', 'a0'], h.deps);
  await main(['watch', 'once'], h.deps);
  assert.deepEqual(h.events.map(e => e.project), ['p0', 'p0b']);
  assert.ok(h.events.every(e => e.after === null));
  const snapshot = h.outputs.find(o => o.pending);
  assert.equal(snapshot.pending.approvals[0].status, 'pending');
  await main(['watch', 'once'], { ...h.deps });
  assert.deepEqual(h.events.slice(2).map(e => e.after), ['cursor-1', 'cursor-2']);
  await main(['watch', 'status'], { ...h.deps });
  assert.equal(h.outputs.at(-1).schedulerConfigured, false); assert.equal(h.outputs.at(-1).backgroundMonitoring, false);
  await main(['watch', 'run', '1'], h.deps);
  assert.equal(h.outputs.at(-1).monitoring, 'stopped');
  await assert.rejects(main(['watch', 'run', '0'], h.deps), /duration/);
});

test('query options cannot override project scope or redirect the agent credential', async () => {
  const { apiUrl } = await import('../scripts/ziki.mjs');
  assert.throws(() => apiUrl('https://ziki.dev', 'issues', 'p', { projectId: 'evil' }), /query/);
  assert.equal(apiUrl('https://ziki.dev', 'issues', 'p', { stage: 'ready' }).searchParams.get('projectId'), 'p');
});
