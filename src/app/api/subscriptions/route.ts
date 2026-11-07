import { NextResponse } from 'next/server';
import { requireGuest } from '@/lib/access';
import { appUrl, subscribeDinner } from '@/lib/notifications';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== appUrl()) return NextResponse.json({ ok: false, error: 'Open this form from Agent Meet.' }, { status: 403 });
    const input = await request.json();
    if (input.consent !== true) return NextResponse.json({ ok: false, error: 'Choose the email opt-in before submitting.' }, { status: 400 });
    if (typeof input.slug !== 'string' || input.slug.length > 128) throw new Error('Invalid dinner.');
    const context = await requireGuest(input.slug);
    return NextResponse.json(await subscribeDinner(context, input.email));
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not request updates. Check your address and attending reply, then try again later.' }, { status: 400 });
  }
}
