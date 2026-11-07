'use client';
import { useRef, useState, useTransition } from 'react';
import { Button } from '@base-ui/react/button';
import { requestSignIn, verifySignIn, signOut, disableAccount, redeemPersonalInvitation, dinnerAction } from '@/lib/actions';
import { Status } from '@/components/forms';
import type { ActionResult } from '@/lib/model';
export function AccountControls({ signedIn, email: initialEmail, dinnerId, invitation, reminderPreference }: { signedIn: boolean; email?: string; dinnerId?: string; invitation?: string; reminderPreference?: { allowed: boolean; enabled: boolean } | null }) {
  const [email, setEmail] = useState(initialEmail ?? '');
  const [code, setCode] = useState('');
  const [remindersAllowed, setRemindersAllowed] = useState(reminderPreference?.allowed ?? false);
  const emailForm = useRef<HTMLFormElement>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();
  const perform = (action: () => Promise<ActionResult>, refresh = false) => start(async () => {
    setError('');
    setMessage('');
    try {
      const result = await action();
      if (!result.ok) setError(result.error ?? 'We could not save that change. Please try again.');
      else setMessage(result.message ?? 'Done.');
      if (result.ok && result.url) window.location.assign(result.url);
      else if (result.ok && refresh) window.location.reload();
    } catch { setError('Unable to connect. Try again.'); }
  });
  return <div className="stack">
    {signedIn ? <>
      <p>Signed in as <strong>{initialEmail}</strong>.</p>
      {dinnerId && invitation ? <><label className="check-label"><input type="checkbox" checked={remindersAllowed} onChange={e => setRemindersAllowed(e.target.checked)} />Email me one reply reminder for this dinner if I have not replied (when the organiser has enabled reminders).</label><Button className="button" disabled={pending} onClick={() => perform(() => redeemPersonalInvitation(dinnerId, invitation, remindersAllowed))}>Accept personal invitation</Button></> : null}
      {dinnerId && !invitation && reminderPreference ? <form className="stack" onSubmit={e => { e.preventDefault(); perform(() => dinnerAction(dinnerId, { type: 'reminder-preference', allowed: remindersAllowed })); }}><label className="check-label"><input type="checkbox" checked={remindersAllowed} onChange={e => setRemindersAllowed(e.target.checked)} />Email me a reply reminder for this dinner</label>{!reminderPreference.enabled ? <p>The organiser has not enabled reminders for this dinner.</p> : null}<Button className="button" type="submit" disabled={pending}>Save reminder preference</Button><a href={'/d/' + encodeURIComponent(dinnerId)}>Return to dinner</a></form> : null}
      <Button className="button secondary" disabled={pending} onClick={() => perform(signOut, true)}>Sign out of this device</Button>
      <details><summary>Disable account</summary><p>Disabling signs out every device and stops dinner emails. You cannot sign back in. Existing dinner contributions remain until the dinner expires.</p><Button className="button secondary" disabled={pending} onClick={() => { if (window.confirm('Permanently disable your account on every device?')) perform(disableAccount, true); }}>Disable my account</Button></details>
    </> : <>
      <p>Verify your email to return on any device. Sessions expire after an hour; request a fresh code when needed.</p>
      <form ref={emailForm} className="stack" onSubmit={e => { e.preventDefault(); perform(() => requestSignIn(email)); }}>
        <label>Email address<input type="email" required autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>
        <Button type="submit" className="button" disabled={pending}>Email me a verification code</Button>
      </form>
      <form className="stack" onSubmit={e => { e.preventDefault(); if (emailForm.current?.reportValidity()) perform(() => verifySignIn(email, code), true); }}>
        <label>Email verification code<input required pattern="[0-9]{6,10}" title="Enter the 6–10 digit code from your email." inputMode="numeric" autoComplete="one-time-code" minLength={6} maxLength={10} value={code} onChange={e => setCode(e.target.value)} /></label>
        <Button type="submit" className="button" disabled={pending}>Verify and sign in</Button>
      </form>
    </>}
    <Status error={error} message={pending ? 'Working…' : message} />
  </div>;
}
