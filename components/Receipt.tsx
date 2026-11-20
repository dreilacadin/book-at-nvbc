import { formatPeso } from "@/lib/pricing";

/**
 * Prices laid out like a receipt: one line per item with the amounts lined up on the right, then the
 * total under a rule, all in one narrow column on the left so it's easy to add up.
 */
export default function Receipt({
  lines,
  total,
  totalLabel = "Total",
  className = "",
}: {
  lines: { label: string; amount: number }[];
  total: number;
  totalLabel?: string;
  className?: string;
}) {
  return (
    <dl className={`receipt ${className}`.trim()}>
      {lines.map((l, i) => (
        <div key={i}>
          <dt>{l.label}</dt>
          <dd>{formatPeso(l.amount)}</dd>
        </div>
      ))}
      <div className="receipt-total">
        <dt>{totalLabel}</dt>
        <dd>{formatPeso(total)}</dd>
      </div>
    </dl>
  );
}
