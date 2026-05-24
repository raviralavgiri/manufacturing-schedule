/**
 * BioreactorIcon — inline SVG of a stirred-tank bioreactor / fermenter vessel.
 * Matches the custom equipment icon used in the app's "Equipment" tab.
 *
 * Visual anatomy (top → bottom):
 *   inlet nozzle ──► top flange ──► cylindrical body with dished bottom
 *   agitator shaft running axially with two Rushton-style impeller sets
 *   left / right side nozzles (sparger / harvest ports)
 */
export default function BioreactorIcon({
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
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* ── Vessel body (cylinder with dished/rounded bottom) ── */}
      <path
        d="M4.5 3h9v8.5a4.5 4.5 0 0 1-9 0V3Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />

      {/* ── Top flange ── */}
      <line
        x1="3.5" y1="3" x2="14.5" y2="3"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
      />

      {/* ── Top inlet nozzle ── */}
      <line
        x1="9" y1="0.8" x2="9" y2="3"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
      />

      {/* ── Agitator shaft (axial) ── */}
      <line
        x1="9" y1="3" x2="9" y2="13"
        stroke="currentColor" strokeWidth="0.9" strokeLinecap="round"
        strokeDasharray="0"
      />

      {/* ── Upper Rushton impeller ── */}
      <line
        x1="6.3" y1="6.8" x2="11.7" y2="6.8"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
      />
      {/* impeller disc (small tick marks suggesting blades) */}
      <line x1="7.2" y1="5.9" x2="7.2" y2="7.7"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
      <line x1="10.8" y1="5.9" x2="10.8" y2="7.7"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>

      {/* ── Lower Rushton impeller ── */}
      <line
        x1="6.3" y1="10.2" x2="11.7" y2="10.2"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
      />
      <line x1="7.2" y1="9.3" x2="7.2" y2="11.1"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
      <line x1="10.8" y1="9.3" x2="10.8" y2="11.1"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>

      {/* ── Left side nozzle (sparger) ── */}
      <line
        x1="2.5" y1="5.5" x2="4.5" y2="5.5"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"
      />

      {/* ── Right side nozzle (harvest) ── */}
      <line
        x1="13.5" y1="5.5" x2="15.5" y2="5.5"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"
      />
    </svg>
  );
}
