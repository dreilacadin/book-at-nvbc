import type { Metadata } from "next";
import StringCheckIn from "./StringCheckIn";

export const metadata: Metadata = {
  title: "Racket stringing — NVBC",
  description: "Check in your badminton racket for stringing at NV Badminton Center: choose the string, tension and pickup date.",
};

export default function StringPage() {
  return <StringCheckIn />;
}
