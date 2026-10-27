import { useCallback, useEffect, useState } from "react";
import { Loader2, Phone, Plus } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { stamp } from "@/lib/staff";
import { btnOutline, card } from "@/components/site/layout";
import { chip, textarea } from "@/components/staff/field-styles";

/**
 * Notes added by Lamp staff: what a rep learns by phone, email or from a document that the
 * merchant didn't put on the application, like a balance they gave on a call. Dated, with the
 * author's name, never edited (withdraw one and add a new one), never shown to the merchant, and
 * labelled "not signed by the merchant" wherever they appear. A note ticked for funders goes in
 * the funder email under that label, never on the signed application PDF. Only an admin or the
 * file's rep sees them.
 */

type Note = {
  id: string;
  about: string;
  body: string;
  source: string;
  share_with_funders: boolean;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
  withdrawn_at: string | null;
};

const ABOUT: { id: string; label: string }[] = [
  { id: "property", label: "Real estate" },
  { id: "funding", label: "Funding or balances" },
  { id: "business", label: "Business" },
  { id: "owners", label: "Owners" },
  { id: "other", label: "Something else" },
];
const SOURCE: { id: string; label: string }[] = [
  { id: "phone", label: "Phone call" },
  { id: "email", label: "Email" },
  { id: "text", label: "Text" },
  { id: "document", label: "A document" },
  { id: "other", label: "Other" },
];
const label = (list: { id: string; label: string }[], id: string) =>
  list.find((x) => x.id === id)?.label ?? id;

export function FileNotes({
  fileId,
  userId,
  isAdmin,
  onChange,
}: {
  fileId: string;
  userId: string;
  isAdmin: boolean;
  /** After a note is added or withdrawn, so the file's timeline reloads. */
  onChange?: () => void;
}) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [body, setBody] = useState("");
  const [about, setAbout] = useState("property");
  const [source, setSource] = useState("phone");
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showWithdrawn, setShowWithdrawn] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data, error: err } = await sb
      .from("application_staff_additions")
      .select(
        "id,about,body,source,share_with_funders,author_id,author_name,created_at,withdrawn_at",
      )
      .eq("application_id", fileId)
      .order("created_at", { ascending: false });
    if (err) {
      // not in the database yet: the box stays out of the way
      setNotes(err.code === "42P01" || err.code === "PGRST205" ? null : []);
      if (!(err.code === "42P01" || err.code === "PGRST205")) setError("Couldn't load the notes.");
      return;
    }
    setNotes((data ?? []) as Note[]);
  }, [fileId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (notes === null) return null;
  const live = notes.filter((n) => !n.withdrawn_at);
  const withdrawn = notes.filter((n) => n.withdrawn_at);

  async function add() {
    const sb = getSupabase();
    const text = body.trim();
    if (!sb || busy) return;
    if (text.length < 2) return setError("Write the note first.");
    setBusy("add");
    setError("");
    const { error: err } = await sb.from("application_staff_additions").insert({
      application_id: fileId,
      about,
      body: text.slice(0, 2000),
      source,
      share_with_funders: share,
    });
    setBusy(null);
    if (err) return setError("Couldn't add the note. Try again.");
    setBody("");
    setShare(false);
    setAdding(false);
    void load();
    onChange?.();
  }

  async function withdraw(n: Note) {
    const sb = getSupabase();
    if (
      !sb ||
      busy ||
      !window.confirm("Withdraw this note? It stays on the file, marked withdrawn.")
    )
      return;
    setBusy(n.id);
    const { data, error: err } = await sb
      .from("application_staff_additions")
      .update({ withdrawn_at: new Date().toISOString() })
      .eq("id", n.id)
      .select("id");
    setBusy(null);
    if (err || !data?.length) setError("Couldn't withdraw it. Only its author or an admin can.");
    void load();
    onChange?.();
  }

  const item = (n: Note, gone: boolean) => (
    <li
      key={n.id}
      className={cn("rounded-xl bg-sand px-4 py-3 text-sm", gone && "opacity-60")}
      data-note={n.id}
    >
      <p className={cn("whitespace-pre-line break-words", gone && "line-through")}>{n.body}</p>
      <p className="mt-1.5 text-xs text-smoke">
        {n.author_name ?? "Lamp staff"} · {stamp(n.created_at)} ·{" "}
        {label(SOURCE, n.source).toLowerCase()} · {label(ABOUT, n.about)}
        {n.share_with_funders && !gone ? " · goes to funders" : ""}
        {gone && n.withdrawn_at ? ` · withdrawn ${stamp(n.withdrawn_at)}` : ""}
      </p>
      {!gone && (isAdmin || n.author_id === userId) && (
        <button
          type="button"
          className={cn(chip, "mt-2")}
          disabled={!!busy}
          onClick={() => void withdraw(n)}
        >
          {busy === n.id && <Loader2 className="size-3.5 animate-spin" />} Withdraw
        </button>
      )}
    </li>
  );

  return (
    <section className={cn(card, "p-6")} data-staff-notes={live.length}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-display text-lg font-semibold">Added by Lamp staff</h3>
        <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-smoke ring-1 ring-line">
          Not signed by the merchant
        </span>
      </div>
      <p className="mt-2 text-sm text-smoke">
        What you learned outside the application, like a balance they gave you on a call. The
        merchant never sees these. To change what they signed, send it back for changes instead.
      </p>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      {live.length > 0 && <ul className="mt-4 space-y-2">{live.map((n) => item(n, false))}</ul>}
      {withdrawn.length > 0 && (
        <button
          type="button"
          className="mt-3 text-xs font-semibold text-smoke underline-offset-4 hover:underline"
          onClick={() => setShowWithdrawn((x) => !x)}
        >
          {showWithdrawn ? "Hide" : "Show"} withdrawn ({withdrawn.length})
        </button>
      )}
      {showWithdrawn && <ul className="mt-2 space-y-2">{withdrawn.map((n) => item(n, true))}</ul>}
      {adding ? (
        <div className="mt-4 space-y-3" data-note-form>
          <textarea
            className={textarea}
            value={body}
            maxLength={2000}
            placeholder="2nd mortgage on 45 Elm St: about $62,000 with Figure, $540 a month, current."
            onChange={(e) => setBody(e.target.value)}
            aria-label="Note"
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select
              className="rounded-full bg-white px-3 py-2 ring-1 ring-line"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              aria-label="Where it came from"
            >
              {SOURCE.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
            <select
              className="rounded-full bg-white px-3 py-2 ring-1 ring-line"
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              aria-label="What it's about"
            >
              {ABOUT.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0"
              checked={share}
              onChange={(e) => setShare(e.target.checked)}
            />
            <span>
              Include it in emails to funders, labelled "Added by Lamp staff (not part of the
              merchant's signed application)"
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={cn(btnOutline, "px-4 py-2")}
              disabled={!!busy}
              onClick={() => void add()}
            >
              {busy === "add" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Add note
            </button>
            <button
              type="button"
              className={cn(btnOutline, "px-4 py-2")}
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={cn(btnOutline, "mt-4 px-4 py-2")}
          onClick={() => setAdding(true)}
        >
          <Phone className="size-4" /> Add a note
        </button>
      )}
    </section>
  );
}
