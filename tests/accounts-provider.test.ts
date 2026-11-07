import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerRequest } from '../src/lib/accounts';
test('live provider adapter fails closed without config, even with fixture flags', async () => {
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_ANON_KEY, oldMode = process.env.DATA_MODE;
  process.env.DATA_MODE = 'fixture';
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_ANON_KEY;
  try { await assert.rejects(providerRequest('user'), /not configured/); }
  finally { if (oldMode === undefined) delete process.env.DATA_MODE; else process.env.DATA_MODE = oldMode; if (oldUrl !== undefined) process.env.SUPABASE_URL = oldUrl; if (oldKey !== undefined) process.env.SUPABASE_ANON_KEY = oldKey; }
});
test('live adapter sends OTP contract and sanitises expired credentials (mocked network)', async () => {
  const oldFetch = globalThis.fetch, oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://identity.example.com'; process.env.SUPABASE_ANON_KEY = 'test-public-key';
  const requests: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (url, init) => { requests.push({ url: String(url), init }); return new Response('{}', { status: requests.length === 1 ? 200 : 401 }); };
  try {
    await providerRequest('otp', { email: 'alex@example.com', create_user: true });
    assert.equal(requests[0].url, 'https://identity.example.com/auth/v1/otp');
    assert.equal(requests[0].init?.cache, 'no-store');
    assert.deepEqual(JSON.parse(requests[0].init?.body as string), { email: 'alex@example.com', create_user: true });
    await assert.rejects(providerRequest('user', undefined, 'expired-token'), /failed or expired/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = oldKey;
  }
});
