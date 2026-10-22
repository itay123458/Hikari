import test from 'node:test';
import assert from 'node:assert/strict';
import { testStore } from './helpers/database.js';
import { Tracking } from '../src/services/anime/tracking.js';
import { Community } from '../src/services/anime/community.js';
import { executeAnime, handleAnimeComponent, handleAnimeForm, handleAnimePublic } from '../src/services/anime/controller.js';
import { communityCommand, gamesCommand } from '../src/services/anime/communityCommands.js';
import { validateSettings } from '../src/services/anime/domain.js';
import { eraseUserData } from '../src/services/anime/communityViews.js';

async function fixture(t) {
  const store = await testStore(t);
  const jikan = { anime: async id => ({ mal_id: id, title: 'Example', episodes: 12, genres: [], studios: [], streaming: [] }) };
  const ctx = { store, jikan, tracking: new Tracking(store, jikan), community: new Community(store) };
  const config = { anime: validateSettings({}) };
  const member = { id: 'u1', permissions: { has: () => false } };
  const guild = { id: 'g', members: { fetch: async () => member } };
  const client = { animeServices: ctx, db: { get: async () => config }, guilds: { cache: new Map([['g', guild]]) } };
  const interaction = (options = {}, userId = 'u1') => ({
    user: { id: userId }, guildId: 'g', guild, channelId: 'c', deferred: false,
    options: { getSubcommandGroup: () => options.group, getSubcommand: () => options.sub, getString: name => options[name] ?? null, getInteger: name => options[name] ?? null, getNumber: name => options[name] ?? null, getBoolean: name => options[name] ?? null, getUser: name => options[name] ?? null },
    deferReply: async function(body) { this.deferred = true; this.flags = body.flags; },
    editReply: async function(body) { this.result = body; },
    reply: async function(body) { this.result = body; },
  });
  return { store, ctx, config, client, interaction, member, guild };
}

test('slash add and owned progress button change the actual private watchlist', async t => {
  const f = await fixture(t);
  const add = f.interaction({ group: 'list', sub: 'add', anime: '1', status: 'watching' });
  await executeAnime(add, null, f.client);
  assert.equal(add.flags, 64);
  assert.equal((await f.ctx.tracking.profile('u1')).list[1].status, 'watching');
  const session = await f.store.session({ ownerId: 'u1', guildId: 'g', kind: 'detail', module: 'discovery', animeId: 1 });
  const increment = f.interaction();
  await handleAnimeComponent(increment, f.client, [session, 'increment']);
  assert.equal((await f.ctx.tracking.profile('u1')).list[1].progress, 1);
});

test('another user and a revoked module cannot operate an old progress control', async t => {
  const f = await fixture(t);
  await f.ctx.tracking.add('u1', 1, 'watching');
  const session = await f.store.session({ ownerId: 'u1', guildId: 'g', kind: 'detail', module: 'discovery', animeId: 1 });
  const intruder = f.interaction({}, 'u2');
  await handleAnimeComponent(intruder, f.client, [session, 'increment']);
  assert.match(intruder.result.embeds[0].toJSON().description, /belongs/);
  f.config.anime.modules = ['discovery'];
  const disabled = f.interaction();
  await handleAnimeComponent(disabled, f.client, [session, 'increment']);
  assert.match(disabled.result.embeds[0].toJSON().description, /disabled/);
  assert.equal((await f.ctx.tracking.profile('u1')).list[1].progress, 0);
});

test('episode notes stay private through real form handling and reject owner forgery', async t => {
  const f = await fixture(t);
  await f.ctx.tracking.add('u1', 1);
  const session = await f.store.session({ ownerId: 'u1', guildId: 'g', kind: 'note', module: 'tracking', animeId: 1, episode: 2 });
  const forged = f.interaction({}, 'u2'); forged.fields = { getTextInputValue: () => 'stolen' };
  await handleAnimeForm(forged, f.client, [session, 'note']);
  assert.equal((await f.ctx.tracking.profile('u2')).notes['1:2'], undefined);
  const own = f.interaction(); own.fields = { getTextInputValue: () => 'private secret' };
  await handleAnimeForm(own, f.client, [session, 'note']);
  assert.equal((await f.ctx.tracking.profile('u1')).notes['1:2'], 'private secret');
  assert.equal(own.flags, 64);
  assert.equal(JSON.stringify(own.result).includes('private secret'), false);
});

