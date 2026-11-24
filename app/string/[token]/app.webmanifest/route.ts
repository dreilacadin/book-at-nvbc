// The racket page's own web app manifest: "Add to Home Screen" on /string/<token> opens that page
// (the site's manifest starts at the booking page). Each check-in is its own Home Screen app, so
// a customer can keep more than one. No database read: the page itself checks the token.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return new Response("Not found", { status: 404 });
  const page = `/string/${token}`;
  return Response.json(
    {
      id: page,
      name: "My racket · NVBC",
      short_name: "My racket",
      description: "Your racket stringing at NV Badminton Center: where it is and when it's ready.",
      start_url: page,
      scope: "/",
      display: "standalone",
      background_color: "#000023",
      theme_color: "#1e274b",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=86400", "X-Robots-Tag": "noindex" } }
  );
}
