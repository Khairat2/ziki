#!/usr/bin/env node
import { mkdirSync, existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
export function install(target) {
  target = resolve(target);
  const marker = join(target, '.ziki-codex-install.json');
  if (existsSync(target)) {
    if (lstatSync(target).isSymbolicLink()) throw new Error('Refusing to replace a linked skill directory.');
    if (existsSync(marker) && lstatSync(marker).isSymbolicLink()) throw new Error('Refusing to write through a linked install marker.');
    if (!existsSync(marker) || JSON.parse(readFileSync(marker, 'utf8')).installer !== 'ziki-codex') throw new Error('Destination exists and is not managed by the Ziki installer; choose another scope or preserve it first.');
  }
  // Copy the existing runtime byte for byte. No duplicate implementation or credential migration.
  const files = new Map([
    ['SKILL.md', join(root, 'ziki', 'SKILL.md')],
    ['agents/openai.yaml', join(root, 'ziki', 'agents', 'openai.yaml')],
    ...['ziki.mjs', 'workspace.mjs', 'vault.mjs'].map(name => [`scripts/${name}`, join(root, '..', 'ziki-plugin', 'scripts', name)]),
  ]);
  const content = [...files].map(([name, source]) => [name, readFileSync(source)]);
  // Validate every destination before writing, including updates to a managed install.
  for (const [name] of content) {
    for (const path of [join(target, dirname(name)), join(target, name)]) {
      if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Refusing to write through a linked skill file or directory.');
    }
  }
  mkdirSync(target, { recursive: true });
  for (const [name, bytes] of content) {
    const file = join(target, name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes);
  }
  writeFileSync(marker, JSON.stringify({ installer: 'ziki-codex', runtimeVersion: '0.2.0', files: [...files.keys()] }, null, 2) + '\n');
  return target;
}

export function destination(args, home = homedir(), cwd = process.cwd()) {
  if (args.length === 1 && args[0] === '--user') return join(home, '.agents', 'skills', 'ziki');
  if (args.length === 1 && args[0] === '--project') return join(cwd, '.agents', 'skills', 'ziki');
  if (args.length === 2 && args[0] === '--dest') return resolve(args[1]);
  throw new Error('Usage: node packages/ziki-codex/install.mjs --user | --project | --dest SKILL_DIRECTORY');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(`Installed Ziki Codex skill: ${install(destination(process.argv.slice(2)))}\nIn a new Codex chat, type $ziki. If absent, reload VS Code. No credentials were read or changed.`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
