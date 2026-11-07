import type { Metadata } from "next";
import { PilotInvite } from "@/components/forms";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Your organiser invitation",
  robots: { index: false, follow: false },
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="wrap narrow empty-page">
      <Link href="/" className="brand">
        Agent Meet
      </Link>
      <span className="eyebrow">A seat at the table</span>
      <h1>You’re invited to host.</h1>
      <p>
        Activate your organiser invitation in the browser you’ll use to create
        dinners.
      </p>
      <PilotInvite token={token} />
    </main>
  );
}
