import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { hasDangerousPermissions } from '../src/services/reactionRoleService.js';
import { handleReactionRolesSelectMenu } from '../src/handlers/interactionHandlers/reactionRolesSelectMenu.js';

test('moderator, event-host, and invite powers are protected from self-service role menus', () => {
  for (const bit of [P.ModerateMembers,P.ManageMessages,P.ManageThreads,P.ViewAuditLog,P.MoveMembers,P.MuteMembers,P.DeafenMembers,P.ManageEvents,P.CreateEvents,P.CreateInstantInvite]) {
    assert(hasDangerousPermissions({permissions:new PermissionsBitField(bit)}),`Privileged permission ${bit} must be protected`);
  }
  assert.equal(hasDangerousPermissions({permissions:new PermissionsBitField(0n)}),false);
});

test('an old menu cannot grant or remove a role that has since gained moderator powers', async () => {
  const roleId='100000000000000003', added=[];
  const oldRole={id:roleId,name:'Former interest role',managed:false,position:1,permissions:new PermissionsBitField(0n)};
  const freshRole={...oldRole,permissions:new PermissionsBitField(P.ModerateMembers)};
  const user={id:'100000000000000004',tag:'member'};
  const member={user,roles:{cache:new Collection(),add:async role=>added.push(role.id)}};
  let refreshed=false;
  const guild={members:{me:{permissions:new PermissionsBitField(P.ManageRoles),roles:{highest:{position:10}}}},roles:{cache:new Collection([[roleId,oldRole]]),fetch:async()=>{refreshed=true;return new Collection([[roleId,freshRole]]);}}};
  let reply;
  const interaction={deferred:true,inGuild:()=>true,guildId:'100000000000000001',guild,member,user,message:{id:'100000000000000002'},values:[roleId],editReply:async body=>{reply=body;}};
  const client={db:{get:async()=>({roles:[roleId]})}};
  await handleReactionRolesSelectMenu(interaction,client);
  assert.deepEqual(added,[]);
  assert(refreshed);
  assert(JSON.stringify(reply).includes('Skipped'));
  member.roles.cache.set(roleId,freshRole);
  let removed=false;member.roles.remove=async()=>{removed=true;};
  interaction.values=[];
  await handleReactionRolesSelectMenu(interaction,client);
  assert.equal(removed,false);
  assert(member.roles.cache.has(roleId));
});

test('cosmetic roles can still be selected and cleared after refreshing permissions', async () => {
  const guildId='100000000000000001',roleId='100000000000000003';
  const role={id:roleId,name:'Fantasy',managed:false,position:1,permissions:new PermissionsBitField(0n)};
  const assigned=new Collection(),available=new Collection([[roleId,role]]);
  const user={id:'100000000000000004',tag:'member'};
  const member={user,roles:{cache:assigned,add:async r=>assigned.set(r.id,r),remove:async r=>assigned.delete(r.id)}};
  const guild={id:guildId,members:{me:{permissions:new PermissionsBitField(P.ManageRoles),roles:{highest:{position:10}}}},roles:{cache:available,fetch:async()=>available}};
  const client={guilds:{cache:new Collection([[guildId,guild]])},db:{get:async key=>key.includes('reaction')?{roles:[roleId]}:{logging:{enabled:false}}}};
  const interaction={deferred:true,inGuild:()=>true,guildId,guild,member,user,message:{id:'100000000000000002'},values:[roleId],editReply:async()=>{}};
  await handleReactionRolesSelectMenu(interaction,client);assert(assigned.has(roleId));
  interaction.values=[];
  await handleReactionRolesSelectMenu(interaction,client);assert(!assigned.has(roleId));
});
