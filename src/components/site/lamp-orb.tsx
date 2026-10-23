import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * The orb: Lamp's logo and the light at the centre of the home page. A lamp on a stand gives light
 * to all in the house (Matthew 5:14-16). Drawn in SVG user units, so the blur scales with the size.
 * The outer glow breathes slowly (styles.css, .lamp-orb); reduced motion stills it.
 */
export function LampOrb({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("lamp-orb overflow-visible", className)}
      aria-hidden="true"
    >
      <defs>
        <filter id={`${id}-halo`} x="-1" y="-1" width="3" height="3">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id={`${id}-glow`} x="-1" y="-1" width="3" height="3">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id={`${id}-core`} x="-1" y="-1" width="3" height="3">
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>
      <circle className="o-halo" cx="32" cy="32" r="26" filter={`url(#${id}-halo)`} />
      <circle className="o-glow" cx="32" cy="32" r="21" filter={`url(#${id}-glow)`} />
      <circle className="o-body" cx="32" cy="32" r="15.5" />
      <circle className="o-core" cx="32" cy="32" r="10" filter={`url(#${id}-core)`} />
      <circle className="o-hl" cx="27.2" cy="27.2" r="4.2" />
    </svg>
  );
}
