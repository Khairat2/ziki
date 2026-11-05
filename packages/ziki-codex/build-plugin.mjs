import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { install } from './install.mjs';
const root = dirname(fileURLToPath(import.meta.url));
export function buildPlugin(destination) {
  const target = resolve(destination);
  install(join(target, 'skills/ziki'));
  mkdirSync(join(target, '.codex-plugin'), {recursive:true});
  mkdirSync(join(target, 'assets'), {recursive:true});
  copyFileSync(join(root, '../../public/ziki-mark.svg'), join(target, 'assets/ziki.svg'));
  const manifest = {name:'ziki',version:'0.3.0',description:'Discover workspaces and securely create, reuse and connect your Ziki agents.',author:{name:'Ziki'},homepage:'https://ziki.dev',repository:'https://github.com/emerjent/ziki',skills:'./skills/',interface:{displayName:'Ziki',shortDescription:'Your workspaces. Your agents. One connection.',brandColor:'#132444',logo:'./assets/ziki.svg',defaultPrompt:['Use $ziki to connect my account and show my workspaces.']}};
  writeFileSync(join(target,'.codex-plugin/plugin.json'),JSON.stringify(manifest,null,2)+'\n');
  writeFileSync(join(target,'README.md'), readFileSync(join(root,'README.md')));
  writeFileSync(join(dirname(target),'marketplace.json'),JSON.stringify({name:'ziki-local',interface:{displayName:'Ziki local plugins'},plugins:[{name:'ziki',source:{source:'local',path:'./'+target.split(/[\\/]/).at(-1)},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}]},null,2)+'\n');
  return target;
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) console.log(buildPlugin(process.argv[2] || join(root,'dist/ziki')));
