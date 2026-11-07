import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boundedJson, PublicVenueCache } from '../src/lib/provider-cache';

test('public venue loads are shared only while fresh, and failed loads can retry', async () => {
  let clock = 100;
  const cache = new PublicVenueCache<string[]>(100, 2, () => clock);
  let loads = 0;
  const load = async () => { loads++; return ['public venue']; };
  const [first, second] = await Promise.all([cache.get('station', load), cache.get('station', load)]);
  assert.deepEqual(first, second);
  assert.equal(loads, 1);
  clock = 201;
  await cache.get('station', load);
  assert.equal(loads, 2);
  await assert.rejects(cache.get('failure', async () => { throw new Error('Service unavailable'); }));
  assert.deepEqual(await cache.get('failure', load), ['public venue']);
  assert.equal(loads, 3);
});

test('public cache evicts old entries rather than growing for every station', async () => {
  const cache = new PublicVenueCache<string>(1000, 2);
  await cache.get('one', async () => 'old');
  await cache.get('two', async () => 'two');
  await cache.get('three', async () => 'three');
  assert.equal(await cache.get('one', async () => 'new'), 'new');
});

test('provider body bounds cancel an oversized chunk without waiting for the whole response', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(100)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(boundedJson(new Response(body), 50), /exceeds limit/);
  assert.equal(cancelled, true);
});

test('provider byte bound also applies when content length is absent or misleading', async () => {
  await assert.rejects(boundedJson(new Response(JSON.stringify('ééé'), { headers: { 'Content-Length': '2' } }), 7), /exceeds limit/);
  let cancelled = false;
  await assert.rejects(boundedJson(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Length': '100' } }), 50), /exceeds limit/);
  assert.equal(cancelled, true);
});

test('streamed JSON preserves UTF-8 split across chunks and rejects malformed UTF-8', async () => {
  const encoded = new TextEncoder().encode(JSON.stringify({ name: 'Café' }));
  const accent = encoded.indexOf(0xc3);
  const chunks = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(encoded.slice(0, accent + 1));
    controller.enqueue(encoded.slice(accent + 1));
    controller.close();
  } });
  assert.deepEqual(await boundedJson(new Response(chunks)), { name: 'Café' });
  await assert.rejects(boundedJson(new Response(new Uint8Array([0xff]))));
});
