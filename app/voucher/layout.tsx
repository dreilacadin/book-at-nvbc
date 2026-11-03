import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Voucher — NVBC Courts",
  description: "Check an NVBC voucher: what it's worth, what's left, and book a court with it.",
};

export default function VoucherLayout({ children }: { children: React.ReactNode }) {
  return children;
}
