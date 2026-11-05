export const workspaces = ['Zedu', 'Ziki'];
export function initial() { return {installed:false,authorized:false,workspace:'Zedu',agents:{Zedu:[],Ziki:[]},events:[],chat:1}; }
export function transition(state, action) {
  const s = structuredClone(state);
  if(action.type==='install') s.installed=true;
  if(action.type==='authorize') {if(!s.installed) throw Error('Install Ziki first.');s.authorized=true;}
  if(action.type==='switch') {if(!workspaces.includes(action.workspace)) throw Error('Workspace membership required.');s.workspace=action.workspace;}
  if(action.type==='new-chat') s.chat++;
  if(action.type==='ensure') {
    if(!s.authorized) throw Error('Authorize the demo account first.');
    for(const [i,name] of ['Ummi Working Agent','Ummi Review Agent'].entries()) if(!s.agents[s.workspace].some(a=>a.name===name)) s.agents[s.workspace].push({id:`demo-${s.workspace.toLowerCase()}-${i}`,name,role:i?'Reviewer':'Contributor',level:'working'});
    s.events.unshift({workspace:s.workspace,text:'Created or reused both requested agents. Existing IDs preserved.'});
  }
  if(action.type==='activity') {if(!s.authorized) throw Error('Authorize first.');s.events.unshift({workspace:s.workspace,text:'Checked workspace activity. Demo fixtures loaded; no background monitoring.'});}
  if(action.type==='disconnect') s.authorized=false;
  return s;
}
