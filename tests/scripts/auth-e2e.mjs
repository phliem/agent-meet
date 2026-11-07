// Explicit test-only Supabase REST double. Never imported by application code.
import { createServer } from 'node:https';
import { createServer as netServer } from 'node:net';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS verification must remain enabled for the auth browser harness.');
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to a disposable migrated test database.');
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error('The auth browser harness requires a loopback test database.');
await mkdir('.auth-e2e', { recursive: true });
const directory = await mkdtemp(resolve('.auth-e2e/provider-'));
const cert = directory + '/ca.pem';
const key = directory + '/key.pem';
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE'], { stdio: 'ignore' });
const apiKey = randomBytes(24).toString('hex');
const users = new Map();
const sessions = new Map();
const requested = new Set();
const provider = createServer({ key: await readFile(key), cert: await readFile(cert) }, async (request, response) => {
  const reply = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
  if (request.headers.apikey !== apiKey) return reply(401, {});
  if (request.method === 'GET' && request.url === '/auth/v1/user') {
    const user = sessions.get(request.headers.authorization?.replace(/^Bearer /, ''));
    return reply(user ? 200 : 401, user ?? {});
  }
  let body;
  try { let raw = ''; for await (const chunk of request) raw += chunk; body = JSON.parse(raw); } catch { return reply(400, {}); }
  if (request.method !== 'POST' || !/^[^@\s]+@example\.invalid$/.test(body.email ?? '')) return reply(400, {});
  if (request.url === '/auth/v1/otp' && body.create_user === true) { requested.add(body.email); return reply(200, {}); }
  if (request.url === '/auth/v1/verify' && body.type === 'email' && body.token === '123456' && requested.delete(body.email)) {
    if (!users.has(body.email)) users.set(body.email, { id: randomUUID(), email: body.email, email_confirmed_at: new Date().toISOString(), is_anonymous: false });
    const access_token = randomBytes(32).toString('hex');
    sessions.set(access_token, users.get(body.email));
    return reply(200, { access_token, token_type: 'bearer', expires_in: 3600, user: users.get(body.email) });
  }
  return reply(401, {});
});
try {
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const providerPort = provider.address().port;
  const probe = netServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const appPort = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn('pnpm', ['exec', 'playwright', 'test', '--config=playwright.auth.config.ts'], { stdio: 'inherit', env: { ...process.env, AUTH_E2E: 'true', NODE_EXTRA_CA_CERTS: cert, PORT: String(appPort), APP_URL: `http://localhost:${appPort}`, SUPABASE_URL: `https://127.0.0.1:${providerPort}`, SUPABASE_ANON_KEY: apiKey, ENABLE_V2: 'true', DATA_MODE: 'fixture', EMAIL_MODE: 'fixture' } });
  process.once('SIGINT', () => child.kill('SIGINT'));
  process.once('SIGTERM', () => child.kill('SIGTERM'));
  process.exitCode = await new Promise(resolve => child.once('exit', code => resolve(code ?? 1)));
} finally {
  await new Promise(resolve => provider.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
