import { NextResponse } from 'next/server';
import { jobsAuthorised, runJobs } from '@/lib/notifications';

export const runtime = 'nodejs';
export const maxDuration = 60;
async function handle(request: Request) {
  if (!jobsAuthorised(request.headers.get('authorization'))) return NextResponse.json({ ok: false }, { status: 401 });
  try { return NextResponse.json({ ok: true, ...await runJobs({ limit: 4 }) }); }
  catch { return NextResponse.json({ ok: false, error: 'Job processing failed.' }, { status: 503 }); }
}
export const GET = handle;
export const POST = handle;
