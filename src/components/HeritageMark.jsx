import { Link } from 'react-router-dom';

// Heritage Ink monogram — a film frame wrapped in a hand-drawn ink stroke.
export default function HeritageMark({ size = 34, withWordmark = true }) {
  return (
    <Link to="/" className="flex items-center gap-3 group select-none">
      <span className="relative inline-flex" style={{ width: size, height: size }}>
        <svg viewBox="0 0 48 48" width={size} height={size} fill="none" aria-hidden>
          <path
            d="M6 14 L6 34 L42 34 L42 14 Z"
            stroke="hsl(43 89% 38%)"
            strokeWidth="1.6"
            fill="hsl(43 89% 38% / 0.08)"
          />
          <path d="M14 22 C20 16 28 16 34 22" stroke="hsl(43 89% 38%)" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="17" cy="26" r="1.6" fill="hsl(34 61% 94%)" />
          <circle cx="31" cy="26" r="1.6" fill="hsl(34 61% 94%)" />
          <path d="M3 11 L9 11 M39 11 L45 11" stroke="hsl(43 89% 38% / 0.8)" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M3 37 L9 37 M39 37 L45 37" stroke="hsl(43 89% 38% / 0.8)" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </span>
      {withWordmark && (
        <span className="font-display text-xl tracking-[0.18em] text-foreground leading-none">
          CINE<span className="text-primary">FLUENCY</span>
        </span>
      )}
    </Link>
  );
}