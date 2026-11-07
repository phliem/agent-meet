"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@base-ui/react/button";
import { createDinner, redeemPilot } from "@/lib/actions";

export function londonInput(iso: string) {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

export function londonISO(value: string) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))
    throw new Error("Enter a date and time.");
  const wall = Date.parse(`${value}:00Z`);
  let instant = wall;
  for (let i = 0; i < 3; i++)
    instant +=
      wall - Date.parse(`${londonInput(new Date(instant).toISOString())}:00Z`);
  const result = new Date(instant).toISOString();
  if (londonInput(result) !== value)
    throw new Error(
      "That time does not exist when London clocks change. Choose another time.",
    );
  return result;
}

export function Status({
  error,
  message,
}: {
  error?: string;
  message?: string;
}) {
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  return error ? (
    <p ref={errorRef} tabIndex={-1} className="feedback error" role="alert">
      {error}
    </p>
  ) : message ? (
    <p className="feedback" role="status">
      {message}
    </p>
  ) : null;
}

export function CreateDinner({
  v2Enabled = false,
  signedIn = false,
}: {
  v2Enabled?: boolean;
  signedIn?: boolean;
}) {
  const [v2, setV2] = useState(false);
  const router = useRouter();
  const [mode, setMode] = useState("flexible");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError("");
    startTransition(async () => {
      try {
        const result = await createDinner({
          ...(v2 && v2Enabled && signedIn
            ? {
                experience: "v2",
                identityMode: "account",
                inviteEmails: String(data.get("inviteEmails") ?? "")
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
                remindersEnabled: data.get("remindersEnabled") === "on",
              }
            : {}),
          title: data.get("title"),
          hostName: data.get("hostName"),
          names: String(data.get("names"))
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          mode,
          dateStart: data.get("dateStart") || undefined,
          dateEnd: data.get("dateEnd") || undefined,
          fixedStart:
            mode === "fixed"
              ? londonISO(String(data.get("fixedStart")))
              : undefined,
          duration: Number(data.get("duration")),
          deadline: londonISO(String(data.get("deadline"))),
        });
        if (!result.ok)
          setError(result.error ?? "We could not create this dinner.");
        else if (result.url) router.push(result.url);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Please try again.");
      }
    });
  }
  return (
    <form className="panel create-form" onSubmit={submit}>
      {v2Enabled ? (
        <fieldset className="field">
          <legend>Planning experience</legend>
          <label className="check-label">
            <input
              type="checkbox"
              checked={v2}
              disabled={!signedIn}
              onChange={(e) => setV2(e.target.checked)}
            />
            Use V2 · personal invitations and shared budgets
          </label>
          <p className="field-hint">
            {signedIn ? (
              "Optional for this new dinner. Each guest signs in with their invited email. Existing dinners keep their original experience."
            ) : (
              <>
                {" "}
                <a href="/account">Sign in</a> to create a V2 dinner. You can
                still create a classic dinner below.
              </>
            )}
          </p>
        </fieldset>
      ) : null}
      <div className="field">
        <label htmlFor="title">Give your dinner a name</label>
        <input
          id="title"
          name="title"
          placeholder="Friday dinner with friends"
          required
          maxLength={100}
        />
      </div>
      <div className="field">
        <label htmlFor="hostName">Your name</label>
        <input
          id="hostName"
          name="hostName"
          autoComplete="given-name"
          required
          maxLength={60}
        />
      </div>
      <div className="field">
        <label htmlFor="names">Who’s coming?</label>
        <textarea
          id="names"
          name="names"
          rows={4}
          required
          placeholder={"Alex\nSam\nPriya"}
        />
        <p className="field-hint">
          One unique name per line. Include yourself if you’re joining dinner.
        </p>
      </div>
      {v2 ? (
        <>
          <div className="field">
            <label htmlFor="inviteEmails">Guest invitation emails</label>
            <textarea
              id="inviteEmails"
              name="inviteEmails"
              rows={4}
              required
              placeholder={
                "alex@example.com\nsam@example.com\npriya@example.com"
              }
            />
            <p className="field-hint">
              One email per name, in the same order. Include your own email if
              you’re attending. Emails stay private. You’ll share each personal
              invitation yourself; creating a dinner sends no email.
            </p>
          </div>
          <label className="check-label">
            <input type="checkbox" name="remindersEnabled" />
            Allow one reminder for guests who separately opt in
          </label>
        </>
      ) : null}
      <fieldset className="field">
        <legend>Have you agreed on a date?</legend>
        <div className="segmented">
          <label>
            <input
              type="radio"
              name="mode"
              value="flexible"
              checked={mode === "flexible"}
              onChange={() => setMode("flexible")}
            />{" "}
            Find a time together
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              value="fixed"
              checked={mode === "fixed"}
              onChange={() => setMode("fixed")}
            />{" "}
            We have a date
          </label>
        </div>
      </fieldset>
      {mode === "fixed" ? (
        <div className="field">
          <label htmlFor="fixedStart">Dinner starts · London time</label>
          <input
            type="datetime-local"
            id="fixedStart"
            name="fixedStart"
            step={1800}
            required
          />
        </div>
      ) : (
        <div className="field-grid">
          <div className="field">
            <label htmlFor="dateStart">First possible date</label>
            <input id="dateStart" name="dateStart" type="date" required />
          </div>
          <div className="field">
            <label htmlFor="dateEnd">Last possible date</label>
            <input id="dateEnd" name="dateEnd" type="date" required />
          </div>
        </div>
      )}
      <div className="field-grid">
        <div className="field">
          <label htmlFor="duration">Dinner duration</label>
          <select id="duration" name="duration" defaultValue="120">
            <option value="60">1 hour</option>
            <option value="90">1½ hours</option>
            <option value="120">2 hours</option>
            <option value="150">2½ hours</option>
            <option value="180">3 hours</option>
            <option value="240">4 hours</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="deadline">Reply by · London time</label>
          <input
            id="deadline"
            name="deadline"
            type="datetime-local"
            step={1800}
            required
          />
        </div>
      </div>
      <p className="field-hint">
        Set the reply deadline before the earliest dinner date. Your organiser
        access is saved in this browser. Keep its browser data to manage the
        dinner later.
      </p>
      <Status error={error} />
      <Button className="button" type="submit" disabled={pending}>
        {pending ? "Creating your dinner…" : "Create & get the invite link"}{" "}
        <span aria-hidden="true">↗</span>
      </Button>
    </form>
  );
}

