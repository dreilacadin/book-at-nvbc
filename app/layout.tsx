import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "NVBC Courts — Court Reservation System",
  description:
    "Check court availability and reserve a badminton or pickleball court at NV Badminton Center. No account needed.",
  // Added to an iPhone's Home Screen, the site opens like an app (needed for staff push notifications on iOS).
  appleWebApp: { capable: true, title: "NVBC", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d4f30",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="container">
            <Link href="/" className="logo">
              <span className="logo-ball" aria-hidden="true" />
              <span>
                NVBC Courts
                <small>Badminton &amp; pickleball court reservations</small>
              </span>
            </Link>
            <nav className="nav">
              <Link href="/">Book a court</Link>
              <Link href="/my-booking">My booking</Link>
              <Link href="/membership">Membership</Link>
              <Link href="/changelog">Changelog</Link>
            </nav>
          </div>
        </header>
        <main>
          <div className="container">{children}</div>
        </main>
        <footer className="site-footer">
          <div className="container">
            <span>© NV Badminton Center</span>
            <Link href="/admin">Staff login</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
