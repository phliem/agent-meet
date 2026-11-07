import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Agent Meet — dinner plans that meet in the middle",
    template: "%s · Agent Meet",
  },
  description:
    "Make dinner happen. Find a shared time, compare fair London meeting areas, and choose a restaurant with friends.",
  openGraph: {
    title: "Agent Meet",
    description: "A fair place. A shared plan. A dinner that actually happens.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
