/**
 * Full-screen loading overlay with a spinner. It fades in after `delay` ms (done in CSS, so it
 * also works in the server-rendered page before scripts load), so quick loads don't flash.
 */
export default function FullScreenLoader({ label = "Loading…", delay = 200 }: { label?: string; delay?: number }) {
  return (
    <div className="fs-loader" role="status" aria-live="polite" style={{ animationDelay: `${delay}ms` }}>
      <div className="fs-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
