import type { Metadata } from "next";
import ConsentForm from "./ConsentForm";

// A private link: keep it out of search engines.
export const metadata: Metadata = { title: "Parent or Guardian Consent — NVBC Scholars", robots: { index: false, follow: false } };

export default async function ConsentPage({ params }: { params: Promise<{ token: string }> }) {
  return <ConsentForm token={(await params).token} />;
}
