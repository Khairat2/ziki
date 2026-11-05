import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apiUrl} from '../../ziki-plugin/scripts/ziki.mjs';
test('delivery workflow stays project-scoped and rejects traversal',()=>{
 const url=apiUrl('https://ziki.dev','issues/actual-id/delivery','project-id');
 assert.equal(url.pathname,'/api/v1/issues/actual-id/delivery');
 assert.equal(url.searchParams.get('projectId'),'project-id');
 assert.throws(()=>apiUrl('https://ziki.dev','issues/../delivery','project-id'),/Unsupported/);
});
