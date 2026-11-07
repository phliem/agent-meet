import { db } from '../src/lib/db';
import { token, digest } from '../src/lib/security';

try {
  const [command, hash] = process.argv.slice(2);
  if (command === '--list') {
    const invites = await db()`SELECT hash, expires_at, redeemed_at FROM pilot_invites ORDER BY expires_at DESC`;
    const access = await db()`SELECT hash, expires_at, revoked_at FROM pilot_access ORDER BY expires_at DESC`;
    console.log(JSON.stringify({ invitations: invites, access }, null, 2));
  } else if (command === '--revoke-access' || command === '--revoke-invite') {
    if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Use the record hash shown by invite --list.');
    const rows = command === '--revoke-access'
      ? await db()`UPDATE pilot_access SET revoked_at = now() WHERE hash = ${hash} RETURNING hash`
      : await db()`UPDATE pilot_invites SET expires_at = now() WHERE hash = ${hash} RETURNING hash`;
    console.log(rows.length ? 'Pilot permission revoked.' : 'No matching record.');
  } else {
    if (command) throw new Error('Use invite, invite --list, invite --revoke-access HASH or invite --revoke-invite HASH.');
    const raw = token();
    const origin = new URL(process.env.APP_URL || 'http://localhost:3000');
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/') throw new Error('Set APP_URL to the application origin.');
    if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) throw new Error('Use HTTPS for deployed invitation links.');
    await db()`INSERT INTO pilot_invites (hash, expires_at) VALUES (${digest(raw)}, now() + interval '7 days')`;
    console.log('Private single-use invitation, expires in seven days. Share only with the invited organiser:');
    console.log(origin.origin + '/invite/' + raw);
  }
} finally { await db().end(); }
