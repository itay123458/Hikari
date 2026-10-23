import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTimetable, releaseDate } from '../src/services/anime/providers.js';
import { reconcileFeeds } from '../src/services/anime/feeds.js';

test('documented batch range and delay fields survive normalization', () => {
 const [row] = normalizeTimetable([{route:'a',airType:'raw',episodeNumber:12,subtractedEpisodeNumber:7,status:'Delayed',delayedFrom:'2026-10-20T00:00:00Z',delayedUntil:null}]);
 assert.equal(row.episodeStart,7); assert.equal(row.episodeEnd,12); assert.equal(row.status,'Delayed'); assert.ok(row.delay); assert.equal(row.delayedFrom,'2026-10-20T00:00:00.000Z');
});
test('Jikan release precision never turns year-only into January first', () => {
 assert.deepEqual(releaseDate({from:'2027-01-01T00:00:00Z',prop:{from:{year:2027,month:null,day:null}}}),{precision:'year',value:'2027'});
 assert.deepEqual(releaseDate({prop:{from:{year:2027,month:4,day:null}}}),{precision:'month',value:'2027-04'});
 assert.deepEqual(releaseDate({}),{precision:'unknown',value:null});
});
function fixture() {
 const docs = new Map(), jobs = new Map();
 const follow={malId:1,sinceAt:'2026-10-22T00:00:00Z'}; let anime={mal_id:1,title:'A',status:'Upcoming',aired:{},relations:[{relation:'Sequel',entry:[{type:'anime',mal_id:2}]}]}; let related={mal_id:2,title:'B',type:'Movie',aired:{}}; let news=[],promo=[];
 docs.set('guild:g',{follows:{1:follow,3:{...follow,malId:3}}});
 const store={read:async(s,id,f=null)=>structuredClone(docs.get(`${s}:${id}`)??f),mutate:async(s,id,fn)=>{const value=await fn(structuredClone(docs.get(`${s}:${id}`)??{}));docs.set(`${s}:${id}`,value);return value;},enqueue:async(k,kind,payload)=>{if(!jobs.has(k))jobs.set(k,{kind,payload});},withDocument:async(s,id,fn)=>fn(store,docs.get(`${s}:${id}`))};
 const ctx={store,jikan:{anime:async id=>structuredClone(id===2?related:anime),resource:async(id,part)=>structuredClone(part==='news'?news:{promo})}};
 return {ctx,follow,jobs,docs,setAnime:v=>anime={...anime,...v},setRelated:v=>related={...related,...v},setNews:v=>news=v,setPromo:v=>promo=v};
}
const now=new Date('2026-10-23T12:00:00Z'), settings={news:true,trailers:true};
test('baseline suppresses history, then detects root/related date changes and repeated transitions',async()=>{
 const f=fixture(); await reconcileFeeds(f.ctx,'g',f.follow,settings,now); assert.equal(f.jobs.size,0);
 f.setRelated({aired:{prop:{from:{year:2027,month:null,day:null}}}}); await reconcileFeeds(f.ctx,'g',f.follow,settings,now); assert.equal(f.jobs.size,1); assert.match([...f.jobs.values()][0].payload.description,/2027/);
 f.setAnime({status:'Airing',aired:{prop:{from:{year:2026,month:11,day:2}}}}); await reconcileFeeds(f.ctx,'g',f.follow,settings,now);
 f.setAnime({status:'Upcoming'}); await reconcileFeeds(f.ctx,'g',f.follow,settings,now);
 f.setAnime({status:'Airing'}); await reconcileFeeds(f.ctx,'g',f.follow,settings,now);
 assert.equal([...f.jobs.values()].filter(j=>j.payload.feedType==='status').length,3);
});
test('same source article dedupes across follows; trailers do not invent dates',async()=>{
 const f=fixture(); await reconcileFeeds(f.ctx,'g',f.follow,settings,now); await reconcileFeeds(f.ctx,'g',{...f.follow,malId:3},settings,now);
 f.setNews([{mal_id:55,title:'News',url:'https://myanimelist.net/news/55',date:'2026-10-23T11:00:00Z'}]); f.setPromo([{title:'PV',trailer:{youtube_id:'abc',url:'https://youtube.com/watch?v=abc'}}]);
 await reconcileFeeds(f.ctx,'g',f.follow,settings,now); await reconcileFeeds(f.ctx,'g',{...f.follow,malId:3},settings,now);
 assert.equal(f.jobs.size,2); const article=[...f.jobs.values()].find(j=>j.payload.feedType==='news'); assert.match(article.payload.description,/unclassified/i);
 const video=[...f.jobs.values()].find(j=>j.payload.feedType==='trailers'); assert.equal(video.payload.publishedAt,null);
});
test('unfollow during provider fetch prevents snapshot and enqueue',async()=>{
 const f=fixture(); const original=f.ctx.jikan.anime; f.ctx.jikan.anime=async id=>{ f.docs.get('guild:g').follows={}; return original(id); };
 await reconcileFeeds(f.ctx,'g',f.follow,settings,now); assert.equal(f.docs.has('feed-snapshot:g:1'),false);
});
test('structured filters select dates without misclassifying source news',async()=>{
 const f=fixture(); const filters={...settings,feedCategories:['dates']}; await reconcileFeeds(f.ctx,'g',f.follow,filters,now);
 f.setRelated({aired:{prop:{from:{year:2028,month:3,day:null}}}}); f.setAnime({status:'Airing'}); f.setNews([{title:'Movie release date!',url:'https://myanimelist.net/news/77',date:'2026-10-23T11:00:00Z'}]);
 await reconcileFeeds(f.ctx,'g',f.follow,filters,now); assert.equal(f.jobs.size,1); assert.equal([...f.jobs.values()][0].payload.feedType,'dates');
});
test('new related movie announces explicit unknown date and re-follow starts a baseline',async()=>{
 const f=fixture(); f.setAnime({relations:[]}); await reconcileFeeds(f.ctx,'g',f.follow,settings,now);
 f.setAnime({relations:[{relation:'Sequel',entry:[{type:'anime',mal_id:2}]}]}); await reconcileFeeds(f.ctx,'g',f.follow,settings,now);
 assert.match([...f.jobs.values()][0].payload.description,/unknown/); assert.equal([...f.jobs.values()][0].payload.feedType,'sequels');
 f.follow.sinceAt='2026-10-23T10:00:00Z'; f.setAnime({status:'Finished'}); await reconcileFeeds(f.ctx,'g',f.follow,settings,now); assert.equal(f.jobs.size,1);
});
test('shared source remembers the second subscription if the first is removed',async()=>{
 const f=fixture(); await reconcileFeeds(f.ctx,'g',f.follow,settings,now); await reconcileFeeds(f.ctx,'g',{...f.follow,malId:3},settings,now);
 f.setNews([{title:'Shared',url:'https://myanimelist.net/news/99',date:'2026-10-23T11:00:00Z'}]); await reconcileFeeds(f.ctx,'g',f.follow,settings,now); await reconcileFeeds(f.ctx,'g',{...f.follow,malId:3},settings,now);
 const {payload}= [...f.jobs.values()][0]; assert.deepEqual(Object.keys(f.docs.get(`feed-source:${payload.sourceKey}`).subscriptions),['1','3']);
});

test('two baselined roots gaining the same related movie share one job and both associations',async()=>{
 const f=fixture(); f.setAnime({relations:[]});
 await reconcileFeeds(f.ctx,'g',f.follow,settings,now); await reconcileFeeds(f.ctx,'g',{...f.follow,malId:3},settings,now);
 f.setAnime({relations:[{relation:'Sequel',entry:[{type:'anime',mal_id:2}]}]});
 await reconcileFeeds(f.ctx,'g',f.follow,settings,now); await reconcileFeeds(f.ctx,'g',{...f.follow,malId:3},settings,now);
 assert.equal(f.jobs.size,1);const {payload}=[...f.jobs.values()][0]; assert.deepEqual(Object.keys(f.docs.get(`feed-source:${payload.sourceKey}`).subscriptions),['1','3']);
});
