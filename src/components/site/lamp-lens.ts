import { useEffect } from "react";

/**
 * Liquid-glass refraction for .ll-glass panels on Lamplight pages (after React Bits' GlassSurface).
 * Each panel gets its own SVG filter: a displacement map sized to the panel (red gradient across,
 * blue gradient down, a blurred neutral centre so only the edges bend), three displacement passes
 * with slightly different scales for R, G and B, screened back together and softened. Chromium only;
 * Safari and Firefox keep the plain CSS blur from styles.css. Also keeps each panel's rim light
 * (--tilt) and hover highlight (--mx/--my) pointed at the pointer, and sets --px/--py on <html> for
 * the floating proof cards.
 */

const P = { borderWidth: 0.07, brightness: 50, opacity: 0.93, blur: 11, displace: 1.5, scale: -30 };
const CHANNELS: [string, string, number][] = [
  ["red", "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0", 0],
  ["green", "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0", 4],
  ["blue", "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0", 8],
];
const NS = "http://www.w3.org/2000/svg";
const SEL = ".ll-glass";

function supportsSvgBackdrop() {
  const ua = navigator.userAgent;
  if ((/Safari/.test(ua) && !/Chrome/.test(ua)) || /Firefox/.test(ua)) return false;
  const d = document.createElement("div");
  d.style.backdropFilter = "url(#x)";
  return d.style.backdropFilter !== "";
}

