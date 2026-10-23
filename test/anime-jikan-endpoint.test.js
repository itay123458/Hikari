import test from 'node:test';
import assert from 'node:assert/strict';
import { Jikan } from '../src/services/anime/providers.js';
import { CachedHttp, ProviderError } from '../src/services/anime/http.js';

test('HTTP timeout is configurable so cold private metadata requests can complete', async () => {
  const fetcher = async (_url, { signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(new Response('{"ok":true}')), 25);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
  const fast = new CachedHttp({ timeoutMs: 1, interval: 0, fetcher, sleep: async () => {} });
  await assert.rejects(fast.get('https://metadata.example/v4/test'), ProviderError);
  const cold = new CachedHttp({ timeoutMs: 1000, interval: 0, fetcher, sleep: async () => {} });
  assert.deepEqual(await cold.get('https://metadata.example/v4/test'), { ok: true });
  assert.equal(new Jikan(undefined, { baseUrl: 'http://jikan:8080/v4' }).http.timeoutMs, 35000);
});

test('self-hosted Jikan v4 endpoint preserves paths and documented filters', async () => {
  const urls = [];
  const jikan = new Jikan({ get: async url => { urls.push(new URL(url)); return { data: { mal_id: 21 } }; } }, { baseUrl: 'http://jikan:8080/v4/' });
  await jikan.anime(21);
  await jikan.search('anime', { q: 'One Piece', genres: '1,2', min_score: 6 });
  await jikan.resource(21, 'news');
  assert.equal(urls[0].href, 'http://jikan:8080/v4/anime/21/full');
  assert.equal(urls[1].searchParams.get('q'), 'One Piece');
  assert.equal(urls[1].searchParams.get('genres'), '1,2');
  assert.equal(urls[1].searchParams.get('sfw'), 'true');
  assert.equal(urls[2].pathname, '/v4/anime/21/news');
});

test('missing Jikan endpoint explains public retirement without attempting network access', async () => {
  const jikan = new Jikan({ get: () => { throw new Error('network should not be called'); } }, { baseUrl: '' });
  await assert.rejects(async () => jikan.anime(1), /JIKAN_BASE_URL.*retired/i);
});

test('Jikan endpoint rejects credentials, query strings, fragments and non-v4 bases without echoing values', () => {
  for (const baseUrl of ['https://user:private@example.com/v4', 'https://example.com/v4?key=private', 'https://example.com/v4#private', 'file:///v4', 'https://example.com/v3']) {
    assert.throws(() => new Jikan({}, { baseUrl }), error => /JIKAN_BASE_URL/.test(error.message) && !error.message.includes('private'));
  }
});

test('Jikan endpoint may use a private reverse-proxy path while retaining v4', async () => {
  let url;
  const jikan = new Jikan({ get: async value => { url = value; return { data: [] }; } }, { baseUrl: 'https://metadata.example/hikari/v4' });
  await jikan.resource(1, 'videos');
  assert.equal(url, 'https://metadata.example/hikari/v4/anime/1/videos');
});
