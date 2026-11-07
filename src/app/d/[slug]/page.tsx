import type { Metadata } from "next";
import { loadDinner } from "@/lib/actions";
import { DinnerExperience } from "@/components/dinner";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata: Metadata = {
  title: "Your dinner",
  robots: { index: false, follow: false },
  openGraph: {
    title: "An Agent Meet dinner",
    description: "Open your dinner link to see the plan.",
  },
};

export default async function DinnerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const dinner = await loadDinner(slug);
  if (!dinner)
    return (
      <main className="wrap narrow empty-page">
        <Link href="/" className="brand">
          Agent Meet
        </Link>
        <h1>This dinner link has expired or is unavailable.</h1>
        <p>Check the link with your organiser.</p>
        <Link href="/" className="button">
          Back to Agent Meet
        </Link>
      </main>
    );
  return <DinnerExperience dinner={dinner} />;
}
