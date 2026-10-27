import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { Eraser, Type } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Draw-your-signature box: a sheet of paper with a signing line, mouse, pen or finger. The
 * drawing is kept at the canvas's real pixel size (devicePixelRatio aware), and every point is
 * mapped from where the pointer actually is on screen, so ink lands under the finger on a phone
 * too. One pointer at a time (a palm or second finger is ignored), a first stroke that only goes
 * up or down is a scroll attempt and is wiped, and anyone who can't draw (keyboard, screen
 * reader) can sign with their typed name instead. onChange gets a PNG data URL (dark ink,
 * transparent ground, cropped to the ink with a margin) or null when there's no usable signature.
 */

const INK = "#14231b";
const EXPORT_MAX_W = 640;
/** Less ink than this (CSS px of line) is a tap or a dot, not a signature. */
const MIN_INK = 60;
/** A signature is wider than this (CSS px); a narrower first stroke was a scroll swipe. */
const MIN_WIDTH = 40;
const SCRIPT_FONT =
  '"Snell Roundhand", "Segoe Script", "Brush Script MT", "Apple Chancery", cursive';

export function SignaturePad({
  onChange,
  label,
  typed = "",
  className,
}: {
  onChange: (png: string | null) => void;
  label: string;
  /** The typed full name, for "Sign with my typed name". */
  typed?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const active = useRef<number | null>(null);
  const last = useRef<{ x: number; y: number; t: number } | null>(null);
  const stroke = useRef({ minX: 0, maxX: 0 });
  const bounds = useRef({ minX: Infinity, maxX: -Infinity });
  const strokes = useRef(0);
  const ink = useRef(0);
  const [empty, setEmpty] = useState(true);
  const [fromTyped, setFromTyped] = useState(false);
  // the latest callback, so a parent passing a new function each render doesn't re-fit the canvas
  const changed = useRef(onChange);
  useLayoutEffect(() => {
    changed.current = onChange;
  });

  const wipe = useCallback(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.restore();
    }
    strokes.current = 0;
    ink.current = 0;
    bounds.current = { minX: Infinity, maxX: -Infinity };
    setEmpty(true);
    setFromTyped(false);
    changed.current(null);
  }, []);

  const report = useCallback(
    () =>
      changed.current(
        ink.current >= MIN_INK && bounds.current.maxX - bounds.current.minX >= MIN_WIDTH
          ? exportInk(canvasRef.current!)
          : null,
      ),
    [],
  );

  // Size the bitmap to the box's CSS size times the device ratio. When the box changes size
  // with a signature on it (a scrollbar appearing, a phone rotating), the drawing is scaled into
  // the new size rather than lost.
  const fit = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    if (c.width === w && c.height === h) return;
    let kept: HTMLCanvasElement | null = null;
    if (strokes.current && c.width && c.height) {
      kept = document.createElement("canvas");
      kept.width = c.width;
      kept.height = c.height;
      kept.getContext("2d")?.drawImage(c, 0, 0);
    }
    const scaleX = c.width ? w / c.width : 1;
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    if (kept) ctx.drawImage(kept, 0, 0, kept.width, kept.height, 0, 0, w, h);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    if (kept) {
      bounds.current = {
        minX: bounds.current.minX * scaleX,
        maxX: bounds.current.maxX * scaleX,
      };
      report();
    }
  }, [report]);

  useEffect(() => {
    fit();
    const ro = new ResizeObserver(() => fit());
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [fit]);

  // a freshly mounted pad is blank, so whatever the parent held from an earlier pad is stale
  useEffect(() => {
    changed.current(null);
  }, []);

  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (active.current !== null) return;
    e.preventDefault();
    if (fromTyped) wipe();
    active.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp };
    last.current = p;
    stroke.current = { minX: p.x, maxX: p.x };
    const ctx = e.currentTarget.getContext("2d");
    if (ctx) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== active.current || !last.current) return;
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
      stroke.current.minX = Math.min(stroke.current.minX, p.x);
      stroke.current.maxX = Math.max(stroke.current.maxX, p.x);
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
    if (e.pointerId !== active.current) return;
    active.current = null;
    last.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    // a first stroke that only went up or down was someone trying to scroll the page
    if (strokes.current === 0 && stroke.current.maxX - stroke.current.minX < 24) {
      wipe();
      return;
    }
    strokes.current += 1;
    bounds.current.minX = Math.min(bounds.current.minX, stroke.current.minX);
    bounds.current.maxX = Math.max(bounds.current.maxX, stroke.current.maxX);
    setEmpty(false);
    report();
  };

  /** Write the typed name on the line in a script hand: a signature without drawing. */
  const signTyped = useCallback(
    (name: string) => {
      const c = canvasRef.current;
      const ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      const r = c.getBoundingClientRect();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.restore();
      let size = 44;
      ctx.font = `italic ${size}px ${SCRIPT_FONT}`;
      const room = r.width - 72;
      const w = ctx.measureText(name).width;
      if (w > room) size = Math.max(18, Math.floor((size * room) / w));
      ctx.font = `italic ${size}px ${SCRIPT_FONT}`;
      ctx.fillStyle = INK;
      ctx.textBaseline = "alphabetic";
      // starts after the "×" on the signing line
      ctx.fillText(name, 48, r.height - 52);
      strokes.current = 1;
      ink.current = MIN_INK;
      bounds.current = { minX: 48, maxX: 48 + Math.min(room, ctx.measureText(name).width) };
      setEmpty(false);
      setFromTyped(true);
      report();
    },
    [report],
  );

  // a typed signature follows the typed name; once the name is too short it goes away
  useEffect(() => {
    if (!fromTyped) return;
    if (typed.trim().length >= 3) signTyped(typed.trim());
    else wipe();
  }, [typed, fromTyped, signTyped, wipe]);

  return (
    <div className={cn("select-none", className)}>
      <div className="relative overflow-hidden rounded-2xl bg-[#fbfaf5] shadow-[inset_0_1px_3px_rgb(0_0_0/0.18)] ring-1 ring-black/10">
        <canvas
          ref={canvasRef}
          aria-label={`${label}: ${empty ? "empty. Draw here, or sign with your typed name below" : "signed"}`}
          role="img"
          className="block h-44 w-full cursor-crosshair touch-none sm:h-48"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
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
            className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-4 text-center text-sm text-[#14231b]/40"
          >
            Sign here with your finger or mouse
          </p>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => signTyped(typed.trim())}
          disabled={typed.trim().length < 3}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-smoke ring-1 ring-line transition hover:text-ink disabled:opacity-40"
        >
          <Type className="size-3.5" /> Sign with my typed name instead
        </button>
        {!empty && (
          <button
            type="button"
            onClick={wipe}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-smoke ring-1 ring-line transition hover:text-ink"
          >
            <Eraser className="size-3.5" /> Clear
          </button>
        )}
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
