import test from 'node:test';
import assert from 'node:assert/strict';
import { testStore } from './helpers/database.js';
import { AnimePlanner } from '../src/services/anime/planner.js';
import { AnimeWorker } from '../src/services/anime/worker.js';
import { Community } from '../src/services/anime/community.js';
import { Tracking } from '../src/services/anime/tracking.js';

test('restart catch-up includes the previous UTC week on Monday', async () => {
  const requested = [];
  const planner = new AnimePlanner({}, { schedule: { timetable: async (_, date) => { requested.push(date.toISOString()); return []; } } }, () => new Date('2026-10-26T01:00:00Z'));
  await planner.timetables();
  assert.ok(requested.some(d => d.startsWith('2026-10-25')));
});

test('schedule changes retain absent delayed episodes and repeated transitions have distinct jobs', async t => {
  const store = await testStore(t), now = new Date('2026-10-23T12:00:00Z');
  const planner = new AnimePlanner({}, { store }, () => now);
  const follow = { malId: 1, type: 'sub', sinceAt: '2026-10-01T00:00:00Z' };
  const event = { type: 'sub', episode: 2, at: '2026-10-24T12:00:00Z', delay: null, title: 'Exact season' };
  await planner.commitFollow(store, 'g', follow, [event], null);
  for (const delay of ['Delayed', null, 'Delayed']) await planner.commitFollow(store, 'g', follow, [{ ...event, delay }], null);
  assert.equal((await store.pool.query("SELECT count(*) n FROM anime_jobs WHERE kind='update'")).rows[0].n, 3);
  await planner.commitFollow(store, 'g', follow, [], null);
  assert.ok((await store.read('schedule-snapshot', 'guild-g:1'))['sub:2']);
});

test('episode and change preferences suppress their jobs independently', async t => {
  const store = await testStore(t), planner = new AnimePlanner({}, { store }, () => new Date('2026-10-23T12:00:00Z'));
  const follow = { malId: 1, type: 'sub', episodes: false, changes: false, sinceAt: '2026-10-01T00:00:00Z' };
  const event = { type: 'sub', episode: 2, at: '2026-10-24T12:00:00Z', delay: null };
  await planner.commitFollow(store, 'g', follow, [event], null);
  await planner.commitFollow(store, 'g', follow, [{ ...event, delay: 'Delayed' }], null);
  assert.equal((await store.pool.query('SELECT count(*) n FROM anime_jobs')).rows[0].n, 0);
});

test('a private follow moved to another guild invalidates the old delivery', async t => {
  const store = await testStore(t), tracking = new Tracking(store, {}), community = new Community(store);
  await tracking.edit('u', p => { p.follows[1] = { malId: 1, guildId: 'new', type: 'sub' }; return p; });
  const worker = new AnimeWorker({}, { store, tracking, community });
  assert.equal(await worker.follow({ payload: { guildId: 'old', userId: 'u', malId: 1 } }), null);
});

test('changes respect updated release preferences before requesting providers', async t => {
  const store = await testStore(t), community = new Community(store);
  await community.edit('g', g => { g.follows[1] = { malId: 1, type: 'dub' }; return g; });
  const worker = new AnimeWorker({}, { store, community });
  worker.currentEvent = () => { throw new Error('should not request provider'); };
  const job = await store.enqueue('oldsubchange', 'update', { guildId: 'g', malId: 1, type: 'sub' }, new Date());
  await worker.handleUpdate(job, {});
  assert.equal((await store.pool.query('SELECT state FROM anime_jobs WHERE id=$1', [job.id])).rows[0].state, 'canceled');
});

test('transient pre-send member errors stay retryable rather than canceling the job', async t => {
  const store = await testStore(t);
  const error = Object.assign(new Error('temporary'), { code: 'ECONNRESET' });
  const worker = new AnimeWorker({ guilds: { cache: new Map([['g', { members: { fetch: async () => { throw error; } } }]]) } }, { store });
  const job = await store.enqueue('dm', 'episode', { guildId: 'g', userId: 'u' }, new Date());
  await assert.rejects(worker.send(job, {}, { content: 'test' }), { code: 'ECONNRESET' });
  assert.equal(await store.delivery(job.id), null);
});

for (const kind of ['episode', 'update']) for (const change of ['remove','preferences','guild']) test(`${kind} rechecks ${change} after provider IO`, async t => {
 const store=await testStore(t), tracking=new Tracking(store,{}), community=new Community(store);
 const follow={malId:1,guildId:'g',type:'sub',sinceAt:'2026-10-01T00:00:00Z'};
 await tracking.edit('u',p=>{p.follows[1]=follow;return p;});
 let sends=0; const channel={id:'dm',send:async()=>{sends++;return{id:'m'};}};
 const client={user:{id:'bot'},guilds:{cache:new Map([['g',{members:{fetch:async()=>({user:{createDM:async()=>channel}})}}]])}};
 const worker=new AnimeWorker(client,{store,tracking,community},{now:()=>new Date('2026-10-23T12:00:00Z')});
 const event={type:'sub',episode:1,at:'2026-10-23T11:00:00Z',title:'A',source:'https://animeschedule.net'};
 worker.currentEvent=async()=>{await tracking.edit('u',p=>{if(change==='remove')delete p.follows[1];else if(change==='guild')p.follows[1].guildId='other';else p.follows[1][kind==='episode'?'episodes':'changes']=false;return p;});return event;};
 const job=await store.enqueue(`${kind}-${change}`,kind,{guildId:'g',userId:'u',malId:1,sinceAt:follow.sinceAt,...event},new Date());
 await worker[kind==='episode'?'handleEpisode':'handleUpdate'](job,{});
 assert.equal(sends,0); assert.equal(await store.delivery(job.id),null);
});

