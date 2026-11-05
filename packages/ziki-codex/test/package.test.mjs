import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildPlugin} from '../build-plugin.mjs';
test('plugin manifest resolves a self-contained skill and shared runtime',()=>{const root=buildPlugin(join(mkdtempSync(join(tmpdir(),'ziki-plugin-')),'ziki'));const m=JSON.parse(readFileSync(join(root,'.codex-plugin/plugin.json')));assert.equal(m.name,'ziki');assert.equal(m.skills,'./skills/');assert.match(readFileSync(join(root,'skills/ziki/SKILL.md'),'utf8'),/name: ziki/);for(const file of ['ziki.mjs','vault.mjs','workspace.mjs'])assert.ok(readFileSync(join(root,'skills/ziki/scripts',file)).length);assert.ok(readFileSync(join(root,'assets/ziki.svg')).length);});
