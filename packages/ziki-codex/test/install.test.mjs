import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { install, destination } from '../install.mjs';
function cleanup(temp) { assert.equal(dirname(resolve(temp)), resolve(tmpdir())); rmSync(temp, { recursive: true, force: true }); }

test('installed skill reuses byte-identical runtime and executes outside the source checkout', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'ziki codex '));
  try {
    const target = install(join(temp, 'skills', 'ziki'));
    for (const name of ['ziki.mjs', 'workspace.mjs', 'vault.mjs']) assert.deepEqual(readFileSync(join(target, 'scripts', name)), readFileSync(new URL(`../../ziki-plugin/scripts/${name}`, import.meta.url)));
    const smoke = spawnSync(process.execPath, [join(target, 'scripts', 'ziki.mjs'), 'workflows'], { cwd: temp, encoding: 'utf8' });
    assert.equal(smoke.status, 0, smoke.stderr); assert.ok(JSON.parse(smoke.stdout).reads.includes('agents/me'));
    const { main } = await import(pathToFileURL(join(target, 'scripts', 'ziki.mjs')));
    let saved = JSON.stringify({ base: 'https://ziki.dev', token: 'SECRET', management: true });
    const result = [];
    const deps = { storage: (action, value) => action === 'get' ? saved : (saved = value), output: value => result.push(JSON.parse(value)), input: async () => [{ name: 'Ummi Working Agent', role: 'working' }, { name: 'Ummi Review Agent', role: 'reviewing' }],
      call: async (url, opts) => {
        if (opts.body?.action === 'ensure') return { connections: opts.body.agents.map((a, i) => ({ agentId: `a${i}`, name: a.name, level: i ? 'reviewer' : 'contributor', rawKey: `KEY${i}`, reused: true })) };
        if (opts.body?.action === 'agents') return { agents: [{ id: 'a0', name: 'Ummi Working Agent' }] };
        const i = Number(opts.token.at(-1)); return { id: `a${i}`, name: i ? 'Ummi Review Agent' : 'Ummi Working Agent', level: i ? 'reviewer' : 'contributor', tenant_id: 't', project_id: 'p' };
      } };
    await main(['agents', 'ensure', 't', 'p'], deps);
    assert.ok(result[0].agents.every(a => a.verified));
    await main(['agents', 'list'], { ...deps }); // Fresh invocation reads saved state and queries Ziki.
    assert.equal(result[1].agents[0].id, 'a0'); assert.ok(!JSON.stringify(result).match(/SECRET|KEY/));
    install(target); // Managed updates preserve installation and do not need credentials.
  } finally { cleanup(temp); }
});

test('scope selection is explicit and unmanaged skills are preserved', () => {
  assert.equal(destination(['--user'], '/profile', '/repo'), join('/profile', '.agents', 'skills', 'ziki'));
  assert.equal(destination(['--project'], '/profile', '/repo'), join('/repo', '.agents', 'skills', 'ziki'));
  assert.throws(() => destination([]), /Usage/);
  const temp = mkdtempSync(join(tmpdir(), 'ziki-existing-'));
  try { mkdirSync(join(temp, 'ziki')); writeFileSync(join(temp, 'ziki', 'SKILL.md'), 'unrelated'); assert.throws(() => install(join(temp, 'ziki')), /not managed/); assert.equal(readFileSync(join(temp, 'ziki', 'SKILL.md'), 'utf8'), 'unrelated'); }
  finally { cleanup(temp); }
});
