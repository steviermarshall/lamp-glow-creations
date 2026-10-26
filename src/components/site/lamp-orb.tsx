import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * The orb: Lamp's logo and the light at the centre of the home page. A lamp on a stand gives light
 * to all in the house (Matthew 5:14-16).
 *
 * Drawn as a lit glass sphere rather than flat discs: a soft bloom, a glow hugging the edge, an
 * emissive body that falls off from a hot core, a slow drifting light texture inside, a fresnel rim,
 * a soft specular highlight with a glint, and a bounce reflection low on the right. "mark" is the
 * cut for the 20-24px logo tile: same sphere, fewer layers, so it stays crisp. Motion lives in
 * styles.css (.lamp-orb); reduced motion stills it.
 */
export function LampOrb({
  className,
  variant = "full",
}: {
  className?: string;
  variant?: "full" | "mark";
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ref = (name: string) => `url(#${id}-${name})`;
  const full = variant === "full";

  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("lamp-orb overflow-visible", className)}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`${id}-bloom`}>
          <stop offset="0" stopColor="#6fc287" stopOpacity="0.62" />
          <stop offset="0.42" stopColor="#4a985e" stopOpacity="0.22" />
          <stop offset="0.7" stopColor="#3f8a55" stopOpacity="0.07" />
          <stop offset="1" stopColor="#3f8a55" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-hug`}>
          <stop offset="0.72" stopColor="#6fc287" stopOpacity="0" />
          <stop offset="0.77" stopColor="#6fc287" stopOpacity="0.42" />
          <stop offset="0.92" stopColor="#4a985e" stopOpacity="0.08" />
          <stop offset="1" stopColor="#4a985e" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-body`} cx="0.48" cy="0.46" r="0.58">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.12" stopColor="#e4fbe9" />
          <stop offset="0.34" stopColor="#86d89b" />
          <stop offset="0.6" stopColor="#3fa560" />
          <stop offset="0.84" stopColor="#1f6a3d" />
          <stop offset="1" stopColor="#164a2e" />
        </radialGradient>
        <linearGradient id={`${id}-shade`} x1="0.2" y1="0.1" x2="0.85" y2="1">
          <stop offset="0.45" stopColor="#03130b" stopOpacity="0" />
          <stop offset="1" stopColor="#03130b" stopOpacity="0.55" />
        </linearGradient>
        <radialGradient id={`${id}-sheen`} cx="0.3" cy="0.78" r="0.45">
          <stop offset="0" stopColor="#4fd1b4" stopOpacity="0.32" />
          <stop offset="1" stopColor="#4fd1b4" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-rim`}>
          <stop offset="0.8" stopColor="#dcffe5" stopOpacity="0" />
          <stop offset="0.94" stopColor="#c8f1d3" stopOpacity="0.2" />
          <stop offset="1" stopColor="#e9fff0" stopOpacity="0.42" />
        </radialGradient>
        <radialGradient id={`${id}-core`}>
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="0.35" stopColor="#f0fff4" stopOpacity="0.55" />
          <stop offset="1" stopColor="#d8f7e0" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-spec`}>
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.92" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-window`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.1" />
        </linearGradient>
        <filter id={`${id}-soft`} x="-0.5" y="-0.5" width="2" height="2">
          <feGaussianBlur stdDeviation="0.35" />
        </filter>
        <linearGradient id={`${id}-bounce`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c8f1d3" stopOpacity="0" />
          <stop offset="0.5" stopColor="#c8f1d3" stopOpacity="0.7" />
          <stop offset="1" stopColor="#c8f1d3" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-ball`}>
          <circle cx="32" cy="32" r="15.5" />
        </clipPath>
        {full && (
          <filter id={`${id}-plasma`} x="0" y="0" width="1" height="1">
            <feTurbulence type="fractalNoise" baseFrequency="0.16" numOctaves="3" seed="7" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0.62  0 0 0 0 1  0 0 0 0 0.72  1.7 0 0 0 -0.72"
            />
          </filter>
        )}
      </defs>

      {/* light thrown around it */}
      <circle className="o-bloom" cx="32" cy="32" r="31" fill={ref("bloom")} />
      <circle cx="32" cy="32" r="21" fill={ref("hug")} />

      {/* the sphere */}
      <circle cx="32" cy="32" r="15.5" fill={ref("body")} />
      {full && (
        <g clipPath={ref("ball")}>
          <g className="o-plasma">
            <rect x="8" y="8" width="48" height="48" filter={ref("plasma")} opacity="0.2" />
          </g>
        </g>
      )}
      <circle cx="32" cy="32" r="15.5" fill={ref("shade")} />
      <circle cx="32" cy="32" r="15.5" fill={ref("sheen")} />
      <circle className="o-core" cx="31" cy="30.5" r={full ? 7.6 : 6.2} fill={ref("core")} />
      <circle cx="32" cy="32" r="15.5" fill={ref("rim")} />

      {/* glass: highlight, glint, bounce */}
      <ellipse
        cx="26.4"
        cy="24.6"
        rx={full ? 4.6 : 5}
        ry={full ? 2.7 : 3.1}
        transform="rotate(-32 26.4 24.6)"
        fill={ref("spec")}
      />
      {full && (
        <path
          d="M19.50 27.45A13.3 13.3 0 0 1 36.98 19.67"
          fill="none"
          stroke={ref("window")}
          strokeWidth="1.5"
          strokeLinecap="round"
          filter={ref("soft")}
        />
      )}
      {full && (
        <circle cx="24.6" cy="23.6" r="0.6" fill="#ffffff" opacity="0.9" filter={ref("soft")} />
      )}
      {full && (
        <path
          d="M44.14 37.66A13.4 13.4 0 0 1 33.17 45.35"
          fill="none"
          stroke={ref("bounce")}
          strokeWidth="0.9"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
