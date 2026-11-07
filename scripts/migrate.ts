import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL or MIGRATION_DATABASE_URL.');
const sql = postgres(url, { max: 1, prepare: false });
try {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())`;
  const files = (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
  for (const name of files) {
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(9247182)`;
      const applied = await tx`SELECT name FROM schema_migrations WHERE name = ${name}`;
      if (applied.length) return;
      const source = await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8');
      await tx.unsafe(source);
      await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
      console.log('Applied', name);
    });
  }
} finally { await sql.end(); }
