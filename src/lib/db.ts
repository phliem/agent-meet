import postgres from 'postgres';

let connection: ReturnType<typeof postgres> | undefined;
export function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Database is not configured. Follow the local setup in README.');
  connection ??= postgres(url, { max: 5, prepare: false, connect_timeout: 10, idle_timeout: 20 });
  return connection;
}
