// Plain values the application form components share. Kept out of the component files so fast
// refresh keeps working (a component file should export components only).

export const YES_NO = [
  { id: "yes" as const, label: "Yes" },
  { id: "no" as const, label: "No" },
];

/** What the signing step collects: agreement, typed names and drawn signatures. */
export type Signing = {
  agree: boolean;
  typed: string;
  image: string | null;
  second: boolean;
  typed2: string;
  image2: string | null;
};

export const emptySigning = (): Signing => ({
  agree: false,
  typed: "",
  image: null,
  second: false,
  typed2: "",
  image2: null,
});

/**
 * A file's type as the upload route sees it: its own type, or for a PDF or HEIC the browser
 * didn't label (empty or application/octet-stream), the type its name says. The page checks
 * this against UPLOAD_TYPES so nothing is refused after signing.
 */
export function uploadType(f: { type: string; name: string }): string {
  const t = f.type === "application/octet-stream" ? "" : f.type;
  if (t) return t;
  if (/\.pdf$/i.test(f.name)) return "application/pdf";
  if (/\.heic$/i.test(f.name)) return "image/heic";
  return "";
}
