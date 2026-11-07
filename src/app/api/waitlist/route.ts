import { NextResponse } from 'next/server';
import { appUrl, joinWaitlist } from '@/lib/notifications';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== appUrl()) return NextResponse.json({ ok: false, error: 'Open this form from Agent Meet.' }, { status: 403 });
    const input = await request.json();
    if (input.consent !== true) return NextResponse.json({ ok: false, error: 'Choose the email opt-in before submitting.' }, { status: 400 });
    const requester = (request.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
    return NextResponse.json(await joinWaitlist(input.email, requester));
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not request signup. Check your address and try again later.' }, { status: 400 });
  }
}
