import type { Metadata } from "next";
import StringingStatus from "./StringingStatus";

// A private link: keep it out of search engines.
export const metadata: Metadata = { title: "My racket stringing — NVBC", robots: { index: false, follow: false } };

export default async function StringingStatusPage({ params }: { params: Promise<{ token: string }> }) {
  return <StringingStatus token={(await params).token} />;
}
