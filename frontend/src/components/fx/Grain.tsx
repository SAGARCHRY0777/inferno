/**
 * A subtle film-grain overlay for tactile depth (very common on award-winning
 * sites). Pure CSS via an inline SVG turbulence; fixed, non-interactive, low
 * opacity so it never competes with content.
 */
const NOISE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>
      <filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter>
      <rect width='100%' height='100%' filter='url(#n)' opacity='0.5'/>
    </svg>`,
  );

export function Grain() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60] opacity-[0.035] mix-blend-overlay"
      style={{ backgroundImage: `url("${NOISE}")`, backgroundSize: "160px 160px" }}
    />
  );
}
