import test from 'node:test';
import assert from 'node:assert/strict';
import { CachedHttp, ProviderError } from '../src/services/anime/http.js';
import { Jikan, AnimeSchedule, normalizeTimetable, exactMalId, streamingLinks } from '../src/services/anime/providers.js';

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });

test('concurrent requests deduplicate and cached data expires', async () => {
  let calls = 0, now = 100;
  const http = new CachedHttp({ fetcher: async () => { calls++; return json({ data: ['real boundary fixture'] }); }, interval: 0, now: () => now });
  const results = await Promise.all([http.get('https://api.example/a', { ttl: 50 }), http.get('https://api.example/a', { ttl: 50 })]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(calls, 1);
  now += 51;
  await http.get('https://api.example/a', { ttl: 50 });
  assert.equal(calls, 2);
});

test('rate limits retry and authentication errors never expose bearer tokens', async () => {
  let calls = 0;
  const waits = [];
  const http = new CachedHttp({ interval: 0, sleep: async ms => waits.push(ms), fetcher: async () => ++calls === 1 ? json({}, 429, { 'Retry-After': '1' }) : json({ ok: true }) });
  assert.deepEqual(await http.get('https://api.example/a'), { ok: true });
  assert.ok(waits.includes(1000));
  const denied = new CachedHttp({ interval: 0, fetcher: async () => json({ token: 'secret' }, 401) });
  await assert.rejects(denied.get('https://api.example/a', { headers: { Authorization: 'Bearer secret' } }), error => error instanceof ProviderError && !error.message.includes('secret'));
});

test('AnimeSchedule refuses requests without application token', async () => {
  const schedule = new AnimeSchedule({ token: '', http: { get: () => { throw new Error('must not call'); } } });
  await assert.rejects(schedule.timetable(), /ANIMESCHEDULE_TOKEN/);
});

test('mapping uses canonical MAL website IDs and rejects similarly named seasons', async () => {
  assert.equal(exactMalId('https://myanimelist.net/anime/21/One_Piece'), 21);
  assert.equal(exactMalId('https://evil.test/anime/21'), null);
  const schedule = new AnimeSchedule({ token: 'test', http: { get: async () => ({ anime: [
    { route: 'wrong-season', websites: { mal: 'https://myanimelist.net/anime/22' } },
    { route: 'right-season', websites: { mal: 'https://myanimelist.net/anime/21' } },
  ] }) } });
  assert.equal((await schedule.resolve(21)).route, 'right-season');
  assert.equal(await schedule.resolve(99), null);
});

test('timetables preserve raw/sub/dub and unknown dates, never claim Crunchyroll publication', () => {
  const rows = normalizeTimetable([{ route: 'one', title: 'One', airType: 'raw', episodeDate: '0001-01-01T00:00:00Z', episodeNumber: 2 },
    { route: 'one', title: 'One', airType: 'dub', episodeDate: '2026-10-22T15:00:00Z', delayedText: 'Delayed', episodeNumber: 1 }]);
  assert.equal(rows[0].at, null);
  assert.equal(rows[0].type, 'raw');
  assert.equal(rows[1].type, 'dub');
  assert.equal(rows[1].publishedOnCrunchyroll, null);
  assert.equal(rows[1].region, null);
  assert.equal(rows[1].delay, 'Delayed');
});

test('streaming buttons reject deceptive domains and unknown availability remains unknown', () => {
  const links = streamingLinks([{ name: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/X' }, { name: 'bad', url: 'https://crunchyroll.com.evil.test/x' }, { name: 'bad', url: 'javascript:alert(1)' }]);
  assert.equal(links.length, 1);
  assert.equal(links[0].region, null);
});

test('Jikan sends real documented filters and keeps unknown scores null', async () => {
  let target;
  const jikan = new Jikan({ get: async url => { target = new URL(url); return { data: [{ mal_id: 1, score: null }], pagination: { has_next_page: false } }; } }, { baseUrl: 'http://jikan:8080/v4' });
  const result = await jikan.search('anime', { q: 'Cowboy', genres: '1', status: 'complete', page: 2 });
  assert.equal(target.pathname, '/v4/anime');
  assert.equal(target.searchParams.get('sfw'), 'true');
  assert.equal(target.searchParams.get('genres'), '1');
  assert.equal(result.data[0].score, null);
});
