import type { ReactNode } from "react";

export function Field({
  label,
  hint,
  children,
  wide = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? "block sm:col-span-2" : "block"}>
      <span className="mb-1 block text-xs font-semibold text-smoke">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-smoke">{hint}</span>}
    </label>
  );
}
