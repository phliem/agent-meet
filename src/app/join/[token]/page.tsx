import Link from 'next/link';
import { accountStatus } from '@/lib/actions';
import { AccountControls } from '@/app/account/controls';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your personal invitation · Agent Meet', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
export default async function JoinPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ dinner?: string }> }) {
  const [{ token }, { dinner }, status] = await Promise.all([params, searchParams, accountStatus()]);
  return <main className="wrap narrow empty-page stack"><Link href="/" className="brand">Agent Meet</Link><h1>Your personal invitation</h1><p>Sign in with the email address your organiser invited. Each private invitation can be accepted once.</p>{!dinner || token.length < 32 || token.length > 100 ? <p>Invalid personal invitation. Ask your organiser for a fresh link.</p> : !status.configured ? <p>Email sign-in is not configured yet. Contact the service owner.</p> : <AccountControls signedIn={status.signedIn} email={status.email} dinnerId={dinner} invitation={token} />}</main>;
}
