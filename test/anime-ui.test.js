import test from 'node:test';
import assert from 'node:assert/strict';
import { testStore } from './helpers/database.js';
import { animeCard, searchPage, partyView, tournamentView, gameImage } from '../src/services/anime/views.js';
import command from '../src/commands/Anime/anime.js';
import { promptForm } from '../src/services/anime/controller.js';

test('command schema exposes every module and uses one global command', () => {
  const data = command.data.toJSON();
  assert.equal(data.name, 'anime');
  assert.equal(data.dm_permission, false);
  assert.deepEqual(data.options.filter(o => o.type === 2).map(o => o.name), ['discover', 'list', 'alerts', 'club', 'games', 'admin']);
  for (const group of data.options.filter(o => o.type === 2)) {
    assert.ok(group.options.length <= 25);
    for (const sub of group.options) assert.ok(sub.options.length <= 25);
  }
});

test('anime detail hides synopsis and unknown metadata, and keeps official links honest', () => {
  const card = animeCard({ mal_id: 1, title: 'Example', synopsis: 'SECRET', genres: [], studios: [], score: null, episodes: null }, {}, [{ name: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/X' }]);
  const data = card.embeds[0].toJSON();
  assert.equal(JSON.stringify(data).includes('SECRET'), false);
  assert.match(JSON.stringify(data), /Unknown/);
  assert.match(JSON.stringify(data), /Regional availability.*unknown/i);
  assert.equal(card.components[0].toJSON().components[0].url, 'https://www.crunchyroll.com/series/X');
});

test('search creates an owned expiring result-selection session with canonical IDs', async t => {
  const store = await testStore(t);
  const result = await searchPage({ store, jikan: { search: async () => ({ data: [{ mal_id: 21, title: 'One Piece' }], pagination: { has_next_page: true } }) } }, { ownerId: 'u', guildId: 'g', kind: 'anime', params: { q: 'One' }, page: 1 });
  const menu = result.components.find(row => row.toJSON().components[0].type === 3).toJSON().components[0];
  const sessionId = menu.custom_id.split(':')[1];
  const saved = await store.read('session', sessionId);
  assert.equal(saved.ownerId, 'u');
  assert.deepEqual(saved.ids, [21]);
  assert.ok(saved.expiresAt > Date.now());
});

test('community views persist IDs, label RSVP reminder consent and show bracket state', () => {
  const party = partyView({ id: 'abc', title: 'Example', startsAt: new Date(Date.now() + 3600000).toISOString(), rsvps: {}, version: 1 });
  assert.match(party.embeds[0].toJSON().description, /reminder/i);
  assert.match(party.components[0].toJSON().components[0].custom_id, /^anime_public:party:abc/);
  const bracket = tournamentView({ id: 't', round: 1, match: 0, matches: [[{ name: 'A' }, { name: 'B' }]], votes: {}, entries: [] });
  assert.match(bracket.embeds[0].toJSON().description, /Round 2/);
});

test('guessing images use actual processing and never leak source filename', async () => {
  const { default: sharp } = await import('sharp');
  const pixels = Buffer.alloc(30 * 40 * 3, 255);
  for (let y = 10; y < 30; y++) for (let x = 8; x < 22; x++) for (let c = 0; c < 3; c++) pixels[(y * 30 + x) * 3 + c] = 20;
  const original = await sharp(pixels, { raw: { width: 30, height: 40, channels: 3 } }).png().toBuffer();
  const result = await gameImage({ mode: 'silhouette', level: 0, image: 'https://cdn.myanimelist.net/images/a.jpg' }, async () => new Response(original));
  const pixel = await sharp(result).raw().toBuffer();
  assert.equal(pixel[0], 255);
  assert.equal(pixel[(210 * 300 + 150) * 3], 0);
});

test('public review modal serializes within Discord form limits', async t => {
  const store = await testStore(t);
  let shown;
  await promptForm({ user: { id: 'u' }, guildId: 'g', options: {
    getString: () => '1', getInteger: name => name === 'episode' ? 3 : 8, getBoolean: () => true,
  }, showModal: async form => { shown = form.toJSON(); } }, { store }, 'review');
  assert.ok(shown.components[0].components[0].label.length <= 45);
});
