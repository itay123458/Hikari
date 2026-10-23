import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyOccurrence, followedSchedule } from '../src/services/anime/schedules.js';
import { validateSettings } from '../src/services/anime/domain.js';
test('weekly settings defaults and validation', () => {
 const s=validateSettings({}); assert.equal(s.weeklyDay,1); assert.equal(s.weeklyTime,'09:00'); assert.equal(s.weeklyType,'all'); assert.deepEqual(s.feedCategories,['news','trailers','sequels','dates','status']);
 assert.throws(()=>validateSettings({weeklyDay:7})); assert.throws(()=>validateSettings({weeklyTime:'24:00'})); assert.throws(()=>validateSettings({feedCategories:['rumors']}));
});
test('weekly local occurrences resolve DST gaps and folds at first occurrence',()=>{
 for(const [timezone,weeklyDay,weeklyTime,now,at] of [
 ['America/New_York',0,'02:30','2026-03-08T08:00:00Z','2026-03-08T07:00:00.000Z'],
 ['America/New_York',0,'01:30','2026-11-01T07:00:00Z','2026-11-01T05:30:00.000Z'],
 ['Asia/Jerusalem',5,'02:30','2026-03-27T05:00:00Z','2026-03-27T00:00:00.000Z'],
 ['Asia/Jerusalem',0,'01:30','2026-10-25T03:00:00Z','2026-10-24T22:30:00.000Z']]) assert.equal(weeklyOccurrence(new Date(now),{timezone,weeklyDay,weeklyTime}).at,at);
});
test('weekly occurrence uses local week and previous occurrence before wall time',()=>{
 assert.deepEqual(weeklyOccurrence(new Date('2027-01-03T23:30:00Z'),{timezone:'Asia/Jerusalem',weeklyDay:1,weeklyTime:'01:00'}),{at:'2027-01-03T23:00:00.000Z',date:'2027-01-04',year:2027,week:1});
 assert.equal(weeklyOccurrence(new Date('2027-01-03T22:30:00Z'),{timezone:'Asia/Jerusalem',weeklyDay:1,weeklyTime:'01:00'}).date,'2026-12-28');
});
test('followed local schedule exact routes only, includes adjacent UTC week and preserves fallback type',async()=>{
 const calls=[]; const ctx={store:{read:async()=>null}, schedule:{resolve:async id=>id===1?{route:'exact'}:null,timetable:async(type,date)=>{calls.push(date); return [{route:'exact',title:'A',at:'2026-10-25T22:30:00Z',type:'raw'},{route:'other',title:'A',at:'2026-10-26T02:00:00Z',type:'sub'},{route:'exact',at:null,type:'sub'},{route:'exact',at:'2026-10-25T20:00:00Z',type:'sub'}];}}};
 const entries=await followedSchedule(ctx,'g',{1:{malId:1,type:'sub'},2:{malId:2,title:'A'}},{timezone:'Asia/Jerusalem'},{now:new Date('2026-10-26T08:00:00Z'),period:'today',type:'sub'});
 assert.equal(entries.length,1); assert.equal(entries[0].type,'raw'); assert.equal(entries[0].requestedType,'sub'); assert.ok(calls.length>=2);
});
test('all-type followed schedule requests each subscribed track and rejects unrelated tracks',async()=>{
 const tracks=[];const ctx={store:{read:async()=>null},schedule:{resolve:async id=>({route:`a${id}`}),timetable:async type=>{tracks.push(type);return [{route:'a1',at:'2026-10-26T12:00:00Z',type:'raw'},{route:'a2',at:'2026-10-26T12:00:00Z',type:'dub'}];}}};
 const entries=await followedSchedule(ctx,'g',{1:{malId:1,type:'sub'},2:{malId:2,type:'dub'}},{timezone:'Asia/Jerusalem'},{now:new Date('2026-10-26T08:00:00Z')});
 assert.deepEqual([...new Set(tracks)].sort(),['dub','sub']);assert.equal(entries.length,2);assert.equal(entries.find(e=>e.route==='a1').requestedType,'sub');
});

test('countdown combines unknown current entries with known next-week releases',async()=>{
 const {scheduleCommand}=await import('../src/services/anime/discoveryCommands.js');
 const future=new Date(Date.now()+3*86400000).toISOString(); let calls=0;
 const ctx={store:{read:async()=>null},schedule:{resolve:async()=>({route:'a'}),timetable:async()=>++calls===1?[{route:'a',type:'sub',episode:1,at:null,title:'Unknown'}]:[{route:'a',type:'sub',episode:2,at:future,title:'Known'}]}};
 const result=await scheduleCommand({guildId:'g',user:{id:'u'},options:{getString:key=>({anime:'1',type:'sub'})[key]}},ctx,{},true);
 assert.equal(calls,2);const description=result.embeds[0].data.description;assert.ok(description.indexOf('Known')<description.indexOf('Unknown'));
});
