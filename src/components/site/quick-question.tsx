import type { KeyboardEvent, MouseEvent } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChoiceQuestion } from "@/lib/apply";

/**
 * One quick question, one tap per answer: the front page's apply flow and the online
 * application's first screens both use it.
 *
 * With hrefFor, each answer is a link to the same page with that answer in the address
 * (2026-11-27), so a tap works before the page's script has loaded: the browser loads the link
 * and the server renders the next question. Once the script is running, the page handles the
 * tap itself and the link is never followed (a click with a modifier key still opens it).
 */
export function QuickQuestion({
  q,
  value,
  onChoose,
  hrefFor,
}: {
  q: ChoiceQuestion;
  value: string | undefined;
  onChoose: (id: string) => void;
  hrefFor?: (id: string) => string;
}) {
  return (
    <>
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{q.title}</h1>
      {q.subtitle && <p className="mt-3 text-lg text-smoke">{q.subtitle}</p>}
      <div className="mt-8 grid gap-3" role="radiogroup" aria-label={q.title}>
        {q.options.map((o) => {
          const selected = value === o.id;
          const cls = cn(
            "flex items-center justify-between rounded-2xl px-5 py-4 text-left text-[1.05rem] font-semibold transition",
            selected
              ? "bg-leaf/15 ring-2 ring-leaf"
              : "bg-white ring-1 ring-line hover:ring-ink/30",
          );
          const inner = (
            <>
              {o.label}
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full ring-1",
                  selected ? "bg-leaf text-ink ring-leaf" : "ring-line",
                )}
              >
                {selected && <Check className="size-4" />}
              </span>
            </>
          );
          if (!hrefFor)
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChoose(o.id)}
                className={cls}
              >
                {inner}
              </button>
            );
          return (
            <a
              key={o.id}
              href={hrefFor(o.id)}
              role="radio"
              aria-checked={selected}
              onClick={(e: MouseEvent<HTMLAnchorElement>) => {
                if (opensElsewhere(e)) return;
                e.preventDefault();
                onChoose(o.id);
              }}
              onKeyDown={(e: KeyboardEvent<HTMLAnchorElement>) => {
                // a radio answers to Space as well as Enter (Enter is a click on a link)
                if (e.key !== " ") return;
                e.preventDefault();
                onChoose(o.id);
              }}
              className={cls}
            >
              {inner}
            </a>
          );
        })}
      </div>
    </>
  );
}

/** A click meant for a new tab or window, which the browser handles. */
function opensElsewhere(e: MouseEvent<HTMLAnchorElement>): boolean {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}
