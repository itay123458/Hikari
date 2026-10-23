import test from 'node:test';
import assert from 'node:assert/strict';
import { alertCommand } from '../src/services/anime/alertCommands.js';
import { adminCommand } from '../src/services/anime/adminCommands.js';
import { validateSettings } from '../src/services/anime/domain.js';
const options=values=>({getString:n=>values[n]??null,getBoolean:n=>values[n]??null,getRole:()=>null});
test('follow preferences default on and explicit opt outs persist',async()=>{
 let profile={follows:{}};const ctx={jikan:{anime:async()=>({title:'A'})},tracking:{edit:async(id,fn)=>{profile=fn(profile);}},schedule:{resolve:async()=>null},store:{read:async()=>null}};
 await alertCommand({options:options({anime:'1',episodes:false,changes:false}),user:{id:'u'},guildId:'g'},ctx,validateSettings({}),'follow',{});
 assert.equal(profile.follows[1].episodes,false);assert.equal(profile.follows[1].changes,false);
 await alertCommand({options:options({anime:'2'}),user:{id:'u'},guildId:'g'},ctx,validateSettings({}),'follow',{});
 assert.equal(profile.follows[2].episodes,true);assert.equal(profile.follows[2].changes,true);
});
test('administrator preview reads shared schedule without posting, sessions, mutation or mentions',async()=>{
 const body=await adminCommand({options:options({}),guildId:'g'},null,{community:{guild:async()=>({follows:{}})},store:{read:async()=>null}},validateSettings({}),'preview');
 assert.deepEqual(body.allowedMentions,{parse:[]}); assert.match(body.embeds[0].data.description,/preview|follow|token/i);
});
test('missing schedule token preview explains configuration while remaining read-only',async()=>{
 const body=await adminCommand({options:options({}),guildId:'g'},null,{schedule:{token:''},community:{guild:async()=>({follows:{1:{malId:1}}})}},validateSettings({}),'preview');
 assert.match(body.embeds[0].data.description,/ANIMESCHEDULE_TOKEN/);assert.match(body.embeds[0].data.description,/Discovery/);assert.deepEqual(body.allowedMentions,{parse:[]});
});
