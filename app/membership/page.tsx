import type { Metadata } from "next";
import MembershipForm from "./MembershipForm";

export const metadata: Metadata = {
  title: "Membership — NVBC",
  description: "Become an NV Badminton Center member: apply online, pay the yearly fee, and get your member QR code.",
};

export default function MembershipPage() {
  return <MembershipForm />;
}
