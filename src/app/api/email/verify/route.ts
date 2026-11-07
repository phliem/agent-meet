import { verifySubscription } from '@/lib/notifications';

export const runtime = 'nodejs';
const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" };
const validToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const page = (content: string) => new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent Meet email confirmation</title><body style="font:18px/1.5 system-ui;max-width:38rem;margin:4rem auto;padding:1rem"><h1>Agent Meet</h1>' + content + '</body></html>', { headers });

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token');
  if (!validToken(token)) return page('<p>This confirmation link is invalid.</p>');
  return page('<p>Confirm that you want to receive the Agent Meet updates you requested.</p><form method="post"><input type="hidden" name="token" value="' + token + '"><button type="submit" style="padding:12px 20px;font:inherit">Confirm email updates</button></form>');
}
export async function POST(request: Request) {
  try {
    const token = (await request.formData()).get('token');
    if (!validToken(token)) throw new Error('Invalid token.');
    const result = await verifySubscription(token);
    return page(result ? '<p>Your email is confirmed. You can close this page and return to Agent Meet.</p>' : '<p>This link has already been used or expired. Return to Agent Meet to check your signup.</p>');
  } catch { return page('<p>Confirmation is unavailable. Please try again later.</p>'); }
}