test('weekly planner replacement survives a same-day wall-time change; worker cancels old occurrence',async t=>{
 const store=await testStore(t),community=new Community(store),tracking=new Tracking(store,{});
 let settings={enabled:true,modules:['announcements'],notifications:true,weekly:true,scheduleChannel:'c',timezone:'UTC',weeklyDay:1,weeklyTime:'09:00',weeklyType:'all'};
 const client={guilds:{cache:new Map([['g',{id:'g'}]])}};
 const ctx={store,community,tracking,schedule:{timetable:async()=>[]}};
 const planner=new AnimePlanner(client,ctx,()=>new Date('2026-10-26T10:30:00Z'));planner.settings=async()=>settings;
 await planner.reconcile(); settings={...settings,weeklyTime:'10:00'};await planner.reconcile();
 const jobs=(await store.pool.query("SELECT * FROM anime_jobs WHERE kind='weekly' ORDER BY run_at")).rows;
 assert.equal(jobs.length,2);
 const worker=new AnimeWorker(client,ctx,{now:()=>new Date('2026-10-26T10:30:00Z')});let sends=0;worker.send=async()=>{sends++;};
 await worker.handleWeekly(jobs[0],settings);await worker.handleWeekly(jobs[1],settings);assert.equal(sends,1);
 assert.equal((await store.pool.query('SELECT state FROM anime_jobs WHERE id=$1',[jobs[0].id])).rows[0].state,'canceled');
});

test('weekly worker retains a quiet-hour deferral across ISO weeks and stops at 24 hours',async t=>{
 const store=await testStore(t),community=new Community(store);let now=new Date('2027-01-03T23:00:00Z');
 const settings={weekly:true,timezone:'UTC',weeklyDay:0,weeklyTime:'23:00',quietStart:'22:00',quietEnd:'01:00'};
 const worker=new AnimeWorker({}, {store,community},{now:()=>now});let sends=0;worker.send=async()=>{sends++;};
 const {weeklyOccurrence}=await import('../src/services/anime/schedules.js'); const payload={guildId:'g',...weeklyOccurrence(now,settings)};
 const job=await store.enqueue('weekly-bound','weekly',payload,now);
 assert.equal(await worker.quiet(job,settings),true);now=new Date('2027-01-04T01:00:00Z');await worker.handleWeekly(job,settings);assert.equal(sends,1);
 now=new Date('2027-01-04T23:00:00Z');await worker.handleWeekly(job,settings);assert.equal(sends,1);
 assert.equal((await store.pool.query('SELECT state FROM anime_jobs WHERE id=$1',[job.id])).rows[0].state,'canceled');
});

for(const kind of ['episode','update','feed'])test(`${kind} admission follows DM preparation and uses locked transaction`,async t=>{
 const store=await testStore(t),tracking=new Tracking(store,{});const follow={malId:1,guildId:'g',type:'sub',sinceAt:'2026-10-01T00:00:00Z'};
 await tracking.edit('u',p=>{p.follows[1]=follow;return p;});let sends=0;
 const channel={id:'dm',send:async()=>{sends++;return{id:'m'};}};
 const client={user:{id:'bot'},guilds:{cache:new Map([['g',{members:{fetch:async()=>({user:{createDM:async()=>{await tracking.edit('u',p=>{delete p.follows[1];return p;});return channel;}}})}}]])}};
 const worker=new AnimeWorker(client,{store,tracking});const job=await store.enqueue(`prep-${kind}`,kind,{guildId:'g',userId:'u',malId:1,type:'sub',sinceAt:follow.sinceAt,at:'2026-10-23T11:00:00Z'},new Date());
 await worker.send(job,{},{});assert.equal(sends,0);assert.equal(await store.delivery(job.id),null);
});

test('feed final admission accepts remaining shared subscription and commits its intent before sending',async t=>{
 const store=await testStore(t),community=new Community(store);await community.edit('g',g=>{g.follows[3]={malId:3,sinceAt:'s3'};return g;});
 await store.mutate('feed-source','shared',()=>({subscriptions:{1:'s1',3:'s3'}}));
 let inLock=false,sends=0;const original=store.withDocument.bind(store);store.withDocument=async(...args)=>original(args[0],args[1],async(tx,current)=>{inLock=true;try{return await args[2](tx,current);}finally{inLock=false;}});
 const permission={has:()=>true};const channel={id:'c',isTextBased:()=>true,isDMBased:()=>false,permissionsFor:()=>permission,send:async()=>{assert.equal(inLock,false);assert.ok(await store.delivery(job.id));sends++;return{id:'m'};}};
 const guild={id:'g',members:{fetchMe:async()=>({})},channels:{fetch:async()=>channel}};
 const worker=new AnimeWorker({user:{id:'bot'},guilds:{cache:new Map([['g',guild]])}},{store,community});
 const job=await store.enqueue('shared-delivery','feed',{guildId:'g',malId:1,sinceAt:'s1',sourceKey:'shared',feedType:'sequels'},new Date());
 await worker.send(job,{announcementChannel:'c'},{});assert.equal(sends,1);assert.equal((await store.delivery(job.id)).state,'sent');
});
