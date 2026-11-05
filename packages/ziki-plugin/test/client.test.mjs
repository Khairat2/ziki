import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { apiUrl, authorize, checkAuthorizationEndpoint, main, request, site } from '../scripts/ziki.mjs';
import { vault, windowsProtect } from '../scripts/vault.mjs';

test('marketplace resolves to a self-contained Claude Code plugin', () => {
  const manifest = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  assert.equal(manifest.name, 'ziki');
  const standalone = JSON.parse(readFileSync(new URL('../.claude-plugin/marketplace.json', import.meta.url), 'utf8'));
  assert.equal(standalone.plugins[0].source, './');
  assert.equal(standalone.plugins[0].name, manifest.name);
  for (const name of ['connect', 'workspace', 'status', 'issues', 'disconnect']) {
    const command = readFileSync(new URL(`../commands/${name}.md`, import.meta.url), 'utf8');
    assert.match(command, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/ziki\.mjs/);
  }
  assert.ok(existsSync(new URL('../scripts/vault.mjs', import.meta.url)));
});

test('rejects insecure origins, traversal, key endpoints and scope escapes', () => {
  for (const base of ['http://evil.test', 'https://user:pass@ziki.dev', 'https://ziki.dev/path']) assert.throws(() => site(base));
  assert.equal(site('http://localhost:3001'), 'http://localhost:3001');
  for (const path of ['https://evil.test', '../oauth', 'issues/%2e%2e', 'agents/me/key', 'issues?projectId=evil', 'projects/other/context']) assert.throws(() => apiUrl('https://ziki.dev', path, 'p'));
  assert.equal(apiUrl('https://ziki.dev', 'issues/12/comments', 'p').searchParams.get('projectId'), 'p');
});

test('account login, workspace switching and status never print credentials', async () => {
  let entry = null, logins = 0, selected; const outputs = [], calls = [];
  const deps = {
    storage: (action, value) => { if (action === 'get') return entry; entry = action === 'set' ? value : null; },
    output: s => outputs.push(s), login: async () => { logins++; return { token: 'account-secret', management: true }; },
    call: async (url, options) => {
      calls.push({ url: String(url), ...options });
      if (options.body?.action === 'workspaces') return { workspaces: [{ tenant: { id: 't', projects: [{ id: 'p' }] } }] };
      if (options.body?.action === 'select') { selected = options.body; return { agentId: 'a', rawKey: 'agent-secret', level: 'observer' }; }
      return { id: 'a', level: 'observer', tenant_id: selected.workspaceId, project_id: selected.projectId };
    },
  };
  await main(['connect'], deps); await main(['connect'], deps);
  await main(['switch', 't', 'p'], deps); await main(['status'], deps);
  await main(['switch', 't2', 'p2'], deps); await main(['workspaces'], deps);
  assert.equal(logins, 1);
  assert.equal(JSON.parse(entry).active.projectId, 'p2');
  assert.ok(!outputs.join('').includes('account-secret')); assert.ok(!outputs.join('').includes('agent-secret'));
  assert.equal(calls.find(c => c.method === 'GET').token, 'agent-secret');
  await main(['disconnect'], deps); assert.equal(entry, null);
});

test('failed switch preserves active selection and failed logout preserves revocable credential', async () => {
  let entry = JSON.stringify({ base: 'https://ziki.dev', token: 'secret', active: { projectId: 'old' } });
  const deps = { storage: (action, value) => action === 'get' ? entry : (entry = value), call: async () => { throw Error('403'); } };
  await assert.rejects(main(['switch', 'forbidden', 'x'], deps));
  assert.equal(JSON.parse(entry).active.projectId, 'old');
  await assert.rejects(main(['disconnect'], deps)); assert.equal(JSON.parse(entry).token, 'secret');
});

