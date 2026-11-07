import { test, expect } from "@playwright/test";
import { newDinner } from "../src/lib/domain";
import postgres from "postgres";
import type { Dinner } from "../src/lib/model";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
async function insertDinner(dinner: Dinner) {
  await sql`INSERT INTO dinners (id, document, expires_at) VALUES (${dinner.id}, ${sql.json(dinner)}, ${dinner.expiresAt})`;
}
import { digest, token } from "../src/lib/security";

const future = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString();
const makeDinner = () =>
  newDinner(
    {
      title: "Synthetic V2 dinner",
      hostName: "Test organiser",
      names: ["Alex"],
      mode: "fixed",
      fixedStart: future(7),
      duration: 120,
      deadline: future(1),
      experience: "v2",
      identityMode: "account",
      inviteEmails: ["alex@example.invalid"],
    },
    digest(token()),
  );

test.afterAll(async () => {
  await sql.end();
});

test("account dinner public view asks for personal invitation without leaking contact details", async ({
  page,
}) => {
  const dinner = makeDinner();
  dinner.guests[0].invitationHash = digest(token());
  dinner.guests[0].accountId = "synthetic-private-account";
  await insertDinner(dinner);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/d/" + dinner.id);
  await expect(
    page.getByRole("heading", { name: "Sign in with your invited email" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who are you?" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: /That’s me/ })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Personal invitations" }),
  ).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("alex@example.invalid");
  await expect(page.locator("body")).not.toContainText(
    "synthetic-private-account",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("V2 recommendation explains evidence and keeps fallback honest", async ({
  page,
}) => {
  const dinner = makeDinner();
  dinner.stage = "choosing-restaurant";
  dinner.includedIds = [dinner.guests[0].id];
  dinner.guests[0].reply = {
    attending: true,
    availability: [],
    diets: [],
    otherDiet: "",
    cuisines: {},
    budgets: ["medium"],
  };
  dinner.restaurants = [
    {
      id: "test-venue",
      name: "Synthetic venue",
      address: "Test address",
      sourceUrl: "https://example.invalid/venue",
      mapUrl: "",
      cuisines: ["Italian"],
      price: "medium",
      dietaryEvidence: [],
      hours: "Preview hours",
      evidence: {
        source: "fixture",
        sourceUrl: "https://example.invalid/venue",
        checkedAt: new Date().toISOString(),
        priceBand: "medium",
        opening: {
          start: dinner.fixedStart!,
          end: new Date(
            Date.parse(dinner.fixedStart!) + dinner.duration * 60_000,
          ).toISOString(),
        },
        diets: [],
      },
    },
  ];
  await insertDinner(dinner);
  await page.goto("/d/" + dinner.id);
  await expect(
    page.getByText(
      /Synthetic example evidence supports the medium budget, opening throughout the selected dinner/,
    ),
  ).toBeVisible();
  await expect(page.getByText(/Synthetic preview evidence/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm dinner" }),
  ).toHaveCount(0);
  const fallback = makeDinner();
  fallback.stage = "choosing-restaurant";
  await insertDinner(fallback);
  await page.goto("/d/" + fallback.id);
  await expect(
    page.getByText(/not enough current evidence to recommend one venue/),
  ).toBeVisible();
  await expect(page.getByText(/no supported restaurant matches/)).toBeVisible();
});
