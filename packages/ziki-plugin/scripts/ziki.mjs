#!/usr/bin/env node
import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { vault } from './vault.mjs';
import { workspaceCommand, remember, verify } from './workspace.mjs';

export function site(value = 'https://ziki.dev') {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/' || !(u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname)))) throw new Error('Use an HTTPS origin, or HTTP localhost for development.');
  return u.origin;
}
export function apiUrl(base, path, projectId, params = {}) {
  if (!/^(agents\/me(?:\/points)?|projects(?:\/[^/?#]+(?:\/(?:context|notes))?)?|issues(?:\/[^/?#]+(?:\/(?:comments|bid|offer|heartbeat|extend|delivery|deployment|github|validations|test-results|merge|resolve|interest|structure))?)?|offers\/[^/?#]+\/accept|feed|events|goals(?:\/[^/?#]+(?:\/allocations)?)?|jobs(?:\/[^/?#]+(?:\/submissions|\/reviews|\/accept)?)?|escalations(?:\/[^/?#]+)?)$/.test(path) || /[%\\]|(?:^|\/)\.{1,2}(?:\/|$)/.test(path)) throw new Error('Unsupported API path. Run workflows.');
  if (path.startsWith('projects/') && path.split('/')[1] !== projectId) throw new Error('Switch to that project first.');
  const u = new URL(`/api/v1/${path}`, base);
  for (const [key, value] of Object.entries(params)) {
    if (!['after', 'afterId', 'limit', 'stage', 'status', 'types', 'wait', 'unread', 'q'].includes(key)) throw new Error('Unsupported query parameter.');
    u.searchParams.set(key, value);
  }
  u.searchParams.set('projectId', projectId); return u;
}
export async function request(url, { token, method = 'POST', body, fetcher = fetch } = {}) {
  const response = await fetcher(url, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method === 'POST' && new URL(url).pathname === '/api/v1/issues' ? { 'Idempotency-Key': randomBytes(16).toString('hex') } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(`Ziki ${response.status}: ${JSON.stringify(result)}`);
  return result;
}
function openBrowser(url) {
  const [command, args] = process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(command, args, { stdio: 'ignore', windowsHide: true }); child.on('error', () => {}); child.unref();
}
export async function checkAuthorizationEndpoint(base, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(new URL('/api/v1/plugin', base), { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000) });
  } catch {
    throw new Error(`Cannot reach Ziki authorization at ${base}. Check that the selected server is running. No browser authorization was started.`);
  }
  const body = await response.json().catch(() => null);
  // An empty request must reach the existing handler and fail its parameter validation.
  if (response.status === 400 && body?.error === 'Invalid authorization request') return;
  if (response.status === 404) throw new Error(`Ziki authorization backend /api/v1/plugin is not deployed at ${base}. Automatic workspace discovery and agent management require this backend. For local development, run connect http://localhost:3001 against the existing local server. No browser authorization was started.`);
  throw new Error(`Ziki authorization backend is unavailable at ${base} (HTTP ${response.status}). No browser authorization was started.`);
}
export async function authorize(base, { open = openBrowser, exchange = request, timeout = 600000, check = checkAuthorizationEndpoint } = {}) {
  await check(base);
  const verifier = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('base64url');
  let resolve, reject;
  const completion = new Promise((yes, no) => { resolve = yes; reject = no; });
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET' || u.pathname !== '/callback' || u.searchParams.get('state') !== state || !/^[\w-]{43}$/.test(u.searchParams.get('code') ?? '')) { res.writeHead(400); res.end('Invalid callback'); return; }
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'" }); res.end('Ziki authorized. Return to your coding tool.'); resolve(u.searchParams.get('code'));
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
  const url = new URL('/api/v1/plugin', base); url.search = new URLSearchParams({ redirect_uri: redirectUri, code_challenge: createHash('sha256').update(verifier).digest('base64url'), state, scope: 'agents' }).toString();
  const timer = setTimeout(() => reject(new Error('Authorization timed out; run connect again.')), timeout);
  try {
    console.error(`Authorize Ziki in your browser: ${url}`); open(url.toString());
    const code = await completion;
    return await exchange(new URL('/api/v1/plugin', base), { body: { action: 'token', code, verifier, redirectUri } });
  } finally { clearTimeout(timer); server.closeAllConnections(); await new Promise(yes => server.close(yes)); }
}
const workflows = {
  reads: ['agents/me', 'projects', 'projects/PROJECT_ID/context', 'issues', 'issues/ID', 'issues/ID/comments', 'feed', 'events', 'goals', 'jobs'],
  writes: ['issues', 'issues/ID/comments', 'issues/ID/bid', 'issues/ID/offer', 'offers/ID/accept', 'issues/ID/heartbeat', 'issues/ID/delivery', 'issues/ID/validations', 'issues/ID/test-results', 'escalations'],
  usage: 'api METHOD PATH; optional JSON body on stdin. Project scope is added automatically. Writes need server-granted levels. Read and acknowledge context first. Ask owner before bids/accept/merge.',
};
export async function main(args, { storage = vault, output = console.log, login = authorize, call = request, input, sleep, now } = {}) {
  const [command, ...rest] = args;
  if (command === 'workflows' || !command || command === 'help') { output(JSON.stringify(workflows, null, 2)); return; }
  let saved = storage('get'); let config = saved ? JSON.parse(saved) : null;
  const save = () => storage('set', JSON.stringify(config));
  const account = body => call(new URL('/api/v1/plugin', config.base), { token: config.token, body });
  const api = (c, path, params) => call(apiUrl(config.base, path, c.projectId, params), { method: 'GET', token: c.rawKey });
  if (command === 'connect') {
    const base = site(rest.find(arg => arg !== '--manage') ?? config?.base);
    if (config && config.base !== base) throw new Error('Disconnect before changing Ziki servers.');
    if (!config || rest.includes('--manage') || config.management !== true) {
      // Check vault availability before starting authentication.
      const previous = config;
      if (!config) storage('set', JSON.stringify({ base, pending: true }));
      try { const result = await login(base); config = { ...previous, base, token: result.token, management: result.management === true }; save(); }
      catch (error) { if (!previous) storage('delete'); throw error; }
      if (previous?.token) { try { await call(new URL('/api/v1/plugin', base), { token: previous.token, body: { action: 'logout' } }); } catch { /* New consent is saved; old credential still expires normally. */ } }
    } else if (!config.token) { storage('delete'); return main(args, { storage, output, login, call }); }
    try { output(JSON.stringify(await account({ action: 'workspaces' }), null, 2)); }
    catch (error) {
      if (!/^Ziki 401:/.test(error.message)) throw error;
      const result = await login(base); config = { ...config, base, token: result.token, management: result.management === true }; save();
      output(JSON.stringify(await account({ action: 'workspaces' }), null, 2));
    }
    return;
  }
  if (!config?.token) throw new Error('Run /ziki:connect first.');
  if (await workspaceCommand({ command, args: rest, config, save, account, api, output, input, sleep, now })) return;
  if (command === 'workspaces') { output(JSON.stringify(await account({ action: 'workspaces' }), null, 2)); return; }
  if (command === 'switch') {
    if (rest.length !== 2) throw new Error('Usage: switch WORKSPACE_ID PROJECT_ID');
    const previousId = config.selections?.[JSON.stringify([rest[0], rest[1]])];
    const selected = await account(previousId ? { action: 'reconnect', workspaceId: rest[0], projectId: rest[1], agentId: previousId } : { action: 'select', workspaceId: rest[0], projectId: rest[1] });
    const connection = { workspaceId: rest[0], projectId: rest[1], ...selected };
    const status = await verify(connection, api);
    remember(config, connection); config.active = connection; save();
    output(JSON.stringify(status)); return;
  }
  if (command === 'disconnect') {
    try { await account({ action: 'logout' }); }
    catch (error) { if (!/^Ziki 401:/.test(error.message)) throw error; }
    storage('delete'); output('Disconnected; account credential revoked or already invalid, and local vault entry removed.'); return;
  }
  if (!config.active) throw new Error('Select a workspace and project first with switch.');
  if (command === 'status') {
    output(JSON.stringify(await verify(config.active, api), null, 2)); return;
  }
  if (command === 'api') {
    const [method, path] = rest;
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) throw new Error('Unsupported HTTP method.');
    let body;
    if (method !== 'GET' && !process.stdin.isTTY) { let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 1000000) throw new Error('Body too large.'); } if (input.trim()) body = JSON.parse(input); }
    if (body?.projectId && body.projectId !== config.active.projectId) throw new Error('Body projectId differs from selected project.');
    output(JSON.stringify(await call(apiUrl(config.base, path, config.active.projectId), { token: config.active.rawKey, method, body }), null, 2)); return;
  }
  throw new Error('Unknown command. Use connect, workspaces, switch, agents, summary, watch, status, api, workflows, disconnect.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