test('review text is absent until explicit private spoiler confirmation', async t => {
  const f = await fixture(t);
  const review = await f.ctx.community.review('g', 'author', { animeId: 1, episode: 9, rating: 8, spoiler: true, text: 'SECRET ENDING' });
  const session = await f.store.session({ ownerId: 'u1', guildId: 'g', kind: 'reviews', module: 'community', animeId: 1, reviewIds: [review.id] });
  const read = f.interaction();
  await handleAnimeComponent(read, f.client, [session, `review-${review.id}`]);
  assert.equal(JSON.stringify(read.result).includes('SECRET ENDING'), false);
  assert.match(read.result.embeds[0].toJSON().description, /recorded progress/);
  const revealId = read.result.components[0].toJSON().components[0].custom_id.split(':')[1];
  const confirmed = f.interaction();
  await handleAnimeComponent(confirmed, f.client, [revealId, 'reveal']);
  assert.match(confirmed.result.embeds[0].toJSON().description, /SECRET ENDING/);
  assert.equal(confirmed.flags, 64);
});

test('public vote rejects a copied control and stores a real vote on the original post', async t => {
  const f = await fixture(t);
  const poll = await f.ctx.community.pollCreate('g', 'owner', 'Choose', ['A', 'B'], Date.now() + 60000);
  await f.ctx.community.edit('g', g => { Object.assign(g.polls[poll.id], { messageId: 'original', channelId: 'c' }); return g; });
  const forged = f.interaction(); forged.message = { id: 'copied' }; forged.values = ['1'];
  await handleAnimePublic(forged, f.client, ['poll', poll.id]);
  assert.equal(Object.keys((await f.ctx.community.guild('g')).polls[poll.id].votes).length, 0);
  const own = f.interaction(); own.message = { id: 'original' }; own.values = ['1'];
  await handleAnimePublic(own, f.client, ['poll', poll.id]);
  assert.equal((await f.ctx.community.guild('g')).polls[poll.id].votes.u1, 1);
  assert.match(own.result.embeds[0].toJSON().title, /Vote saved/);
});

test('private bracket snapshots link to working public controls', async t => {
  const f = await fixture(t);
  const bracket = await f.ctx.community.tournamentCreate('g', 'u1', [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }, { id: 4, name: 'D' }]);
  await f.ctx.community.edit('g', g => { Object.assign(g.tournaments[bracket.id], { messageId: 'original', channelId: 'c' }); return g; });
  const body = await gamesCommand(f.interaction({ id: bracket.id }), f.ctx, f.config.anime, 'bracket', f.member);
  assert.deepEqual(body.components, []);
  assert.match(JSON.stringify(body.embeds[0].toJSON()), /original/);
});

test('unreadable guild settings fail closed instead of enabling disabled controls', async t => {
  const f = await fixture(t);
  await f.ctx.tracking.add('u1', 1);
  const session = await f.store.session({ ownerId: 'u1', guildId: 'g', kind: 'detail', module: 'discovery', animeId: 1 });
  f.client.db.get = async () => { throw new Error('temporary database read failure'); };
  await handleAnimeComponent(f.interaction(), f.client, [session, 'increment']);
  assert.equal((await f.ctx.tracking.profile('u1')).list[1].progress, 0);
});

test('erasure captures a concurrent winner under its database lock for public cleanup', async t => {
  const f = await fixture(t);
  const game = await f.ctx.community.gameCreate('g', 'someone-else', { mal_id: 1, title: 'Example', genres: [], studios: [] }, 'clues');
  await f.ctx.community.edit('g', g => { Object.assign(g.games[game.id], { messageId: 'original', channelId: 'c' }); return g; });
  const erase = f.store.eraseUser.bind(f.store);
  f.store.eraseUser = async userId => {
    // The win arrives after cleanup starts, immediately before erasure locks.
    await f.ctx.community.answer('g', game.id, 'u1', 'Example');
    return erase(userId);
  };
  const unavailable = await eraseUserData(f.ctx, { guilds: { cache: new Map() } }, 'u1');
  assert.equal((await f.ctx.community.guild('g')).games[game.id].winnerId, null);
  assert.equal(unavailable, 1, 'The unavailable public post must be reported, not silently omitted');
});
