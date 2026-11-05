import { main, site } from './ziki.mjs';

// Real server, browser approval and OS vault. No mock API or simulated success path.
async function run() {
  const [base, workspaceId, projectId, agentIdOrCreate] = process.argv.slice(2);
  if (!base || !workspaceId || !projectId || !agentIdOrCreate) throw new Error('Usage: live-demo.mjs BASE_URL WORKSPACE_ID PROJECT_ID AGENT_ID|--create-example. --create-example creates/reuses Ummi Working Agent and Ummi Review Agent with contributor/reviewer roles.');
  site(base);
  await main(['connect', base]);
  await main(['workspaces']);
  await main(['agents', 'list']);
  let agentId = agentIdOrCreate;
  if (agentIdOrCreate === '--create-example') {
    let result;
    await main(['agents', 'ensure', workspaceId, projectId], {
      input: async () => [{ name: 'Ummi Working Agent', role: 'working' }, { name: 'Ummi Review Agent', role: 'reviewing' }],
      output: value => { console.log(value); result = JSON.parse(value); },
    });
    if (!result.agents.every(a => a.verified)) throw new Error('At least one API connection could not be verified; stopping.');
    agentId = result.agents[0].agentId;
  }
  let connected;
  await main(['agents', 'use', workspaceId, projectId, agentId], { output: value => { console.log(value); connected = JSON.parse(value); } });
  if (!connected.verified) throw new Error('API verification failed; stopping.');
  await main(['summary']);
  await main(['watch', 'once']);
  await main(['watch', 'status']);
  // Separate invocation reloads the OS vault and queries persistent identities from Ziki.
  await main(['agents', 'list']);
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
