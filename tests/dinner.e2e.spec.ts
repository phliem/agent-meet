import { test, expect } from "@playwright/test";
import postgres from "postgres";

// Each spec owns its fixture connection; Playwright may reuse a worker across files.
const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
import { digest, token } from "../src/lib/security";

const screenshotDir = process.env.E2E_SCREENSHOT_DIR || "test-results";
const day = (offset: number) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

test.afterAll(async () => {
  await sql.end();
});

test("an invited organiser and two browser-bound guests confirm a dinner", async ({
  browser,
}) => {
  const raw = token();
  await sql`INSERT INTO pilot_invites (hash, expires_at) VALUES (${digest(raw)}, now() + interval '1 hour')`;
  const host = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const friend = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const outsider = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await host.newPage();
  const guestPage = await friend.newPage();
  const stranger = await outsider.newPage();
  const errors: string[] = [];
  for (const p of [page, guestPage, stranger])
    p.on("pageerror", (error) => errors.push(error.message));
  try {
    await stranger.goto("/");
    await expect(
      stranger.getByRole("link", { name: /Join the creator waitlist/ }).first(),
    ).toBeVisible();
    expect(
      await stranger.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await stranger.screenshot({
      path: screenshotDir + "/agent-meet-homepage-mobile.png",
      fullPage: true,
    });
    await page.goto("/invite/" + raw);
    await page.getByRole("button", { name: "Activate my invitation" }).click();
    await expect(
      page.getByRole("heading", { name: "Let’s make a plan." }),
    ).toBeVisible();
    await page
      .getByLabel("Give your dinner a name")
      .fill("Synthetic friends dinner");
    await page.getByLabel("Your name", { exact: true }).fill("Sam");
    await page.getByLabel("Who’s coming?").fill("Sam\nPriya");
    await page.getByLabel("We have a date").check();
    await page
      .getByLabel("Dinner starts · London time")
      .fill(day(7) + "T19:30");
    await page.getByLabel("Reply by · London time").fill(day(1) + "T18:00");
    await page
      .getByRole("button", { name: /Create & get the invite link/ })
      .click();
    await expect(page).toHaveURL(/\/d\/[\w-]+/);
    const dinnerPath = new URL(page.url()).pathname;
    await page.getByRole("button", { name: /Sam.*That’s me/ }).click();
    await expect(
      page.getByLabel("Your starting station or postcode"),
    ).toBeVisible();
    await page.getByLabel("Your starting station or postcode").fill("SW1A 1AA");
    await page.getByLabel("Vegetarian", { exact: true }).check();
    await page.getByLabel("Japanese", { exact: true }).selectOption("prefer");
    await page.getByLabel("Mexican", { exact: true }).selectOption("no");
    await page
      .getByRole("button", { name: "Save my reply", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your dinner details" }),
    ).toBeVisible();
    await stranger.goto(dinnerPath);
    await expect(
      stranger.getByRole("button", { name: /Sam.*Taken/ }),
    ).toBeDisabled();
    await expect(
      stranger.getByLabel("Your starting station or postcode"),
    ).toHaveCount(0);
    await expect(stranger.locator("body")).not.toContainText("SW1A 1AA");
    await guestPage.goto(dinnerPath);
    await guestPage.getByRole("button", { name: /Priya.*That’s me/ }).click();
    await guestPage
      .getByLabel("Your starting station or postcode")
      .fill("Waterloo");
    await guestPage.getByLabel("Thai", { exact: true }).selectOption("okay");
    await guestPage
      .getByRole("button", { name: "Save my reply", exact: true })
      .click();
    await expect(
      guestPage.getByRole("heading", { name: "Where shall we meet?" }),
    ).toBeVisible({ timeout: 45000 });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Where shall we meet?" }),
    ).toBeVisible();
    const area = await guestPage
      .locator(".area-card legend")
      .first()
      .innerText();
    expect(
      await guestPage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await guestPage.screenshot({
      path: screenshotDir + "/agent-meet-preview.png",
      fullPage: true,
    });
    await page.screenshot({
      path: screenshotDir + "/agent-meet-ballot-desktop.png",
      fullPage: true,
    });
    await guestPage
      .locator(".area-card")
      .filter({ has: guestPage.locator("legend", { hasText: area }) })
      .getByLabel("My favourite")
      .check();
    await guestPage
      .getByRole("button", { name: "Save my vote", exact: true })
      .click();
    await page
      .locator(".area-card")
      .filter({ has: page.locator("legend", { hasText: area }) })
      .getByLabel("My favourite")
      .check();
    await page
      .getByRole("button", { name: "Save my vote", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Find your dinner spot" }),
    ).toBeVisible({ timeout: 45000 });
    await page.getByText("Have somewhere in mind? Enter a restaurant").click();
    await page
      .getByLabel("Restaurant name", { exact: true })
      .fill("Synthetic Dinner Table");
    await page.getByLabel("Street address").fill("1 Example Lane, London");
    await page.getByRole("button", { name: "Save this restaurant" }).click();
    await page
      .getByLabel("I checked the venue details and suitability.")
      .check();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: /Confirm dinner/ }).click();
    await expect(
      page.getByText("See you there", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Synthetic Dinner Table",
        exact: true,
      }),
    ).toBeVisible();
    await stranger.reload();
    await expect(
      stranger.getByRole("heading", {
        name: "Synthetic Dinner Table",
        exact: true,
      }),
    ).toBeVisible();
    await expect(stranger.locator("body")).not.toContainText("SW1A 1AA");
    await expect(
      stranger.getByText("1 Example Lane, London", { exact: true }),
    ).toBeVisible();
    await stranger.getByText("Add to calendar", { exact: false }).click();
    await expect(
      stranger.getByRole("link", { name: "Google Calendar" }),
    ).toBeVisible();
    await expect(
      stranger.getByRole("link", { name: /Apple Calendar/ }),
    ).toHaveAttribute("href", /\/api\/calendar\//);
    expect(errors).toEqual([]);
  } finally {
    await host.close();
    await friend.close();
    await outsider.close();
  }
});

test("six friends complete the same-link dinner flow", async ({ browser }) => {
  const raw = token();
  await sql`INSERT INTO pilot_invites (hash, expires_at) VALUES (${digest(raw)}, now() + interval '1 hour')`;
  const names = ["Sam", "Alex", "Priya", "Rory", "Morgan", "Jo"];
  const stations = [
    "Bank",
    "Waterloo",
    "Victoria",
    "Paddington",
    "Stratford",
    "London Bridge",
  ];
  const contexts = await Promise.all(
    names.map((_, index) =>
      browser.newContext({
        viewport: index
          ? { width: 390, height: 844 }
          : { width: 1280, height: 900 },
      }),
    ),
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const host = pages[0];
  try {
    await host.goto("/invite/" + raw);
    await host.getByRole("button", { name: "Activate my invitation" }).click();
    await host
      .getByLabel("Give your dinner a name")
      .fill("Six friends, one shared plan");
    await host.getByLabel("Your name", { exact: true }).fill("Sam");
    await host.getByLabel("Who’s coming?").fill(names.join("\n"));
    await host.getByLabel("We have a date").check();
    await host
      .getByLabel("Dinner starts · London time")
      .fill(day(8) + "T19:30");
    await host.getByLabel("Reply by · London time").fill(day(1) + "T18:00");
    await host
      .getByRole("button", { name: /Create & get the invite link/ })
      .click();
    await expect(host).toHaveURL(/\/d\/[\w-]+/);
    const path = new URL(host.url()).pathname;
    for (const [index, page] of pages.entries()) {
      if (index) await page.goto(path);
      await page
        .getByRole("button", { name: new RegExp(names[index] + ".*That’s me") })
        .click();
      await page
        .getByLabel("Your starting station or postcode")
        .fill(stations[index]);
      await page
        .getByLabel("Japanese", { exact: true })
        .selectOption(index % 2 ? "okay" : "prefer");
      await page
        .getByRole("button", { name: "Save my reply", exact: true })
        .click();
      if (index < 5)
        await expect(
          page.getByRole("heading", { name: "Your dinner details" }),
        ).toBeVisible();
    }
    await expect(
      pages[5].getByRole("heading", { name: "Where shall we meet?" }),
    ).toBeVisible({ timeout: 45000 });
    const area = await pages[5]
      .locator(".area-card legend")
      .first()
      .innerText();
    for (const page of [...pages.slice(1), host]) {
      await page.reload();
      await page
        .locator(".area-card")
        .filter({ has: page.locator("legend", { hasText: area }) })
        .getByLabel("My favourite")
        .check();
      await page
        .getByRole("button", { name: "Save my vote", exact: true })
        .click();
      if (page !== host)
        await expect(
          page.getByRole("button", { name: "Update my vote", exact: true }),
        ).toBeVisible();
    }
    await expect(
      host.getByRole("heading", { name: "Find your dinner spot" }),
    ).toBeVisible({ timeout: 45000 });
    await host.getByText("Have somewhere in mind? Enter a restaurant").click();
    await host
      .getByLabel("Restaurant name", { exact: true })
      .fill("Six Friends Example Kitchen");
    await host.getByLabel("Street address").fill("6 Example Street, London");
    await host.getByRole("button", { name: "Save this restaurant" }).click();
    await host
      .getByLabel("I checked the venue details and suitability.")
      .check();
    host.once("dialog", (dialog) => dialog.accept());
    await host.getByRole("button", { name: /Confirm dinner/ }).click();
    await expect(
      host.getByText("See you there", { exact: true }),
    ).toBeVisible();
    await expect(host.locator(".confirmation-facts")).toContainText(
      names.join(", "),
    );
    await host.screenshot({
      path: screenshotDir + "/agent-meet-confirmed-desktop.png",
      fullPage: true,
    });
    await pages[5].reload();
    await expect(
      pages[5].getByRole("heading", {
        name: "Six Friends Example Kitchen",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await pages[5].evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await pages[5].screenshot({
      path: screenshotDir + "/agent-meet-confirmed-mobile.png",
      fullPage: true,
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
