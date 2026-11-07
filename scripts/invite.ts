import { db } from '../src/lib/db';
import { token, digest } from '../src/lib/security';

const raw = token();
const url = process.env.APP_URL;
if (!url) throw new Error('Set APP_URL to your own deployment or local app.');
try {
  await db()`INSERT INTO pilot_invites (hash, expires_at) VALUES (${digest(raw)}, now() + interval '7 days')`;
  console.log('Private single-use invitation, expires in seven days. Share only with the invited organiser:');
  console.log(url.replace(/\/$/, '') + '/invite/' + raw);
} finally { await db().end(); }
