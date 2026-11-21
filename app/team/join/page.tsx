import type { Metadata } from "next";
import TeamJoin from "./TeamJoin";

export const metadata: Metadata = { title: "Join the NVBC team", robots: { index: false, follow: false } };

/** Registration links for new staff, Scholars and Stringers: /team/join#<token>. */
export default function TeamJoinPage() {
  return <TeamJoin />;
}
