import Link from "next/link";
import { homeContext } from "@/lib/actions";
import { CreateDinner, Waitlist } from "@/components/forms";

export const dynamic = "force-dynamic";

export default async function Home() {
  const context = await homeContext();
  const source =
    process.env.NEXT_PUBLIC_REPO_URL || "https://github.com/phliem/agent-meet";
  return (
    <>
      <header className="site-header wrap">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            m
          </span>{" "}
          Agent Meet
        </Link>
        {context.v2Enabled ? (
          <Link className="quiet-link" href="/account">
            {context.account ? "Your account" : "Sign in"}
          </Link>
        ) : null}
        <a className="quiet-link" href="#how-it-works">
          How it works <span aria-hidden="true">↗</span>
        </a>
      </header>
      <main>
        <section className="hero wrap">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="live-dot" /> Made for London evenings
            </span>
            <h1>
              Less planning.
              <br />
              More <span>dinner.</span>
            </h1>
            <p className="hero-description">
              The group chat has enough messages. Find a time and a place that
              works for everyone, then get together.
            </p>
            <a
              className="button"
              href={context.canCreate ? "#create" : "#waitlist"}
            >
              {context.canCreate
                ? "Create a dinner"
                : "Join the creator waitlist"}{" "}
              <span aria-hidden="true">↗</span>
            </a>
            <p className="micro">
              {context.canCreate
                ? "Your organiser invitation is active."
                : "Hosting is invite-only during our first London pilot."}
            </p>
          </div>
          <div
            className="hero-preview"
            aria-label="Illustrative area vote preview"
          >
            <div className="preview-top">
              <span className="tiny-brand">Agent Meet</span>
              <span className="pill">Friday dinner</span>
            </div>
            <div className="preview-content">
              <span className="eyebrow">The plan is coming together</span>
              <h2>
                A fair place
                <br />
                for all six of you.
              </h2>
              <div className="preview-date">
                Friday · 7:30 pm <span>London</span>
              </div>
              <div className="preview-area">
                <div>
                  <span className="micro">MEETING AREA</span>
                  <strong>King’s Cross</strong>
                  <span className="muted small">
                    Well connected. Plenty to choose from.
                  </span>
                </div>
                <span className="station-symbol" aria-hidden="true">
                  ↔
                </span>
              </div>
              <div className="preview-journeys">
                <div>
                  <span>Your trip there</span>
                  <strong>
                    24 <small>min</small>
                  </strong>
                </div>
                <div>
                  <span>Your trip home</span>
                  <strong>
                    27 <small>min</small>
                  </strong>
                </div>
              </div>
              <div className="preview-vote">
                <span>
                  <span className="fake-check" aria-hidden="true">
                    ✓
                  </span>{" "}
                  My favourite
                </span>
                <span>3 of 6 voted</span>
              </div>
              <p className="example-note">
                Illustrative example · not a live recommendation
              </p>
            </div>
          </div>
        </section>
        <section id="how-it-works" className="how wrap">
          <div className="section-heading">
            <span className="eyebrow">A small plan. A lovely evening.</span>
            <h2>
              From “we should”
              <br />
              to “see you there.”
            </h2>
          </div>
          <div className="steps">
            <article>
              <span className="step-number">01</span>
              <h3>Send one link</h3>
              <p>
                Add your friends and choose a date, or find one together.
                Everyone replies in their browser.
              </p>
            </article>
            <article>
              <span className="step-number">02</span>
              <h3>Meet fairly</h3>
              <p>
                Compare London areas by everyone’s public transport journeys,
                including the way home.
              </p>
            </article>
            <article>
              <span className="step-number">03</span>
              <h3>Make it dinner</h3>
              <p>
                Vote on an area. Your organiser finds the restaurant and
                confirms the final plan.
              </p>
            </article>
          </div>
        </section>
        <section className="principles wrap">
          <div>
            <span aria-hidden="true">↗</span>
            <p>
              <strong>Your starting point stays yours.</strong> The group sees
              journey estimates, not your station or postcode.
            </p>
          </div>
          <div>
            <span aria-hidden="true">♡</span>
            <p>
              <strong>A little room for everyone.</strong> Share what you love
              to eat and what you need to avoid.
            </p>
          </div>
        </section>
        {context.canCreate ? (
          <section id="create" className="form-section wrap">
            <div className="section-heading">
              <span className="eyebrow">You bring the people</span>
              <h2>Let’s make a plan.</h2>
              <p className="muted">
                Create the dinner in this browser. Keep its browser data so you
                can return to manage it.
              </p>
            </div>
            <CreateDinner
              v2Enabled={context.v2Enabled}
              signedIn={!!context.account}
            />
          </section>
        ) : null}
        <section id="waitlist" className="waitlist-section wrap">
          <div>
            <span className="eyebrow">Your next dinner starts here</span>
            <h2>
              Be the one who
              <br />
              gets everyone together.
            </h2>
            <p>Join the creator waitlist for future hosting access.</p>
          </div>
          <Waitlist />
        </section>
      </main>
      <footer className="site-footer wrap">
        <Link className="brand" href="/">
          Agent Meet
          <span className="footer-note">A little closer, together.</span>
        </Link>
        <div>
          <a
            href="https://www.linkedin.com/in/phliem"
            target="_blank"
            rel="noreferrer"
          >
            Created by Liem ↗
          </a>
          {source && /^https:\/\/github\.com\//.test(source) ? (
            <a href={source} target="_blank" rel="noreferrer">
              Source on GitHub ↗
            </a>
          ) : null}
          <a href="#waitlist">Creator waitlist</a>
        </div>
      </footer>
    </>
  );
}
