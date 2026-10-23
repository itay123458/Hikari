import { localDate, isoWeek } from './domain.js';
import { resolveMapping } from './providers.js';
const wallCache = new Map();
const calendarDate = date => new Date(`${date}T12:00:00Z`);
function shiftDate(date, days) { const d=calendarDate(date); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
// Search absolute minutes in chronological order: folds choose the first instant;
// gaps choose the first valid local minute after the requested wall time.
function wallInstant(date, time, timezone) {
 const key=`${timezone}:${date}:${time}`; if(wallCache.has(key)) return new Date(wallCache.get(key));
 const dateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});
 const timeFormat=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const center=+calendarDate(date); let next=null;
 for(let at=center-30*3600000;at<=center+30*3600000;at+=60000){
  const instant=new Date(at), day=dateFormat.format(instant);
  if(day===date && timeFormat.format(instant)>=time){next=instant;break;}
 }
 if(!next) throw new Error('The configured local date has no valid scheduled minute.');
 if(wallCache.size>=512) wallCache.delete(wallCache.keys().next().value); wallCache.set(key,+next);
 return next;
}
export function weeklyOccurrence(now, settings) {
 now=new Date(now); const {timezone='Asia/Jerusalem',weeklyDay=1,weeklyTime='09:00'}=settings;
 const today=localDate(now,timezone), day=calendarDate(today).getUTCDay();
 let date=shiftDate(today,-((day-weeklyDay+7)%7)), instant=wallInstant(date,weeklyTime,timezone);
 if(instant>now){date=shiftDate(date,-7);instant=wallInstant(date,weeklyTime,timezone);}
 return {at:instant.toISOString(),date,...isoWeek(calendarDate(date))};
}
export async function followedSchedule(ctx,guildId,follows,settings,{now=new Date(),period='week',type='all'}={}) {
 if(!ctx.store) throw new Error('Followed schedules require the persistent database.');
 const today=localDate(new Date(now),settings.timezone), day=calendarDate(today).getUTCDay();
 const start=period==='today'?today:shiftDate(today,-((day+6)%7));
 const end=shiftDate(start,period==='today'?1:7);
 const routes=new Map();
 for(const follow of Object.values(follows||{})){
  if(follow.guildId && follow.guildId!==guildId) continue;
  const mapping=await resolveMapping(ctx.store,ctx.schedule,guildId,follow.malId);
  if(mapping?.route) routes.set(mapping.route,follow);
 }
 if(!routes.size) return [];
 // Local week edges can lie in an adjacent UTC ISO week.
 const weeks=new Map();
 for(const date of [start,shiftDate(start,-1),end]){const d=calendarDate(date);const w=isoWeek(d);weeks.set(`${w.year}:${w.week}`,d);}
 const tracks=type==='all'?[...new Set([...routes.values()].map(f=>f.type||'all'))]:[type];
 const rows=(await Promise.all(tracks.flatMap(track=>[...weeks.values()].map(async date=>(await ctx.schedule.timetable(track,date)).map(entry=>({...entry,requestedType:track})))))).flat();
 const seen=new Set();
 return rows.filter(entry=>{
  if(!routes.has(entry.route)||!entry.at) return false;
  if(type==='all' && entry.requestedType!==(routes.get(entry.route).type||'all')) return false;
  const date=localDate(new Date(entry.at),settings.timezone); if(date<start||date>=end)return false;
  const key=JSON.stringify([entry.route,entry.type,entry.episode,entry.at]);if(seen.has(key))return false;seen.add(key);return true;
 }).sort((a,b)=>a.at.localeCompare(b.at));
}
