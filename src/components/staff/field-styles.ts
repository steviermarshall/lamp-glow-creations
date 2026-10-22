/** Form pieces for the staff screens, matching the file view's inputs. */
export const input = "w-full rounded-full bg-white px-4 py-2 text-sm ring-1 ring-line";
export const textarea = "min-h-20 w-full rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-line";
export const chip =
  "inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold ring-1 ring-line transition hover:ring-ink/30 disabled:opacity-40";
export const chipDark =
  "inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40";

/** "a, b , c" -> ["a","b","c"] for text[] columns. */
export const listOf = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
