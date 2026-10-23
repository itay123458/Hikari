import { createHash } from 'node:crypto';
import { releaseDate, safeUrl } from './providers.js';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,24);
const categories = ['news','trailers','sequels','dates','status'];
const dateText = value => value?.value || 'unknown (no release date confirmed)';

// All provider I/O precedes the guild lock. Snapshot and outbox updates commit
// together under the same lock used to remove or replace subscriptions.
export async function reconcileFeeds(ctx, guildId, follow, settings, now = new Date()) {
 const {jikan,store}=ctx;
 const anime=await jikan.anime(follow.malId);
 const relations=new Map((anime.relations||[]).flatMap(r=>(r.entry||[]).filter(e=>e.type==='anime' && Number(e.mal_id)!==Number(follow.malId)).map(e=>[String(e.mal_id),{...e,relation:r.relation}])));
 const related={};
 for (const [id,relation] of relations) { const data=await jikan.anime(Number(id)); related[id]={title:data.title||relation.name||'Related anime',type:data.type||'anime',relation:relation.relation,date:releaseDate(data.aired)}; }
 const news=settings.news ? await jikan.resource(follow.malId,'news') : null;
 const videos=settings.trailers ? await jikan.resource(follow.malId,'videos') : null;
 const articles=(news||[]).map(n=>({...n,url:safeUrl(n.url)})).filter(n=>n.url);
 const trailers=(videos?.promo||[]).map(v=>({...v,url:safeUrl(v.trailer?.url,['youtube.com','youtu.be']),id:v.trailer?.youtube_id||v.trailer?.url})).filter(v=>v.id&&v.url);
 return store.withDocument('guild',guildId,async(tx,current)=>{
  const fresh=current.follows?.[follow.malId];
  if(!fresh||fresh.sinceAt!==follow.sinceAt) return;
  const snapshotId=`${guildId}:${follow.malId}`, previous=await tx.read('feed-snapshot',snapshotId);
  const old=previous?.sinceAt===follow.sinceAt?previous:null;
  const next={sinceAt:follow.sinceAt,date:releaseDate(anime.aired),status:anime.status||null,related,news:news ? articles.map(n=>n.url):null,trailers:videos?trailers.map(v=>v.id):null};
  const allowed=settings.feedCategories||categories;
  const emit=async(identity,title,description,source,feedType,publishedAt=null)=>{
   if(!source||!allowed.includes(feedType)||fresh.changes===false) return;
   const sourceKey=`${guildId}:${hash(identity)}`;
   await tx.mutate('feed-source',sourceKey, state=>({...state,subscriptions:{...state.subscriptions,[follow.malId]:follow.sinceAt}}));
   await tx.enqueue(`feed:${sourceKey}`,'feed',{guildId,malId:follow.malId,sinceAt:follow.sinceAt,title,description,source,sourceKey,feedType,createdAt:now.toISOString(),publishedAt},now);
  };
  // Transition counters are destination/object scoped, avoiding hash-of-state
  // suppression when an announced date or status changes A -> B -> A -> B.
  const transition=async(identity,value,title,description,source,type)=>{
   let revision;
   await tx.mutate('feed-transition',`${guildId}:${identity}`, state=>{
    revision=(state.revision||0)+(JSON.stringify(state.value)===JSON.stringify(value)?0:1);
    return {value,revision};
   });
   await emit(`${identity}:${revision}`,title,description,source,type);
  };
  if(old){
   const source=`https://myanimelist.net/anime/${follow.malId}`;
   if(JSON.stringify(old.date)!==JSON.stringify(next.date)) await transition(`date:${follow.malId}`,next.date,`${anime.title} · release date update`,`MAL release date changed from ${dateText(old.date)} to ${dateText(next.date)}. Date precision: ${next.date.precision}.`,source,'dates');
   if(old.status!==next.status) await transition(`status:${follow.malId}`,next.status,`${anime.title} · status update`,`Provider status changed from ${old.status||'unknown'} to ${next.status||'unknown'}.`,source,'status');
   for(const [id,item] of Object.entries(related)){
    const prior=old.related?.[id];
    if(!prior) await emit(`relation:${id}`,`Related ${item.type} listed: ${item.title}`,`MAL relation: ${item.relation}. Release date: ${dateText(item.date)}.`, `https://myanimelist.net/anime/${id}`,'sequels');
    else if(JSON.stringify(prior.date)!==JSON.stringify(item.date)) await transition(`date:${id}`,item.date,`${item.title} · release date update`,`MAL release date changed from ${dateText(prior.date)} to ${dateText(item.date)}. Date precision: ${item.date.precision}.`,`https://myanimelist.net/anime/${id}`,'dates');
   }
   if(old.news) for(const article of articles.filter(n=>!old.news.includes(n.url))){
    const at=Date.parse(article.date);
    if(!Number.isFinite(at)||at<Math.max(Date.parse(follow.sinceAt),+now-86400000)||at>+now) continue;
    await emit(`news:${article.url}`,article.title,'New unclassified source article for a followed anime. Jikan supplies no article categories. The article may contain spoilers.',article.url,'news',new Date(at).toISOString());
   }
   if(old.trailers) for(const video of trailers.filter(v=>!old.trailers.includes(v.id))) await emit(`trailer:${video.id}`,`${anime.title} · ${video.title||'Trailer'}`,'Promotional video newly observed in the MAL listing. Publication date is unknown. May contain spoilers.',video.url,'trailers');
  }
  // Add every current source association, including existing/baselined sources,
  // so a shared job survives the first anime being unfollowed before delivery.
  for(const identity of [...Object.keys(related).map(id=>`relation:${id}`),...articles.map(a=>`news:${a.url}`),...trailers.map(v=>`trailer:${v.id}`)]) await tx.mutate('feed-source',`${guildId}:${hash(identity)}`,s=>({...s,subscriptions:{...s.subscriptions,[follow.malId]:follow.sinceAt}}));
  await tx.mutate('feed-snapshot',snapshotId,()=>next);
 });
}
