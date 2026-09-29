/**
 * What membership covers right now. Update this when pickleball membership launches.
 */
export default function MembershipScope() {
  return (
    <div className="membership-scope" role="note">
      <span className="membership-scope-icon" aria-hidden="true">
        🏸
      </span>
      <div>
        <strong>Membership is currently for badminton.</strong> Member rates
        apply to badminton court bookings and queueing fees.
        <div className="membership-scope-soon">
          <span aria-hidden="true">🏓</span> Pickleball membership and perks are
          coming soon — stay tuned!
        </div>
      </div>
    </div>
  );
}
