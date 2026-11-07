import Link from 'next/link';
import { accountStatus, accountReminderPreference } from '@/lib/actions';
import { AccountControls } from './controls';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your account · Agent Meet', robots: { index: false, follow: false } };
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ dinner?: string }> }) {
  const status = await accountStatus();
  const { dinner } = await searchParams;
  const preference = dinner && status.signedIn ? await accountReminderPreference(dinner) : null;
  return <main className="wrap narrow empty-page stack"><Link href="/" className="brand">Agent Meet</Link><h1>Your email account</h1>{!status.configured ? <p role="status">Email sign-in is not configured yet. Contact the service owner.</p> : <AccountControls signedIn={status.signedIn} email={status.email} dinnerId={dinner} reminderPreference={preference} />}</main>;
}
