import type { Metadata } from "next";
import ScholarForm from "./ScholarForm";

export const metadata: Metadata = {
  title: "Become an NVBC Scholar — Tryouts",
  description: "Apply to be an NVBC Scholar. We're looking for 2 badminton and 2 pickleball student-athletes in Nueva Vizcaya.",
};

export default function ScholarsPage() {
  return <ScholarForm />;
}
