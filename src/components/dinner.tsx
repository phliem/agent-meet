"use client";

import Link from "next/link";
import {
  useEffect,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "@base-ui/react/button";
import { dinnerAction } from "@/lib/actions";
import {
  CUISINES,
  DIETS,
  type DinnerView,
  type Restaurant,
  type PriceBand,
} from "@/lib/model";
import { EmailSignup, Waitlist, Status, londonISO, londonInput } from "./forms";

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const dateTime = (value: string) => timeFormat.format(new Date(value));
const dateOnly = (value: string) =>
  dateFormat.format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
const beforeVote = (d: DinnerView) =>
  ["collecting", "choosing-time", "recommending"].includes(d.stage);
const BUDGETS: { band: PriceBand; label: string }[] = [
  { band: "low", label: "Low · £" },
  { band: "medium", label: "Medium · ££" },
  { band: "high", label: "High · £££" },
];
type Run = (command: Record<string, unknown>) => void;

export function DinnerExperience({ dinner }: { dinner: DinnerView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [invitationLinks, setInvitationLinks] = useState<
    { guestId: string; name: string; url: string }[]
  >([]);
  useEffect(() => {
    if (dinner.stage === "confirmed") return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 15000);
    return () => clearInterval(interval);
  }, [dinner.stage, router]);
  function run(command: Record<string, unknown>) {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        const result = await dinnerAction(dinner.id, command);
        if (!result.ok)
          setError(result.error ?? "We could not save that change.");
        else {
          if (result.message) setMessage(result.message);
          if (result.invitationLinks)
            setInvitationLinks((current) => [
              ...current.filter(
                (link) =>
                  !result.invitationLinks!.some(
                    (next) => next.guestId === link.guestId,
                  ),
              ),
              ...result.invitationLinks!.map((link) => ({
                ...link,
                url: new URL(link.url, window.location.origin).href,
              })),
            ]);
          if (command.type === "revoke-invite" || command.type === "reset")
            setInvitationLinks((current) =>
              current.filter((link) => link.guestId !== command.guestId),
            );
          router.refresh();
        }
      } catch {
        setError("We could not reach Agent Meet. Please try again.");
      }
    });
  }
  const commonBudgets = dinner.commonBudgetBands ?? [];
  const selectedBudget =
    dinner.budgetBand &&
    (!commonBudgets.length || commonBudgets.includes(dinner.budgetBand))
      ? dinner.budgetBand
      : commonBudgets.length === 1
        ? commonBudgets[0]
        : undefined;
  const completed = dinner.guests.filter((g) => g.status !== "waiting").length;
  const included = dinner.guests.filter((g) =>
    dinner.includedIds?.includes(g.id),
  );
  const voters = included.filter((g) => g.voted).length;
  const area = dinner.areas.find((a) => a.id === dinner.selectedAreaId);
  const step =
    dinner.stage === "confirmed"
      ? "Dinner confirmed"
      : beforeVote(dinner)
        ? "Round 1 · Your reply"
        : "Round 2 · Choose an area";
  return (
    <>
      <header className="site-header wrap dinner-nav">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            m
          </span>{" "}
          Agent Meet
        </Link>
        <span className="pill">
          {dinner.organiser
            ? "Organiser"
            : (dinner.guest?.name ?? "Guest invitation")}
        </span>
      </header>
      <main className="dinner-layout wrap">
        <div className="dinner-main">
          {dinner.dataMode === "fixture" ? (
            <div className="fixture-banner" role="note">
              <strong>Preview mode</strong> Journey estimates and restaurants
              are synthetic examples, not live recommendations.
            </div>
          ) : null}
          <section className="dinner-heading">
            <span className="eyebrow">{step}</span>
            <h1>{dinner.title}</h1>
            <div className="dinner-meta">
              <span>
                {dinner.selectedStart
                  ? dateTime(dinner.selectedStart)
                  : dinner.fixedStart
                    ? dateTime(dinner.fixedStart)
                    : `${dateOnly(dinner.dateStart)} – ${dateOnly(dinner.dateEnd)}`}
              </span>
              <span>{dinner.duration / 60} hours</span>
              <span>Hosted by {dinner.hostName}</span>
            </div>
            <p className="field-hint">
              All dinner times are shown in London time.
            </p>
          </section>
          <Status error={error} message={message} />
          {pending ? (
            <p className="saving" role="status">
              Saving your changes…
            </p>
          ) : null}
          {dinner.notice ? <p className="feedback">{dinner.notice}</p> : null}
          {dinner.stage !== "confirmed" ? (
            <>
              <section className="panel progress-panel">
                <div className="row-between">
                  <h2>
                    {["area-voting", "choosing-restaurant"].includes(
                      dinner.stage,
                    )
                      ? "The group vote"
                      : "The guest list"}
                  </h2>
                  <span className="muted small">
                    {["area-voting", "choosing-restaurant"].includes(
                      dinner.stage,
                    )
                      ? `${voters} of ${included.length} voted`
                      : `${completed} of ${dinner.guests.length} replied`}
                  </span>
                </div>
                <progress
                  value={
                    ["area-voting", "choosing-restaurant"].includes(
                      dinner.stage,
                    )
                      ? voters
                      : completed
                  }
                  max={
                    ["area-voting", "choosing-restaurant"].includes(
                      dinner.stage,
                    )
                      ? Math.max(included.length, 1)
                      : dinner.guests.length
                  }
                  aria-label="Guest progress"
                />
                <div className="guest-list">
                  {dinner.guests.map((g) => (
                    <div className="guest-row" key={g.id}>
                      <span
                        className={`guest-status ${g.status !== "waiting" ? "is-complete" : ""}`}
                        aria-hidden="true"
                      >
                        {g.status === "declined"
                          ? "−"
                          : g.status === "replied"
                            ? "✓"
                            : "·"}
                      </span>
                      <strong>{g.name}</strong>
                      <span className="muted small">
                        {g.status === "declined"
                          ? "Can’t attend"
                          : g.status === "replied"
                            ? g.voted
                              ? "Voted"
                              : "Replied"
                            : g.taken
                              ? "Reply in progress"
                              : "Waiting"}
                      </span>
                      {dinner.organiser && g.taken && beforeVote(dinner) ? (
                        <Button
                          className="text-button"
                          disabled={pending}
                          onClick={() => {
                            if (
                              window.confirm(
                                dinner.identityMode === "account"
                                  ? `Reset ${g.name}’s reply? This deletes their saved answers, removes their account from this dinner and revokes their invitation. Generate a new personal link to invite them again.`
                                  : `Reset ${g.name}’s reply? This deletes their saved answers, frees their name and removes access from their old browser.`,
                              )
                            )
                              run({ type: "reset", guestId: g.id });
                          }}
                        >
                          Reset reply
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
              {dinner.organiser &&
              dinner.identityMode === "account" &&
              beforeVote(dinner) ? (
                <section className="panel">
                  <SectionHeading
                    eyebrow="Private organiser controls"
                    title="Personal invitations"
                    text="Generate a link for each guest and send it to them privately. Each link only works with their invited email. Generating a fresh link replaces the previous link; no email is sent."
                  />
                  <div className="stack">
                    {dinner.guests.map((g) => (
                      <div key={g.id} className="invitation-control">
                        <strong>{g.name}</strong>
                        <div className="action-row">
                          <Button
                            className="button secondary"
                            disabled={pending || g.taken}
                            onClick={() =>
                              run({ type: "issue-invite", guestId: g.id })
                            }
                          >
                            Generate link for {g.name}
                          </Button>
                          <Button
                            className="text-button"
                            disabled={pending}
                            onClick={() =>
                              run({ type: "revoke-invite", guestId: g.id })
                            }
                          >
                            Revoke link for {g.name}
                          </Button>
                        </div>
                        {!g.taken &&
                        invitationLinks.find(
                          (link) => link.guestId === g.id,
                        ) ? (
                          <label className="field">
                            Private link for {g.name}
                            <input
                              readOnly
                              value={
                                invitationLinks.find(
                                  (link) => link.guestId === g.id,
                                )!.url
                              }
                              onFocus={(e) => e.currentTarget.select()}
                            />
                          </label>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
              {!dinner.guest &&
              dinner.identityMode === "account" &&
              !dinner.organiser ? (
                <section className="panel">
                  <SectionHeading
                    eyebrow="Your invitation"
                    title="Sign in with your invited email"
                    text="Open the personal invitation your organiser sent you, then sign in with that same email. The shared dinner link cannot claim a guest name."
                  />
                  <Link className="button" href="/account">
                    Sign in
                  </Link>
                </section>
              ) : null}
              {!dinner.guest &&
              dinner.identityMode !== "account" &&
              beforeVote(dinner) ? (
                <section className="panel">
                  <SectionHeading
                    eyebrow="Your invitation"
                    title="Who are you?"
                    text="Choose your name once. Use this browser when you return to reply or vote."
                  />
                  <div className="claim-list">
                    {dinner.guests.map((g) => (
                      <Button
                        key={g.id}
                        className="claim-button"
                        disabled={pending || g.taken}
                        onClick={() => run({ type: "claim", guestId: g.id })}
                      >
                        <span>{g.name}</span>
                        <span>{g.taken ? "Taken" : "That’s me →"}</span>
                      </Button>
                    ))}
                  </div>
                  <p className="field-hint">
                    If your name is taken or you lose browser access, ask your
                    organiser to reset your reply before voting begins.
                  </p>
                </section>
              ) : null}
              {dinner.guest && dinner.canReply ? (
                <ReplyForm
                  key={dinner.guest.id}
                  dinner={dinner}
                  pending={pending}
                  run={run}
                />
              ) : null}
              {dinner.guest &&
              !dinner.canReply &&
              dinner.stage === "collecting" ? (
                <section className="panel">
                  <h2>Replies are paused</h2>
                  <p className="muted">
                    Your organiser can extend the reply deadline if the group
                    needs more time.
                  </p>
                </section>
              ) : null}
              {dinner.experience === "v2" &&
              dinner.organiser &&
              ["choosing-time", "recommending"].includes(dinner.stage) ? (
                <section className="panel">
                  <SectionHeading
                    eyebrow="A budget together"
                    title="Choose the group’s price band"
                    text="Price bands are relative, not a guaranteed cost per person. Choose a shared band when one is available."
                  />
                  {!commonBudgets.length ? (
                    <p role="status" className="feedback">
                      No price band is accepted by every included guest. Reopen
                      replies to review the conflict, or explicitly choose an
                      organiser override below. An override does not mean
                      everyone agreed to this budget.
                    </p>
                  ) : null}
                  <div className="action-row">
                    {BUDGETS.filter(
                      (b) =>
                        !commonBudgets.length || commonBudgets.includes(b.band),
                    ).map((b) => (
                      <Button
                        className={`button ${selectedBudget === b.band ? "" : "secondary"}`}
                        key={b.band}
                        disabled={pending || selectedBudget === b.band}
                        onClick={() => {
                          if (
                            commonBudgets.length ||
                            window.confirm(
                              `Choose ${b.label} as an organiser override? This price band is not accepted by every included guest. Check with the group before confirming a venue.`,
                            )
                          )
                            run({ type: "budget", band: b.band });
                        }}
                      >
                        {b.label}
                        {selectedBudget === b.band
                          ? " · Selected"
                          : !commonBudgets.length
                            ? " · Override"
                            : ""}
                      </Button>
                    ))}
                  </div>
                </section>
              ) : null}
              {dinner.stage === "choosing-time" ? (
                <section className="panel">
                  <SectionHeading
                    eyebrow="A time together"
                    title={
                      dinner.slots.length
                        ? "Here’s the overlap"
                        : "No shared time yet"
                    }
                    text={
                      dinner.slots.length
                        ? dinner.organiser
                          ? "Choose a start time before we compare meeting areas."
                          : "Your organiser will choose from the times everyone can make."
                        : "Your organiser can widen the date window and reopen replies."
                    }
                  />
                  {dinner.slots.length ? (
                    <div className="slot-list">
                      {dinner.slots.map((slot) =>
                        dinner.organiser ? (
                          <Button
                            className="slot-button"
                            key={slot}
                            disabled={pending}
                            onClick={() => run({ type: "slot", start: slot })}
                          >
                            {dateTime(slot)} <span aria-hidden="true">→</span>
                          </Button>
                        ) : (
                          <div className="slot-button" key={slot}>
                            {dateTime(slot)}
                          </div>
                        ),
                      )}
                    </div>
                  ) : null}
                </section>
              ) : null}
              {dinner.stage === "recommending" ? (
                <section className="panel">
                  <SectionHeading
                    eyebrow="The right meeting point"
                    title="Find a fair area"
                    text={
                      dinner.organiser
                        ? "Compare everyone’s journeys there and home for the selected dinner time."
                        : "Your organiser is finding suitable meeting areas for the group."
                    }
                  />
                  {dinner.organiser ? (
                    <Button
                      className="button"
                      disabled={
                        pending ||
                        (dinner.experience === "v2" && !selectedBudget)
                      }
                      onClick={() => run({ type: "recommend" })}
                    >
                      {pending ? "Finding areas…" : "Find meeting areas"}{" "}
                      <span aria-hidden="true">↗</span>
                    </Button>
                  ) : null}
                </section>
              ) : null}
              {dinner.stage === "area-voting" ? (
                <AreaVote dinner={dinner} pending={pending} run={run} />
              ) : null}
              {dinner.stage === "choosing-restaurant" ? (
                <RestaurantChoice dinner={dinner} pending={pending} run={run} />
              ) : null}
              {dinner.guest?.reply?.attending &&
              dinner.identityMode !== "account" ? (
                <details className="panel email-details">
                  <summary>
                    Get the two dinner updates by email{" "}
                    <span className="muted small">Optional</span>
                  </summary>
                  <EmailSignup slug={dinner.id} />
                </details>
              ) : null}
            </>
          ) : (
            <section className="panel confirmed-panel">
              <span className="confirmation-mark" aria-hidden="true">
                ✓
              </span>
              <span className="eyebrow">See you there</span>
              <h2>{dinner.restaurant?.name}</h2>
              <p className="confirmed-address">{dinner.restaurant?.address}</p>
              <div className="confirmation-facts">
                <div>
                  <span>Date & time</span>
                  <strong>
                    {dateTime(dinner.selectedStart ?? dinner.fixedStart!)}
                  </strong>
                </div>
                <div>
                  <span>
                    {dinner.restaurant?.station &&
                    !dinner.restaurant.station.startsWith("Area station:")
                      ? "Nearby station"
                      : "Area station"}
                  </span>
                  <strong>
                    {dinner.restaurant?.station?.replace(
                      /^Area station:\s*/,
                      "",
                    ) ??
                      area?.name ??
                      "See venue map"}
                  </strong>
                </div>
                <div>
                  <span>Joining</span>
                  <strong>{included.map((g) => g.name).join(", ")}</strong>
                </div>
              </div>
              <div className="action-row">
                {dinner.restaurant?.mapUrl ? (
                  <a
                    className="button secondary"
                    href={dinner.restaurant.mapUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View the venue map ↗
                  </a>
                ) : null}
                <CalendarButtons dinner={dinner} />
              </div>
              {dinner.organiser ? (
                <CopyMessage dinner={dinner} confirmed />
              ) : null}
            </section>
          )}
        </div>
        <aside className="dinner-aside">
          {dinner.stage !== "confirmed" ? (
            <section className="aside-block">
              <span className="eyebrow">Reply by</span>
              <p className="deadline">{dateTime(dinner.deadline)}</p>
              <p className="muted small">
                The organiser can extend this if more time is needed.
              </p>
              {dinner.organiser &&
              beforeVote(dinner) &&
              dinner.identityMode !== "account" ? (
                <CopyMessage dinner={dinner} />
              ) : null}
            </section>
          ) : null}
          <section className="aside-block">
            <span className="eyebrow">A fair trip</span>
            <p>
              We compare the longest journey in the group, including the trip
              home.
            </p>
            <p className="muted small">
              Your starting point and food details stay in your own guest view.
            </p>
          </section>
          {dinner.organiser && beforeVote(dinner) ? (
            <OrganiserTools dinner={dinner} pending={pending} run={run} />
          ) : null}
          {dinner.stage === "confirmed" ? (
            <section className="aside-block">
              <span className="eyebrow">Make the next plan</span>
              <h2>Want to host?</h2>
              <p className="muted small">
                Join the creator waitlist for future access.
              </p>
              <Waitlist />
            </section>
          ) : null}
        </aside>
      </main>
      <footer className="wrap dinner-footer">
        <Link href="/">Agent Meet</Link>
        <span>A little closer, together.</span>
        <a
          href="https://www.linkedin.com/in/phliem"
          target="_blank"
          rel="noreferrer"
        >
          Created by Liem ↗
        </a>
      </footer>
    </>
  );
}

function SectionHeading({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text?: string;
}) {
  return (
    <div className="section-heading compact">
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {text ? <p className="muted">{text}</p> : null}
    </div>
  );
}

function ReplyForm({
  dinner,
  pending,
  run,
}: {
  dinner: DinnerView;
  pending: boolean;
  run: Run;
}) {
  const reply = dinner.guest?.reply;
  const [attending, setAttending] = useState(reply?.attending !== false);
  const [windows, setWindows] = useState(
    reply?.availability.length
      ? reply.availability.map((w, id) => ({
          id,
          start: londonInput(w.start),
          end: londonInput(w.end),
        }))
      : [{ id: 0, start: "", end: "" }],
  );
  const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const cuisines: Record<string, string> = {};
      CUISINES.forEach((cuisine) => {
        const value = String(data.get(`cuisine-${cuisine}`) ?? "");
        if (value) cuisines[cuisine] = value;
      });
      run({
        type: "reply",
        reply: {
          attending,
          availability:
            attending && dinner.mode === "flexible"
              ? windows.map((_, index) => ({
                  start: londonISO(String(data.get(`start-${index}`))),
                  end: londonISO(String(data.get(`end-${index}`))),
                }))
              : [],
          origin: attending ? data.get("origin") : "",
          diets: attending ? data.getAll("diets") : [],
          otherDiet: attending ? data.get("otherDiet") : "",
          cuisines: attending ? cuisines : {},
          ...(dinner.experience === "v2"
            ? { budgets: attending ? data.getAll("budgets") : [] }
            : {}),
        },
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Check your availability times.",
      );
    }
  }
  return (
    <section className="panel">
      <SectionHeading
        eyebrow={`Your reply · ${dinner.guest?.name}`}
        title={reply ? "Your dinner details" : "Let’s get you there"}
        text={
          dinner.mode === "fixed"
            ? `Can you join on ${dateTime(dinner.fixedStart!)}?`
            : "Share when you’re free and what works for you."
        }
      />
      <form className="stack" onSubmit={submit}>
        <fieldset className="field">
          <legend>Can you make it?</legend>
          <div className="segmented">
            <label>
              <input
                type="radio"
                name="attending"
                checked={attending}
                onChange={() => setAttending(true)}
              />{" "}
              {dinner.mode === "fixed"
                ? "Yes, I can come"
                : "Let’s find a time"}
            </label>
            <label>
              <input
                type="radio"
                name="attending"
                checked={!attending}
                onChange={() => setAttending(false)}
              />{" "}
              I can’t attend
            </label>
          </div>
        </fieldset>
        {attending ? (
          <>
            {dinner.mode === "flexible" ? (
              <fieldset className="field">
                <legend>When are you free? · London time</legend>
                <p className="field-hint">
                  Choose within {dateOnly(dinner.dateStart)} –{" "}
                  {dateOnly(dinner.dateEnd)}. Allow {dinner.duration / 60} hours
                  for dinner.
                </p>
                {windows.map((window, index) => (
                  <div className="availability-row" key={window.id}>
                    <div className="field">
                      <label htmlFor={`start-${index}`}>From</label>
                      <input
                        id={`start-${index}`}
                        name={`start-${index}`}
                        type="datetime-local"
                        step={1800}
                        required
                        defaultValue={window.start}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`end-${index}`}>Until</label>
                      <input
                        id={`end-${index}`}
                        name={`end-${index}`}
                        type="datetime-local"
                        step={1800}
                        required
                        defaultValue={window.end}
                      />
                    </div>
                    {windows.length > 1 ? (
                      <Button
                        type="button"
                        className="text-button"
                        onClick={() =>
                          setWindows(windows.filter((w) => w.id !== window.id))
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                ))}
                <Button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setWindows([
                      ...windows,
                      {
                        id: Math.max(...windows.map((w) => w.id)) + 1,
                        start: "",
                        end: "",
                      },
                    ])
                  }
                >
                  + Add another time
                </Button>
              </fieldset>
            ) : null}
            <div className="field">
              <label htmlFor="origin">Your starting station or postcode</label>
              <input
                id="origin"
                name="origin"
                required
                defaultValue={reply?.location?.label ?? ""}
                placeholder="e.g. Brixton or SW9 8HE"
                autoComplete="off"
              />
              <p className="field-hint">
                For your journey there and back. Only your own guest view shows
                this.
              </p>
            </div>
            {dinner.experience === "v2" ? (
              <fieldset className="field">
                <legend>Which price bands work for you?</legend>
                <p className="field-hint">
                  Select every band you’re comfortable with. Medium is selected
                  initially. Bands are relative; check the venue’s menu for
                  actual prices. Your individual choices stay private.
                </p>
                <div className="check-grid">
                  {BUDGETS.map((b) => (
                    <label className="check-label" key={b.band}>
                      <input
                        type="checkbox"
                        name="budgets"
                        value={b.band}
                        defaultChecked={(reply?.budgets ?? ["medium"]).includes(
                          b.band,
                        )}
                      />
                      {b.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <fieldset className="field">
              <legend>Dietary requirements</legend>
              <p className="field-hint">
                Select any that apply. Your organiser checks the restaurant’s
                suitability.
              </p>
              <div className="check-grid">
                {DIETS.map((diet) => (
                  <label className="check-label" key={diet}>
                    <input
                      type="checkbox"
                      name="diets"
                      value={diet}
                      defaultChecked={reply?.diets.includes(diet)}
                    />
                    {diet}
                  </label>
                ))}
              </div>
              <label htmlFor="otherDiet">Anything else?</label>
              <input
                id="otherDiet"
                name="otherDiet"
                defaultValue={reply?.otherDiet ?? ""}
                placeholder="Other requirements (optional)"
                maxLength={500}
              />
            </fieldset>
            <fieldset className="field">
              <legend>What would you like to eat?</legend>
              <p className="field-hint">
                Mark your preferences. Leave any cuisine neutral if you don’t
                mind.
              </p>
              <div className="cuisine-list">
                {CUISINES.map((cuisine) => (
                  <div className="cuisine-row" key={cuisine}>
                    <label htmlFor={`cuisine-${cuisine}`}>{cuisine}</label>
                    <select
                      id={`cuisine-${cuisine}`}
                      name={`cuisine-${cuisine}`}
                      defaultValue={reply?.cuisines[cuisine] ?? ""}
                    >
                      <option value="">No preference</option>
                      <option value="prefer">Prefer</option>
                      <option value="okay">Happy with</option>
                      <option value="no">No thanks</option>
                    </select>
                  </div>
                ))}
              </div>
            </fieldset>
          </>
        ) : (
          <p className="muted">
            We’ll mark you as replied, so the group can continue. You can change
            this before the group’s time is selected.
          </p>
        )}
        <Status error={error} />
        <Button className="button" type="submit" disabled={pending}>
          {attending
            ? reply
              ? "Save my changes"
              : "Save my reply"
            : "I can’t attend"}
        </Button>
      </form>
    </section>
  );
}

function AreaVote({
  dinner,
  pending,
  run,
}: {
  dinner: DinnerView;
  pending: boolean;
  run: Run;
}) {
  const [favourite, setFavourite] = useState(
    dinner.guest?.ballot?.none
      ? "none"
      : (dinner.guest?.ballot?.favourite ?? ""),
  );
  const [acceptable, setAcceptable] = useState(
    dinner.guest?.ballot?.acceptable ?? [],
  );
  const [error, setError] = useState("");
  const included =
    !!dinner.guest && !!dinner.includedIds?.includes(dinner.guest.id);
  const canVote = included && !dinner.votesClosed;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!favourite) {
      setError("Choose a favourite or select No acceptable area.");
      return;
    }
    run({
      type: "vote",
      ballot: {
        favourite: favourite === "none" ? null : favourite,
        acceptable:
          favourite === "none"
            ? []
            : acceptable.filter((id) => id !== favourite),
        none: favourite === "none",
      },
    });
  }
  return (
    <section className="panel">
      <SectionHeading
        eyebrow="Your meeting point"
        title={dinner.votesClosed ? "The votes are in" : "Where shall we meet?"}
        text={
          canVote
            ? "Pick one favourite and any other areas you’re happy with. Your favourite also counts as acceptable."
            : dinner.votesClosed
              ? "Your organiser will resolve the area choice."
              : "The group is comparing these meeting areas."
        }
      />
      <form className="stack" onSubmit={submit}>
        {dinner.areas.map((area) => {
          const own = area.journeys.find((j) => j.guestId === dinner.guest?.id);
          return (
            <fieldset
              key={area.id}
              className={`area-card ${favourite === area.id ? "chosen" : ""}`}
            >
              <legend>{area.name}</legend>
              <p className="muted small">{area.explanation}</p>
              {own ? (
                <div className="journey-pair">
                  <div>
                    <span>Your trip there</span>
                    <strong>
                      {own.outbound}
                      <small> min</small>
                    </strong>
                  </div>
                  <div>
                    <span>Your trip home</span>
                    <strong>
                      {own.homeward}
                      <small> min</small>
                    </strong>
                  </div>
                </div>
              ) : (
                <p className="muted">Longest journey · {area.longest} min</p>
              )}
              <details className="journey-details">
                <summary>Everyone’s journeys</summary>
                {area.journeys.map((j) => (
                  <div key={j.guestId}>
                    <span>
                      {dinner.guests.find((g) => g.id === j.guestId)?.name ??
                        "Guest"}
                    </span>
                    <span>
                      {j.outbound} min there · {j.homeward} min home
                    </span>
                  </div>
                ))}
              </details>
              {canVote ? (
                <div className="ballot-controls">
                  <label>
                    <input
                      type="radio"
                      name="favourite"
                      value={area.id}
                      checked={favourite === area.id}
                      onChange={() => setFavourite(area.id)}
                    />{" "}
                    My favourite
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={
                        acceptable.includes(area.id) || favourite === area.id
                      }
                      disabled={favourite === area.id || favourite === "none"}
                      onChange={(e) =>
                        setAcceptable(
                          e.target.checked
                            ? [...acceptable, area.id]
                            : acceptable.filter((id) => id !== area.id),
                        )
                      }
                    />{" "}
                    Happy with this
                  </label>
                </div>
              ) : null}
            </fieldset>
          );
        })}
        {canVote ? (
          <>
            <label className="check-label">
              <input
                type="radio"
                name="favourite"
                value="none"
                checked={favourite === "none"}
                onChange={() => {
                  setFavourite("none");
                  setAcceptable([]);
                }}
              />{" "}
              No acceptable area
            </label>
            <Status error={error} />
            <Button type="submit" className="button" disabled={pending}>
              {dinner.guest?.ballot ? "Update my vote" : "Save my vote"}
            </Button>
          </>
        ) : null}
      </form>
      {dinner.organiser ? (
        <div className="organiser-vote">
          <span className="eyebrow">Organiser controls</span>
          {!dinner.votesClosed ? (
            <>
              <p className="muted small">
                You can close voting early. Missing votes won’t be treated as
                agreement.
              </p>
              <Button
                className="button secondary"
                disabled={pending}
                onClick={() => {
                  if (
                    window.confirm(
                      "Close voting now? You’ll choose an area if a unanimous result is unavailable.",
                    )
                  )
                    run({ type: "close-vote" });
                }}
              >
                Close voting
              </Button>
            </>
          ) : (
            <div className="stack">
              <p className="muted">
                Choose an area after reviewing the group’s replies.
              </p>
              {dinner.areas.map((area) => (
                <Button
                  className="slot-button"
                  disabled={pending}
                  key={area.id}
                  onClick={() => run({ type: "area", areaId: area.id })}
                >
                  Choose {area.name} <span aria-hidden="true">→</span>
                </Button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function RestaurantChoice({
  dinner,
  pending,
  run,
}: {
  dinner: DinnerView;
  pending: boolean;
  run: Run;
}) {
  const area = dinner.areas.find((a) => a.id === dinner.selectedAreaId);
  const [verifiedId, setVerifiedId] = useState("");
  function manual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    run({
      type: "manual-restaurant",
      name: f.get("name"),
      address: f.get("address"),
      mapUrl: f.get("mapUrl"),
    });
  }
  return (
    <section className="panel">
      <SectionHeading
        eyebrow={area?.name ?? "Restaurant choice"}
        title={
          dinner.organiser ? "Find your dinner spot" : "The area is chosen"
        }
        text={
          dinner.organiser
            ? "Review the options and check opening hours and dietary suitability before confirming."
            : "Your organiser is choosing and checking a restaurant."
        }
      />
      {dinner.experience === "v2" ? (
        dinner.recommendation ? (
          <div className="feedback recommendation">
            <span className="eyebrow">Recommended dinner spot</span>
            <h3>
              {dinner.restaurants.find(
                (r) => r.id === dinner.recommendation!.restaurantId,
              )?.name ?? "Recommended venue"}
            </h3>
            <p>{dinner.recommendation.reason}</p>
            <p className="field-hint">
              Review the evidence below. Your organiser still checks and
              confirms the venue; alternatives and manual entry remain
              available.
            </p>
          </div>
        ) : (
          <p className="feedback">
            {dinner.recommendationFallback ??
              "There is not enough verified venue evidence for a recommendation. Review the suggestions or enter a venue and check its details yourself."}
          </p>
        )
      ) : null}
      {dinner.restaurants.length ? (
        <div className="restaurant-list">
          {[...dinner.restaurants]
            .sort(
              (a, b) =>
                Number(b.id === dinner.recommendation?.restaurantId) -
                Number(a.id === dinner.recommendation?.restaurantId),
            )
            .map((restaurant) => (
              <RestaurantCard
                key={restaurant.id}
                restaurant={restaurant}
                showEvidence={dinner.experience === "v2"}
                action={
                  dinner.organiser ? (
                    <Button
                      className="button secondary"
                      disabled={pending}
                      onClick={() =>
                        run({ type: "restaurant", restaurantId: restaurant.id })
                      }
                    >
                      {dinner.restaurant?.id === restaurant.id
                        ? "Selected"
                        : "Choose this restaurant"}
                    </Button>
                  ) : null
                }
              />
            ))}
        </div>
      ) : (
        <p className="muted">
          There are no supported restaurant matches to show.{" "}
          {dinner.organiser
            ? "You can enter a restaurant you know in the chosen area."
            : "Your organiser can find a suitable venue."}
        </p>
      )}
      {dinner.dataMode === "live" ? (
        <p className="field-hint">
          Restaurant data ©{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            OpenStreetMap contributors
          </a>{" "}
          · ODbL. Check details with the venue.
        </p>
      ) : null}
      {dinner.organiser ? (
        <>
          <Button
            className="button secondary"
            disabled={pending}
            onClick={() => run({ type: "restaurants" })}
          >
            {dinner.restaurants.length
              ? "Refresh restaurant suggestions"
              : "Find restaurant suggestions"}
          </Button>
          <details className="manual-venue">
            <summary>Have somewhere in mind? Enter a restaurant</summary>
            <form className="stack" onSubmit={manual}>
              <div className="field">
                <label htmlFor="venue-name">Restaurant name</label>
                <input id="venue-name" name="name" required maxLength={150} />
              </div>
              <div className="field">
                <label htmlFor="venue-address">Street address</label>
                <input
                  id="venue-address"
                  name="address"
                  required
                  maxLength={300}
                />
              </div>
              <div className="field">
                <label htmlFor="venue-map">Map link (optional)</label>
                <input
                  id="venue-map"
                  name="mapUrl"
                  type="url"
                  placeholder="https://…"
                />
              </div>
              <Button
                className="button secondary"
                type="submit"
                disabled={pending}
              >
                Save this restaurant
              </Button>
            </form>
          </details>
          <Button
            className="text-button"
            disabled={pending}
            onClick={() => run({ type: "no-restaurant" })}
          >
            No suitable restaurant
          </Button>
          {dinner.restaurant ? (
            <div className="confirm-choice">
              <span className="eyebrow">Your selected restaurant</span>
              <h3>{dinner.restaurant.name}</h3>
              <p>{dinner.restaurant.address}</p>
              <p className="field-hint">
                Confirm once you’ve checked the venue. The final plan becomes
                read-only and optional confirmation emails are triggered.
              </p>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={verifiedId === dinner.restaurant.id}
                  onChange={(e) =>
                    setVerifiedId(e.target.checked ? dinner.restaurant!.id : "")
                  }
                />{" "}
                I checked the venue details and suitability.
              </label>
              <Button
                className="button"
                disabled={pending || verifiedId !== dinner.restaurant.id}
                onClick={() => {
                  if (
                    window.confirm(
                      "Confirm this dinner? The final plan will be read-only.",
                    )
                  )
                    run({ type: "confirm", verified: true });
                }}
              >
                Confirm dinner <span aria-hidden="true">↗</span>
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function RestaurantCard({
  restaurant,
  action,
  showEvidence = false,
}: {
  restaurant: Restaurant;
  showEvidence?: boolean;
  action: ReactNode;
}) {
  return (
    <article className="restaurant-card">
      <div className="row-between">
        <h3>{restaurant.name}</h3>
        <span className="pill">
          {restaurant.price === "unknown"
            ? "Price unknown"
            : `${restaurant.price} price`}
        </span>
      </div>
      <p className="muted small">{restaurant.address}</p>
      <p>
        {restaurant.cuisines.length
          ? restaurant.cuisines.join(" · ")
          : "Cuisine unknown"}
      </p>
      <p className="small">{restaurant.hours || "Opening hours unknown"}</p>
      <p className="small muted">
        {restaurant.dietaryEvidence.length
          ? restaurant.dietaryEvidence.join(" · ")
          : "Dietary suitability unknown. Check with the venue."}
      </p>
      {showEvidence ? (
        restaurant.evidence ? (
          <p className="field-hint">
            {restaurant.evidence.source === "fixture"
              ? "Synthetic preview evidence"
              : "Venue evidence"}{" "}
            · checked {dateTime(restaurant.evidence.checkedAt)} ·{" "}
            {restaurant.evidence.priceBand} price · opening{" "}
            {dateTime(restaurant.evidence.opening.start)} –{" "}
            {dateTime(restaurant.evidence.opening.end)}.{" "}
            {restaurant.evidence.diets.length
              ? `Supported dietary requirements: ${restaurant.evidence.diets.join(", ")}.`
              : "No dietary suitability verified."}
          </p>
        ) : (
          <p className="field-hint">
            Price, opening and dietary evidence has not been verified for an
            automatic recommendation.
          </p>
        )
      ) : null}
      <div className="action-row">
        {restaurant.sourceUrl ? (
          <a href={restaurant.sourceUrl} target="_blank" rel="noreferrer">
            Check venue details ↗
          </a>
        ) : null}
        {action}
      </div>
    </article>
  );
}

function OrganiserTools({
  dinner,
  pending,
  run,
}: {
  dinner: DinnerView;
  pending: boolean;
  run: Run;
}) {
  const [error, setError] = useState("");
  function update(event: FormEvent<HTMLFormElement>, reopen: boolean) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      run({
        type: reopen ? "reopen" : "extend",
        deadline: londonISO(String(data.get("deadline"))),
        ...(reopen
          ? { dateStart: data.get("dateStart"), dateEnd: data.get("dateEnd") }
          : {}),
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Check the new deadline.",
      );
    }
  }
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(interval);
  }, []);
  const expired = new Date(dinner.deadline).getTime() <= now;
  return (
    <details className="aside-block organiser-tools">
      <summary>Manage replies</summary>
      <div className="stack">
        {expired ? (
          <>
            <p className="muted small">
              The reply deadline has passed. Extend it or explicitly continue
              with attending respondents.
            </p>
            <Button
              className="button secondary"
              disabled={pending}
              onClick={() => {
                if (
                  window.confirm(
                    "Continue with only those who have replied and can attend?",
                  )
                )
                  run({ type: "continue" });
              }}
            >
              Continue with respondents
            </Button>
          </>
        ) : null}
        <form className="stack" onSubmit={(e) => update(e, false)}>
          <div className="field">
            <label htmlFor="new-deadline">
              New reply deadline · London time
            </label>
            <input
              id="new-deadline"
              type="datetime-local"
              name="deadline"
              required
              step={1800}
            />
          </div>
          <Button className="button secondary" type="submit" disabled={pending}>
            Extend reply deadline
          </Button>
        </form>
        {dinner.mode === "flexible" ? (
          <details>
            <summary>Widen the date window</summary>
            <form className="stack" onSubmit={(e) => update(e, true)}>
              <div className="field">
                <label htmlFor="new-date-start">First possible date</label>
                <input
                  id="new-date-start"
                  name="dateStart"
                  type="date"
                  defaultValue={dinner.dateStart.slice(0, 10)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="new-date-end">Last possible date</label>
                <input
                  id="new-date-end"
                  name="dateEnd"
                  type="date"
                  defaultValue={dinner.dateEnd.slice(0, 10)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="reopen-deadline">
                  New deadline · London time
                </label>
                <input
                  id="reopen-deadline"
                  name="deadline"
                  type="datetime-local"
                  required
                  step={1800}
                />
              </div>
              <Button
                className="button secondary"
                type="submit"
                disabled={pending}
              >
                Reopen replies
              </Button>
            </form>
          </details>
        ) : null}
        <Status error={error} />
      </div>
    </details>
  );
}

function CopyMessage({
  dinner,
  confirmed = false,
}: {
  dinner: DinnerView;
  confirmed?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState("");
  async function copy() {
    const link = `${window.location.origin}/d/${dinner.id}`;
    const date =
      dinner.mode === "fixed"
        ? `on ${dateTime(dinner.fixedStart!)}`
        : `between ${dateOnly(dinner.dateStart)} and ${dateOnly(dinner.dateEnd)}`;
    const area = dinner.areas.find((a) => a.id === dinner.selectedAreaId);
    const text = confirmed
      ? [
          `${dinner.title} — confirmed!`,
          `${dateTime(dinner.selectedStart ?? dinner.fixedStart!)} (London time)`,
          `${dinner.restaurant?.name}, ${dinner.restaurant?.address}`,
          `${dinner.restaurant?.station && !dinner.restaurant.station.startsWith("Area station:") ? "Nearby station" : "Area station"}: ${dinner.restaurant?.station?.replace(/^Area station:\s*/, "") ?? area?.name ?? "See venue map"}`,
          dinner.restaurant?.mapUrl,
          `The plan: ${link}`,
        ]
          .filter(Boolean)
          .join("\n")
      : [
          `Dinner in London ${date}?`,
          `Please ${dinner.mode === "fixed" ? "confirm whether you can come" : "add the times you can make"} by ${dateTime(dinner.deadline)} (London time). If you can come, add your starting station or postcode and any food preferences.`,
          `Pick your name and reply here: ${link}`,
        ].join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFallback("");
    } catch {
      setFallback(text);
      setCopied(false);
    }
  }
  return (
    <div className="copy-control">
      <Button type="button" className="button secondary" onClick={copy}>
        {copied
          ? "Copied ✓"
          : confirmed
            ? "Copy dinner details"
            : "Copy invite"}
      </Button>
      {copied ? (
        <span className="field-hint" role="status">
          Ready to paste into the group chat.
        </span>
      ) : null}
      {fallback ? (
        <div className="field">
          <label htmlFor={`copy-${confirmed ? "plan" : "invite"}`}>
            Select and copy this message
          </label>
          <textarea
            id={`copy-${confirmed ? "plan" : "invite"}`}
            readOnly
            value={fallback}
            rows={7}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      ) : null}
    </div>
  );
}

function CalendarButtons({ dinner }: { dinner: DinnerView }) {
  return (
    <details className="calendar-options">
      <summary className="button secondary">
        Add to calendar <span aria-hidden="true">＋</span>
      </summary>
      <div className="calendar-menu">
        {dinner.googleCalendarUrl ? (
          <a href={dinner.googleCalendarUrl} target="_blank" rel="noreferrer">
            Google Calendar ↗
          </a>
        ) : null}
        <a href={`/api/calendar/${dinner.id}`}>
          Apple Calendar / calendar file ↓
        </a>
        <span className="field-hint">
          Save a one-time event to your own calendar.
        </span>
      </div>
    </details>
  );
}
