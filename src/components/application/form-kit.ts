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
