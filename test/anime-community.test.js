import test from 'node:test';
import assert from 'node:assert/strict';
import { testStore } from './helpers/database.js';
import { Community } from '../src/services/anime/community.js';

test('party mutations require owner or manager, RSVP persists and canceled parties reject RSVP', async t => {
  const service = new Community(await testStore(t));
  const party = await service.partyCreate('g', 'owner', { animeId: 1, title: 'Bebop', startsAt: new Date(Date.now() + 3600000).toISOString(), channelId: 'c' });
  await assert.rejects(service.partyEdit('g', party.id, 'intruder', false, { canceled: true }), /owner/);
  await service.rsvp('g', party.id, 'guest', 'yes');
  assert.equal((await service.guild('g')).parties[party.id].rsvps.guest, 'yes');
  await service.partyEdit('g', party.id, 'owner', false, { canceled: true });
  await assert.rejects(service.rsvp('g', party.id, 'guest', 'yes'), /canceled/);
});

test('poll votes are one per member and invalid/expired options never count', async t => {
  const service = new Community(await testStore(t));
  const poll = await service.pollCreate('g', 'owner', 'Choose', ['A', 'B'], Date.now() + 3600000);
  await Promise.all([service.pollVote('g', poll.id, 'u', 0), service.pollVote('g', poll.id, 'u', 1)]);
  const saved = (await service.guild('g')).polls[poll.id];
  assert.equal(Object.keys(saved.votes).length, 1);
  assert.equal(saved.votes.u, 1);
  await assert.rejects(service.pollVote('g', poll.id, 'u', 2), /option/);
});

test('tournament bracket advances persistently and old match buttons cannot vote again', async t => {
  const service = new Community(await testStore(t));
  const bracket = await service.tournamentCreate('g', 'owner', [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }, { id: 4, name: 'D' }]);
  await service.tournamentVote('g', bracket.id, 'u', 0, 0, 1);
  await service.tournamentAdvance('g', bracket.id, 'owner', false);
  await assert.rejects(service.tournamentVote('g', bracket.id, 'u', 0, 0, 0), /match/);
  await service.tournamentAdvance('g', bracket.id, 'owner', false);
  let saved = (await service.guild('g')).tournaments[bracket.id];
  assert.equal(saved.round, 1);
  assert.equal(saved.matches[0][0].name, 'B');
  await service.tournamentAdvance('g', bracket.id, 'owner', false);
  saved = (await service.guild('g')).tournaments[bracket.id];
  assert.equal(saved.winner.name, 'B');
});

test('review requires episode context and guess game has real persistent win state', async t => {
  const service = new Community(await testStore(t));
  await assert.rejects(service.review('g', 'u', { animeId: 1, episode: 0, text: 'bad' }), /episode/i);
  const review = await service.review('g', 'u', { animeId: 1, episode: 3, text: 'spoiler', spoiler: true, rating: 8 });
  assert.equal(review.episode, 3);
  const game = await service.gameCreate('g', 'u', { mal_id: 1, title: 'Cowboy Bebop', titles: [{ title: 'Cowboy Bebop' }], genres: [], studios: [] }, 'clues');
  assert.equal((await service.answer('g', game.id, 'guest', 'Wrong')).correct, false);
  await assert.rejects(service.answer('g', game.id, 'guest', 'cowboy bebop'), /three seconds/);
  assert.equal((await service.answer('g', game.id, 'guest2', 'cowboy bebop')).correct, true);
  assert.equal((await service.guild('g')).games[game.id].winnerId, 'guest2');
  await assert.rejects(service.answer('g', game.id, 'u', 'cowboy bebop'), /ended/);
});
