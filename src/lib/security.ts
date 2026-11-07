import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const token = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function matches(raw: string | undefined, hash: string | undefined) {
  if (!raw || !hash) return false;
  const candidate = digest(raw);
  return candidate.length === hash.length && timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}
export const guestCookie = (id: string) => 'am_guest_' + id;
export const hostCookie = (id: string) => 'am_host_' + id;
export const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: 60 * 60 * 24 * 90 };