function displacementMap(w: number, h: number, r: number) {
  const edge = Math.min(w, h) * (P.borderWidth * 0.5);
  const svg =
    `<svg viewBox="0 0 ${w} ${h}" xmlns="${NS}"><defs>` +
    `<linearGradient id="rg" x1="100%" y1="0%" x2="0%" y2="0%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="red"/></linearGradient>` +
    `<linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="blue"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="black"/>` +
    `<rect width="${w}" height="${h}" rx="${r}" fill="url(#rg)"/>` +
    `<rect width="${w}" height="${h}" rx="${r}" fill="url(#bg)" style="mix-blend-mode:difference"/>` +
    `<rect x="${edge}" y="${edge}" width="${w - edge * 2}" height="${h - edge * 2}" rx="${r}" fill="hsl(0 0% ${P.brightness}% / ${P.opacity})" style="filter:blur(${P.blur}px)"/></svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

function makeFilter(id: string) {
  const f = document.createElementNS(NS, "filter");
  f.setAttribute("id", id);
  f.setAttribute("color-interpolation-filters", "sRGB");
  const box: [string, string][] = [
    ["x", "0%"],
    ["y", "0%"],
    ["width", "100%"],
    ["height", "100%"],
  ];
  for (const [k, v] of box) f.setAttribute(k, v);
  const img = document.createElementNS(NS, "feImage");
  const imgAttrs: [string, string][] = [
    ["x", "0"],
    ["y", "0"],
    ["width", "100%"],
    ["height", "100%"],
    ["preserveAspectRatio", "none"],
    ["result", "map"],
  ];
  for (const [k, v] of imgAttrs) img.setAttribute(k, v);
  f.appendChild(img);
  for (const [name, matrix, offset] of CHANNELS) {
    const d = document.createElementNS(NS, "feDisplacementMap");
    d.setAttribute("in", "SourceGraphic");
    d.setAttribute("in2", "map");
    d.setAttribute("scale", String(P.scale + offset));
    d.setAttribute("xChannelSelector", "R");
    d.setAttribute("yChannelSelector", "G");
    d.setAttribute("result", `d_${name}`);
    f.appendChild(d);
    const m = document.createElementNS(NS, "feColorMatrix");
    m.setAttribute("in", `d_${name}`);
    m.setAttribute("type", "matrix");
    m.setAttribute("values", matrix);
    m.setAttribute("result", name);
    f.appendChild(m);
  }
  const b1 = document.createElementNS(NS, "feBlend");
  b1.setAttribute("in", "red");
  b1.setAttribute("in2", "green");
  b1.setAttribute("mode", "screen");
  b1.setAttribute("result", "rg");
  f.appendChild(b1);
  const b2 = document.createElementNS(NS, "feBlend");
  b2.setAttribute("in", "rg");
  b2.setAttribute("in2", "blue");
  b2.setAttribute("mode", "screen");
  b2.setAttribute("result", "out");
  f.appendChild(b2);
  const g = document.createElementNS(NS, "feGaussianBlur");
  g.setAttribute("in", "out");
  g.setAttribute("stdDeviation", String(P.displace));
  f.appendChild(g);
  return { f, img };
}

export function useLamplightGlass(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // pointer: parallax for proof cards, rim tilt and highlight for each visible panel
    const ptr = { x: -1, y: -1 };
    let pending = false;
    const tick = () => {
      pending = false;
      if (!reduce) {
        root.style.setProperty("--px", ((ptr.x / window.innerWidth - 0.5) * 2).toFixed(3));
        root.style.setProperty("--py", ((ptr.y / window.innerHeight - 0.5) * 2).toFixed(3));
      }
      document.querySelectorAll<HTMLElement>(SEL).forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom < -100 || r.top > window.innerHeight + 100) return;
        const dx = ptr.x - (r.left + r.width / 2);
        const dy = ptr.y - (r.top + r.height / 2);
        el.style.setProperty(
          "--tilt",
          `${((Math.atan2(dy, dx) * 180) / Math.PI + 45).toFixed(1)}deg`,
        );
        el.style.setProperty("--mx", `${(ptr.x - r.left).toFixed(0)}px`);
        el.style.setProperty("--my", `${(ptr.y - r.top).toFixed(0)}px`);
      });
    };
    const onMove = (e: PointerEvent) => {
      ptr.x = e.clientX;
      ptr.y = e.clientY;
      if (!pending) {
        pending = true;
        requestAnimationFrame(tick);
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    // refraction
    let svg: SVGSVGElement | null = null;
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;
    const items = new Map<
      HTMLElement,
      { img: SVGFEImageElement; w: number; h: number; id: string }
    >();
    let n = 0;
    const update = (el: HTMLElement) => {
      const it = items.get(el);
      if (!it) return;
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      if (!w || !h) return;
      if (w !== it.w || h !== it.h) {
        it.w = w;
        it.h = h;
        const br = parseFloat(getComputedStyle(el).borderRadius) || 16;
        it.img.setAttribute("href", displacementMap(w, h, Math.min(br, w / 2, h / 2)));
      }
      const v = `url(#${it.id}) saturate(1.6) blur(var(--glass-blur))`;
      el.style.setProperty("backdrop-filter", v, "important");
      el.style.setProperty("-webkit-backdrop-filter", v, "important");
    };
    const attach = (el: HTMLElement) => {
      if (items.has(el) || !svg || !ro) return;
      const id = `ll-lens-${++n}`;
      const { f, img } = makeFilter(id);
      svg.appendChild(f);
      items.set(el, { img: img as SVGFEImageElement, w: 0, h: 0, id });
      update(el);
      ro.observe(el);
    };
    if (supportsSvgBackdrop()) {
      svg = document.createElementNS(NS, "svg");
      svg.setAttribute("aria-hidden", "true");
      svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
      document.body.appendChild(svg);
      ro = new ResizeObserver((es) => es.forEach((e) => update(e.target as HTMLElement)));
      const scan = () => document.querySelectorAll<HTMLElement>(SEL).forEach(attach);
      scan();
      mo = new MutationObserver(scan);
      mo.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      window.removeEventListener("pointermove", onMove);
      root.style.removeProperty("--px");
      root.style.removeProperty("--py");
      mo?.disconnect();
      ro?.disconnect();
      items.forEach((_, el) => {
        el.style.removeProperty("backdrop-filter");
        el.style.removeProperty("-webkit-backdrop-filter");
      });
      svg?.remove();
    };
  }, [enabled]);
}