test('loopback OAuth verifies state and exchanges code with PKCE', async () => {
  await authorize('https://ziki.dev', {
    check: async () => {},
    open: async value => {
      const u = new URL(value), callback = new URL(u.searchParams.get('redirect_uri'));
      callback.search = new URLSearchParams({ state: 'wrong', code: 'c'.repeat(43) });
      assert.equal((await fetch(callback)).status, 400);
      callback.searchParams.set('state', u.searchParams.get('state'));
      assert.equal((await fetch(callback)).status, 200);
    },
    exchange: async (_url, { body }) => {
      assert.equal(body.code, 'c'.repeat(43)); assert.equal(body.verifier.length, 43);
      assert.match(body.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      return { token: 'secret' };
    }, timeout: 3000,
  });
});

test('authorization timeout closes listener', async () => {
  await assert.rejects(authorize('https://ziki.dev', { check: async () => {}, open: () => {}, timeout: 10 }), /timed out/);
});

test('missing backend fails before opening browser or exchanging credentials', async () => {
  let opened = false, exchanged = false;
  await assert.rejects(authorize('https://ziki.dev', {
    check: base => checkAuthorizationEndpoint(base, async () => new Response('Not found', { status: 404 })),
    open: () => { opened = true; }, exchange: () => { exchanged = true; },
  }), /not deployed.*Automatic workspace discovery/);
  assert.equal(opened, false); assert.equal(exchanged, false);
});

test('preflight accepts only the existing handler and bounds network requests', async () => {
  await checkAuthorizationEndpoint('http://localhost:3001', async (url, options) => {
    assert.equal(String(url), 'http://localhost:3001/api/v1/plugin');
    assert.equal(options.redirect, 'manual'); assert.ok(options.signal);
    assert.equal(options.headers, undefined);
    return Response.json({ error: 'Invalid authorization request' }, { status: 400 });
  });
  for (const status of [200, 302, 403, 503]) {
    await assert.rejects(checkAuthorizationEndpoint('https://ziki.dev', async () => new Response('', { status })), /unavailable/);
  }
  await assert.rejects(checkAuthorizationEndpoint('https://ziki.dev', async () => { throw Error('network'); }), /Cannot reach/);
});

test('HTTP calls forbid redirects and preserve server permission errors', async () => {
  await assert.rejects(request('https://ziki.dev/api/v1/issues', { token: 'secret', fetcher: async (_u, opts) => {
    assert.equal(opts.redirect, 'error'); assert.equal(opts.headers.Authorization, 'Bearer secret');
    return Response.json({ error: 'insufficient_level' }, { status: 403 });
  } }), /403.*insufficient_level/);
});

test('Linux vault passes secrets through stdin and has no plaintext fallback', () => {
  let seen;
  vault('set', 'top-secret', 'linux', (...args) => { seen = args; return { status: 0, stdout: '' }; });
  assert.ok(!seen[1].join(' ').includes('top-secret')); assert.equal(seen[2].input, 'top-secret');
  assert.throws(() => vault('set', 'secret', 'linux', () => ({ error: Error('missing') })), /Secret Service/);
  assert.throws(() => vault('set', 'secret', 'darwin'), /not implemented/);
});

test('Windows DPAPI encrypts and roundtrips Unicode without writing credentials', { skip: process.platform !== 'win32' }, () => {
  const value = JSON.stringify({ token: 'test-only-not-a-real-token', name: 'Íslenska 日本語' });
  const encrypted = windowsProtect('set', value);
  assert.ok(!encrypted.includes('test-only')); assert.notEqual(encrypted, value);
  assert.equal(windowsProtect('get', encrypted), value);
  assert.throws(() => windowsProtect('get', 'invalid'), /protection failed/);
});

test('expired account can reconnect and an invalid account can disconnect', async () => {
  let entry = JSON.stringify({ base: 'https://ziki.dev', token: 'expired' });
  const deps = {
    storage: (action, value) => action === 'get' ? entry : (entry = action === 'set' ? value : null),
    output: () => {}, login: async () => ({ token: 'renewed', management: true }),
    call: async (_url, opts) => { if (opts.token === 'expired' || opts.body.action === 'logout') throw Error('Ziki 401: reconnect'); return { workspaces: [] }; },
  };
  await main(['connect'], deps); assert.equal(JSON.parse(entry).token, 'renewed');
  await main(['disconnect'], deps); assert.equal(entry, null);
});
