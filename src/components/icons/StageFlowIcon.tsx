/**
 * StageFlowIcon — inline SVG matching the "pipeline stages" icon:
 * two rows of ●─▬ process-nodes connected by a zigzag flow arrow,
 * representing sequential manufacturing stages.
 */
export default function StageFlowIcon({
  size = 18,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* ── Top row: ●─▬ ── */}
      {/* circle node */}
      <circle cx="3.2" cy="5.5" r="2.4" />
      {/* connector stem */}
      <rect x="5.4" y="4.8" width="1.4" height="1.4" rx="0.2" />
      {/* pill / stage block */}
      <rect x="6.6" y="3.8" width="7.8" height="3.4" rx="1.7" />

      {/* ── Return arrow: right-end of top row → curves down → left ── */}
      {/* vertical drop on the right */}
      <rect x="13.6" y="7.2" width="1.4" height="3.0" rx="0.7" />
      {/* horizontal leg going left */}
      <rect x="4.0"  y="9.8" width="11.0" height="1.4" rx="0.7" />
      {/* arrowhead pointing left */}
      <path d="M4.8 9.0 L2.2 10.5 L4.8 12.0 Z" />

      {/* ── Bottom row: ●─▬ (offset right) ── */}
      {/* circle node */}
      <circle cx="8.0" cy="14.5" r="2.4" />
      {/* connector stem */}
      <rect x="10.2" y="13.8" width="1.4" height="1.4" rx="0.2" />
      {/* pill / stage block */}
      <rect x="11.4" y="12.8" width="7.2" height="3.4" rx="1.7" />

      {/* ── Feed arrow into bottom row (pointing right, left of circle) ── */}
      <rect x="3.5" y="13.8" width="3.2" height="1.4" rx="0.7" />
      <path d="M6.2 13.0 L8.8 14.5 L6.2 16.0 Z" />
    </svg>
  );
}
