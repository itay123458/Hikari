import test from 'node:test';
import assert from 'node:assert/strict';
import command from '../src/commands/Anime/anime.js';
test('weekly, feed filters, preview and follow preferences are discoverable',()=>{
 const groups=command.data.toJSON().options; const admin=groups.find(g=>g.name==='admin').options,alerts=groups.find(g=>g.name==='alerts').options;
 for(const name of ['weekly','preview']) assert.ok(admin.some(s=>s.name===name));
 assert.ok(admin.find(s=>s.name==='feeds').options.some(o=>o.name==='categories'));
 for(const name of ['episodes','changes']) assert.ok(alerts.find(s=>s.name==='follow').options.some(o=>o.name===name));
 assert.ok(alerts.find(s=>s.name==='schedule').options.some(o=>o.name==='scope'));
});
