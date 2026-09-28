import type { Metadata } from "next";
import MembershipStatus from "./MembershipStatus";

// A private link: keep it out of search engines.
export const metadata: Metadata = { title: "My membership — NVBC", robots: { index: false, follow: false } };

export default async function MembershipStatusPage({ params }: { params: Promise<{ token: string }> }) {
  return <MembershipStatus token={(await params).token} />;
}