export function EmailSignup({ slug }: { slug?: string }) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [verificationUrl, setVerificationUrl] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError("");
    setMessage("");
    setVerificationUrl("");
    try {
      const response = await fetch(
        slug ? "/api/subscriptions" : "/api/waitlist",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: data.get("email"),
            consent: true,
            ...(slug ? { slug } : {}),
          }),
        },
      );
      const result = await response.json();
      if (!response.ok || result.ok === false)
        throw new Error(result.error ?? "We could not save your request.");
      setMessage(result.message ?? "Your signup was received.");
      if (
        typeof result.verificationUrl === "string" &&
        new URL(result.verificationUrl, window.location.origin).origin ===
          window.location.origin
      )
        setVerificationUrl(result.verificationUrl);
      form.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="signup-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor={slug ? "updates-email" : "waitlist-email"}>
          Your email address
        </label>
        <input
          id={slug ? "updates-email" : "waitlist-email"}
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
        />
      </div>
      <label className="check-label">
        <input type="checkbox" name="consent" required />
        <span>
          {slug
            ? "Email me when area voting opens and when this dinner is confirmed."
            : "Email me about future access to create my own dinners."}
        </span>
      </label>
      <Button type="submit" className="button" disabled={pending}>
        {pending
          ? "Saving…"
          : slug
            ? "Get dinner updates"
            : "Join the creator waitlist"}{" "}
        <span aria-hidden="true">↗</span>
      </Button>
      <Status error={error} message={message} />
      {verificationUrl ? (
        <a className="preview-email-link" href={verificationUrl}>
          Local email preview — no email sent →
        </a>
      ) : null}
      <p className="field-hint">
        {slug
          ? "Optional. Verify your address to receive updates. You can unsubscribe whenever you like."
          : "We’ll ask you to verify your address. Joining records your interest; hosting access comes by invitation."}
      </p>
    </form>
  );
}

export function Waitlist() {
  return <EmailSignup />;
}

export function PilotInvite({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();
  return (
    <div>
      <Button
        className="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              const result = await redeemPilot(token);
              if (!result.ok)
                setError(
                  result.error ?? "This invitation could not be activated.",
                );
              else {
                router.push(result.url ?? "/#create");
                router.refresh();
              }
            } catch {
              setError(
                "We could not activate this invitation. Please try again.",
              );
            }
          })
        }
      >
        {pending ? "Activating…" : "Activate my invitation"}
      </Button>
      <Status error={error} />
    </div>
  );
}
