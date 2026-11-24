import type { Metadata } from "next";
import StringingStatus from "./StringingStatus";

// A private link: keep it out of search engines. Its own manifest, so "Add to Home Screen" opens
// this page rather than the booking page.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return {
    title: "My racket stringing — NVBC",
    robots: { index: false, follow: false },
    manifest: `/string/${encodeURIComponent(token)}/app.webmanifest`,
    appleWebApp: { capable: true, title: "My racket", statusBarStyle: "black-translucent" },
  };
}

export default async function StringingStatusPage({ params }: { params: Promise<{ token: string }> }) {
  return <StringingStatus token={(await params).token} />;
}
