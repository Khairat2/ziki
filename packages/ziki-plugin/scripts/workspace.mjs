import { setTimeout as delay } from 'node:timers/promises';

export async function readJsonInput() {
  if (process.stdin.isTTY) throw new Error('Supply JSON on stdin.');
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 64000) throw new Error('Input too large.'); }
  return JSON.parse(input);
}

export function connectionKey(c) { return JSON.stringify([c.workspaceId, c.projectId, c.agentId]); }
export function remember(config, connection) {
  config.connections ??= {};
  config.connections[connectionKey(connection)] = connection;
  config.selections ??= {};
  config.selections[JSON.stringify([connection.workspaceId, connection.projectId])] = connection.agentId;
}

export async function verify(connection, api) {
  const me = await api(connection, 'agents/me');
  if (me.id !== connection.agentId || me.tenant_id !== connection.workspaceId || me.project_id !== connection.projectId) throw new Error('Server identity or project scope does not match the selected agent.');
  return { agentId: me.id, name: me.name, level: me.level, workspaceId: me.tenant_id, projectId: me.project_id, verified: true, verifiedAt: new Date().toISOString(), execution: 'API connection verified; no autonomous worker started' };
}

/** Commands return metadata only. Raw account/agent credentials never reach output. */
export async function workspaceCommand({ command, args, config, save, account, api, output, input = readJsonInput, sleep = delay, now = Date.now }) {
  const emit = value => output(JSON.stringify(value, null, 2));
  const requireActive = () => { if (!config.active) throw new Error('Select a workspace, project and agent first.'); return config.active; };
  const discover = async () => (await account({ action: 'workspaces' })).workspaces;
  async function attach(workspaceId, projectId, result) {
    const c = { workspaceId, projectId, ...result }; remember(config, c); save();
    try { const verified = await verify(c, api); c.verifiedAt = verified.verifiedAt; c.name = verified.name; c.level = verified.level; save(); return verified; }
    catch { return { agentId: c.agentId, name: c.name, level: c.level, workspaceId, projectId, verified: false, error: 'Credential saved but API verification failed. Run status after resolving permission, quota or connectivity errors.' }; }
  }
  if (command === 'agents') {
    const [action = 'list', workspaceId, projectId, agentId] = args;
    if (action === 'list') { emit({ ...await account({ action: 'agents' }), connectionStatus: 'Discovery only; use agents use or status to verify current API access.' }); return true; }
    if (!workspaceId || !projectId) throw new Error('Usage: agents ensure WORKSPACE_ID PROJECT_ID (JSON array on stdin), or agents use WORKSPACE_ID PROJECT_ID AGENT_ID');
    if (action === 'ensure') {
      const result = await account({ action: 'ensure', workspaceId, projectId, agents: await input() });
      const verified = [];
      for (const c of result.connections) verified.push({ ...await attach(workspaceId, projectId, c), reused: c.reused });
      emit({ agents: verified }); return true;
    }
    if (action === 'use' && agentId) {
      const result = await account({ action: 'reconnect', workspaceId, projectId, agentId });
      const status = await attach(workspaceId, projectId, result);
      if (status.verified) { config.active = config.connections[connectionKey({ workspaceId, projectId, agentId: result.agentId })]; save(); }
      emit(status); return true;
    }
    throw new Error('Use agents list, ensure, or use.');
  }
  if (command === 'summary') {
    const active = requireActive();
    const identity = await verify(active, api);
    const [project, context, issues, ready, activity] = await Promise.all([
      api(active, `projects/${active.projectId}`), api(active, `projects/${active.projectId}/notes`),
      api(active, 'issues', { limit: '25' }), api(active, 'issues', { stage: 'ready', limit: '25' }),
      account({ action: 'activity', workspaceId: active.workspaceId }),
    ]);
    emit({ identity, project, context, issues, biddingCandidates: ready,
      biddingRules: 'Ready means confirmed and sufficiently upvoted, not guaranteed eligible for this agent. Bidding also requires the appropriate working class, current project instructions, no live competing offer/claim, available owner claim capacity and open redesign gates. The bid endpoint makes the final decision; ask the owner before bidding.',
      pending: activity }); return true;
  }
  if (command !== 'watch') return false;
  const active = requireActive();
  const [mode = 'once', secondsRaw = '60'] = args;
  if (mode === 'status') {
    emit({ mode: 'on-demand/foreground only', backgroundMonitoring: false, schedulerConfigured: false, webhookConfigured: false,
      message: 'No persistent watcher is installed. watch once checks now; watch run SECONDS polls only while its process is running.',
      lastCheck: config.watch?.[active.workspaceId] ?? null }); return true;
  }
  if (!['once', 'run'].includes(mode)) throw new Error('Use watch once, watch run SECONDS, or watch status.');
    const seconds = Number(secondsRaw);
  if (mode === 'run' && (!Number.isInteger(seconds) || seconds < 1 || seconds > 300)) throw new Error('Foreground watch duration must be 1–300 seconds.');
  await verify(active, api);
  const workspaces = await discover();
  const workspace = workspaces.find(w => w.tenant.id === active.workspaceId)?.tenant;
  if (!workspace) throw new Error('Workspace membership is no longer available.');
  // Every active project uses a project-scoped key for the selected owned identity.
  const connections = [];
  for (const project of workspace.projects) {
    const result = await account({ action: 'reconnect', workspaceId: workspace.id, projectId: project.id, agentId: active.agentId });
    const c = { workspaceId: workspace.id, projectId: project.id, ...result }; remember(config, c); connections.push(c);
  }
  save();
  const deadline = now() + (mode === 'run' ? seconds * 1000 : 0);
  emit({ monitoring: mode === 'run' ? 'foreground process running' : 'checking once', backgroundMonitoring: false, workspace: { id: workspace.id, name: workspace.name }, projects: connections.map(c => c.projectId), durationSeconds: mode === 'run' ? seconds : 0 });
  do {
    const notifications = [];
    for (const c of connections) {
      config.eventCursors ??= {};
      const key = connectionKey(c);
      const params = { types: 'issue.created,question.*,approval.*', ...(config.eventCursors[key] ? { after: config.eventCursors[key] } : {}) };
      // Advance over every returned event, including already-seen approvals. Independent cursor per agent/project.
      const page = await api(c, 'events', params);
      notifications.push({ projectId: c.projectId, events: page.events, hasMore: page.hasMore, historicalReplayPossible: !config.eventCursors[key] });
      if (page.cursor) config.eventCursors[key] = page.cursor;
    }
    const pending = await account({ action: 'activity', workspaceId: workspace.id });
    config.watch ??= {};
    config.watch[workspace.id] = { checkedAt: new Date(now()).toISOString(), agentId: active.agentId, projectIds: connections.map(c => c.projectId), schedulerConfigured: false };
    save(); emit({ checkedAt: config.watch[workspace.id].checkedAt, notifications, pending });
    if (mode === 'once' || now() >= deadline) break;
    await sleep(Math.min(15000, deadline - now()));
  } while (now() < deadline);
  emit({ monitoring: 'stopped', backgroundMonitoring: false, schedulerConfigured: false });
  return true;
}
