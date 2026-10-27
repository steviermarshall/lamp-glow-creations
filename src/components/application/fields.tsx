import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { US_STATES } from "@/lib/application-details";
import type { Opt } from "@/lib/real-estate";

/**
 * The full application's form pieces, shared by the application link page and the merchant's
 * account page. Light-class vocabulary on purpose: Lamplight pages (tone "night") remap white
 * fields, ink text and hairlines to the green glass look in styles.css.
 */

export const inputCls =
  "w-full rounded-xl bg-white px-3.5 py-3 text-base text-ink sm:text-[0.95rem] ring-1 ring-line placeholder:text-smoke/60 focus:outline-none focus:ring-2 focus:ring-leaf/70";

export function Group({
  title,
  hint,
  children,
  id,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <fieldset id={id} className="scroll-mt-28">
      <legend className="font-display text-lg font-semibold tracking-tight">{title}</legend>
      {hint && <p className="mt-1 text-sm leading-relaxed text-smoke">{hint}</p>}
      <div className="mt-4 grid gap-x-4 gap-y-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function F({
  label,
  hint,
  wide = false,
  optional = false,
  children,
}: {
  label: string;
  hint?: string | undefined;
  wide?: boolean;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={cn("block", wide && "sm:col-span-2")}>
      <span className="mb-1.5 flex items-baseline gap-2 text-[0.8rem] font-semibold text-smoke">
        {label}
        {optional && <span className="font-normal opacity-70">optional</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-smoke">{hint}</span>}
    </label>
  );
}

export function Text({
  value,
  onChange,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <input
      {...rest}
      className={cn(inputCls, rest.className)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Dollars: digits, commas and a decimal point only, with a $ in front. */
export function Money({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-smoke">
        $
      </span>
      <input
        className={cn(inputCls, "pl-7 tabular-nums")}
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
      />
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  placeholder = "Choose one",
}: {
  value: string;
  onChange: (v: string) => void;
  options: (Opt | string)[];
  placeholder?: string;
}) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) =>
        typeof o === "string" ? (
          <option key={o} value={o}>
            {o}
          </option>
        ) : (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ),
      )}
    </select>
  );
}

export function StateSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select
      value={value.toUpperCase()}
      onChange={onChange}
      options={US_STATES}
      placeholder="State"
    />
  );
}

/** Two to four buttons in a row, for short answers like Yes / No. */
export function Choice<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T | "";
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={cn(
              "rounded-full px-4 py-2.5 text-sm font-semibold transition",
              on
                ? "bg-leaf text-ink ring-1 ring-leaf"
                : "bg-white ring-1 ring-line hover:ring-ink/30",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Address on one line, then city, state and ZIP. */
export function Address({
  value,
  onChange,
  label,
}: {
  value: { address: string; city: string; state: string; zip: string };
  onChange: (k: "address" | "city" | "state" | "zip", v: string) => void;
  label: string;
}) {
  return (
    <>
      <F label={label} wide>
        <Text
          value={value.address}
          onChange={(v) => onChange("address", v)}
          autoComplete="street-address"
          placeholder="Street and number"
        />
      </F>
      <F label="City">
        <Text
          value={value.city}
          onChange={(v) => onChange("city", v)}
          autoComplete="address-level2"
        />
      </F>
      <div className="grid grid-cols-2 gap-3">
        <F label="State">
          <StateSelect value={value.state} onChange={(v) => onChange("state", v)} />
        </F>
        <F label="ZIP">
          <Text
            value={value.zip}
            onChange={(v) => onChange("zip", v.replace(/\D/g, "").slice(0, 5))}
            inputMode="numeric"
            autoComplete="postal-code"
          />
        </F>
      </div>
    </>
  );
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Month and year as two selects, stored as "YYYY-MM". Not <input type="month">: desktop Safari
 * and Firefox show that as a plain text box, and a typed "03/2019" would never validate.
 */
export function MonthYear({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  // a half-picked value ("2019-") is kept so the other select can finish it
  const [py = "", pm = ""] = value.split("-");
  const y = /^\d{4}$/.test(py) ? py : "";
  const m = /^\d{2}$/.test(pm) ? pm : "";
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 80 }, (_, i) => String(thisYear - i));
  const put = (year: string, month: string) => onChange(year || month ? `${year}-${month}` : "");
  return (
    <div className="grid grid-cols-[1.4fr_1fr] gap-2" role="group" aria-label={label}>
      <select
        className={inputCls}
        aria-label={`${label}: month`}
        value={m}
        onChange={(e) => put(y, e.target.value)}
      >
        <option value="">Month</option>
        {MONTHS.map((name, i) => (
          <option key={name} value={String(i + 1).padStart(2, "0")}>
            {name}
          </option>
        ))}
      </select>
      <select
        className={inputCls}
        aria-label={`${label}: year`}
        value={y}
        onChange={(e) => put(e.target.value, m)}
      >
        <option value="">Year</option>
        {years.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
    </div>
  );
}
