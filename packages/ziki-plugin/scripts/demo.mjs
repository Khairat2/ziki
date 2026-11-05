import { main } from './ziki.mjs';
let saved, selected;
const agents = [];
const deps = {
  storage: (action, value) => action === 'get' ? saved : (saved = action === 'set' ? value : null),
  login: async () => ({ token: 'demo-account-not-a-real-token', management: true }),
  input: async () => [{ name: 'Ummi Working Agent', role: 'working' }, { name: 'Ummi Review Agent', role: 'reviewing' }],
  call: async (url, { body, token }) => {
    if (body?.action === 'workspaces') return { workspaces: [{ tenant: { id: 'zedu', name: 'Zedu', projects: [{ id: 'app', name: 'App' }] } }] };
    if (body?.action === 'agents') return { agents };
    if (body?.action === 'ensure') return { connections: body.agents.map((a, i) => {
      const existing = agents.find(row => row.name === a.name);
      const agent = existing ?? { agentId: `agent-${i}`, name: a.name, level: a.role === 'working' ? 'contributor' : 'reviewer' };
      if (!existing) agents.push(agent);
      return { ...agent, rawKey: `demo-key-${i}`, reused: Boolean(existing) };
    }) };
    if (body?.action === 'reconnect') { selected = agents.find(a => a.agentId === body.agentId); return { ...selected, rawKey: `demo-key-${agents.indexOf(selected)}`, reused: true }; }
    if (body?.action === 'activity') return { questions: [], approvals: [] };
    const u = new URL(url);
    if (u.pathname.endsWith('/agents/me')) { const a = agents[Number(token.at(-1))]; return { id: a.agentId, name: a.name, level: a.level, tenant_id: 'zedu', project_id: 'app' }; }
    if (u.pathname.endsWith('/context')) return { notes: 'Example Zedu project briefing', standingInstructions: 'Read the requirements', version: 1 };
    if (u.pathname.endsWith('/issues')) return { items: [], nextCursor: null };
    if (u.pathname.endsWith('/events')) return { events: [], cursor: null, hasMore: false };
    return { id: 'app', goal: 'Example project purpose' };
  },
};
console.log('OFFLINE DEMONSTRATION — simulated API and in-memory credentials; no live account changes.');
for (const args of [['connect'], ['agents', 'ensure', 'zedu', 'app'], ['agents', 'list'], ['agents', 'use', 'zedu', 'app', 'agent-0'], ['summary'], ['watch', 'once'], ['watch', 'status'], ['agents', 'ensure', 'zedu', 'app'], ['disconnect']]) {
  console.log(`\n> ziki ${args.join(' ')}`); await main(args, deps);
}
