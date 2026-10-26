import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { Eraser } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Draw-your-signature box: a sheet of paper with a signing line, mouse, pen or finger. The
 * drawing is kept at the canvas's real pixel size (devicePixelRatio aware), and every point is
 * mapped from where the pointer actually is on screen, so ink lands under the finger on a phone
 * too. onChange gets a PNG data URL (dark ink, transparent ground, cropped to the ink with a
 * margin) or null once cleared.
 */

const INK = "#14231b";
const EXPORT_MAX_W = 640;
/** Less ink than this (CSS px of line) is a tap or a dot, not a signature. */
const MIN_INK = 60;

export function SignaturePad({
  onChange,
  label,
  className,
}: {
  onChange: (png: string | null) => void;
  label: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number; t: number } | null>(null);
  const strokes = useRef(0);
  const ink = useRef(0);
  const [empty, setEmpty] = useState(true);
  // the latest callback, so a parent passing a new function each render doesn't re-fit the canvas
  const changed = useRef(onChange);
  useLayoutEffect(() => {
    changed.current = onChange;
  });

  // Size the bitmap to the box's CSS size times the device ratio; redraw nothing (a resize clears).
  const fit = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    if (c.width === w && c.height === h) return;
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = INK;
      ctx.fillStyle = INK;
    }
    if (strokes.current) {
      strokes.current = 0;
      ink.current = 0;
      setEmpty(true);
      changed.current(null);
    }
  }, []);

  useEffect(() => {
    fit();
    const ro = new ResizeObserver(() => fit());
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [fit]);

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp };
  };

  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = point(e);
    last.current = p;
    const ctx = e.currentTarget.getContext("2d");
    if (ctx) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    e.preventDefault();
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    // coalesced events give a smooth line on fast strokes
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    const r = e.currentTarget.getBoundingClientRect();
    for (const ev of events) {
      const p = { x: ev.clientX - r.left, y: ev.clientY - r.top, t: ev.timeStamp };
      const prev = last.current!;
      const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
      ink.current += dist;
      const speed = dist / Math.max(1, p.t - prev.t);
      // a pen-like line: thinner when fast, fuller when slow
      ctx.lineWidth = Math.max(1.4, Math.min(3.2, 3.4 - speed * 1.1));
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      const mx = (prev.x + p.x) / 2;
      const my = (prev.y + p.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last.current = p;
    }
  };

  const up = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    strokes.current += 1;
    setEmpty(false);
    changed.current(ink.current >= MIN_INK ? exportInk(e.currentTarget) : null);
  };

  const clear = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.restore();
    strokes.current = 0;
    ink.current = 0;
    setEmpty(true);
    changed.current(null);
  };

  return (
    <div className={cn("select-none", className)}>
      <div className="relative overflow-hidden rounded-2xl bg-[#fbfaf5] shadow-[inset_0_1px_3px_rgb(0_0_0/0.18)] ring-1 ring-black/10">
        <canvas
          ref={canvasRef}
          aria-label={label}
          role="img"
          className="block h-44 w-full cursor-crosshair touch-none sm:h-48"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={(e) => drawing.current && up(e)}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-6 bottom-11 flex items-end gap-2 border-b border-[#14231b]/25 pb-1"
        >
          <span className="font-display text-xl leading-none text-[#14231b]/35">×</span>
        </div>
        {empty && (
          <p
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-[#14231b]/40"
          >
            Sign here with your finger or mouse
          </p>
        )}
        <button
          type="button"
          onClick={clear}
          disabled={empty}
          className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-[#14231b] ring-1 ring-black/10 transition hover:bg-white disabled:opacity-0"
        >
          <Eraser className="size-3.5" /> Clear
        </button>
      </div>
    </div>
  );
}

/** The ink only: crop to what was drawn plus a margin, scale down, PNG. Null when blank. */
function exportInk(c: HTMLCanvasElement): string | null {
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const { width: w, height: h } = c;
  const data = ctx.getImageData(0, 0, w, h).data;
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (data[(y * w + x) * 4 + 3]! > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = Math.round(Math.min(w, h) * 0.06);
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const scale = Math.min(1, EXPORT_MAX_W / cw);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(cw * scale));
  out.height = Math.max(1, Math.round(ch * scale));
  const octx = out.getContext("2d");
  if (!octx) return null;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(c, x0, y0, cw, ch, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}
