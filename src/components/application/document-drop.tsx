import { useCallback, useEffect, useRef, useState } from "react";
import { Check, FileUp, Loader2 } from "lucide-react";
import { PageShell, card } from "@/components/site/layout";
import { cn } from "@/lib/utils";
import { MAX_UPLOAD_BYTES } from "@/lib/application-links";
import { DOC_ITEMS, isDocItemKey } from "@/lib/document-requests";

/**
 * The merchant's documents link (getlamp.app/upload/<link>): what Lamp asked for, a drop zone for
 * each, and what has come in. No sign-in: the link itself is the key, and it can only add files to
 * the one file it was made for. Files go to Lamp's server (document-requests.server.ts), never
 * straight to storage from here.
 */

type Item = { key: string; label: string };
type Info = {
  first_name: string | null;
  business_name: string | null;
  from: string;
  items: Item[];
  note: string | null;
  expires_at: string;
  received: { name: string; kind: string; at: string }[];
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function DocumentDrop({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, string[]>>({});

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/documents/request?token=${encodeURIComponent(token)}`);
      const j = (await r.json()) as Info & { error?: string };
      if (!r.ok) throw new Error(j.error || "This link isn't working.");
      setInfo(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "This link isn't working.");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(item: Item, files: FileList | File[]) {
    setError("");
    for (const file of [...files]) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(`${file.name} is over 20 MB. Send a smaller copy or a photo.`);
        continue;
      }
      setBusy(`${item.key}:${file.name}`);
      const form = new FormData();
      form.set("token", token);
      form.set("item", item.key);
      form.set("file", file);
      try {
        const r = await fetch("/api/documents/request-upload", { method: "POST", body: form });
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) throw new Error(j.error || "That file didn't go through. Try again.");
        setSent((s) => ({ ...s, [item.key]: [...(s[item.key] ?? []), file.name] }));
      } catch (e) {
        setError(
          e instanceof Error ? `${file.name}: ${e.message}` : "That file didn't go through.",
        );
      }
    }
    setBusy(null);
    void load();
  }

  return (
    <PageShell member themeToggle={false} minimalHeader footer={false} tone="night-calm">
      <div className="mx-auto max-w-2xl px-4 pb-20 pt-8 sm:pt-12">
        {!info && !error && (
          <div className="grid place-items-center py-24">
            <Loader2 className="size-6 animate-spin text-smoke" />
          </div>
        )}
        {!info && error && (
          <section className={cn(card, "p-6")}>
            <h1 className="font-display text-2xl font-bold">This link isn&apos;t working</h1>
            <p className="mt-2 text-smoke">{error}</p>
          </section>
        )}
        {info && (
          <>
            <p className="text-sm text-smoke">
              {info.business_name ? `${info.business_name} · ` : ""}from {info.from} at Lamp
            </p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">
              {info.first_name ? `${info.first_name}, ` : ""}send us these documents
            </h1>
            <p className="mt-2 text-sm text-smoke">
              Drag files onto each box, or tap it to choose them. PDFs and photos (JPG, PNG, HEIC)
              up to 20 MB each. They go straight to your file at Lamp.
            </p>
            {info.note && (
              <p className="mt-4 whitespace-pre-line rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-line">
                {info.note}
              </p>
            )}
            {error && (
              <p className="mt-4 text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <ul className="mt-6 space-y-3">
              {info.items.map((item) => (
                <DropBox
                  key={item.key}
                  item={item}
                  hint={isDocItemKey(item.key) ? DOC_ITEMS[item.key].hint : ""}
                  busy={!!busy && busy.startsWith(`${item.key}:`)}
                  done={sent[item.key] ?? []}
                  onFiles={(f) => void upload(item, f)}
                />
              ))}
            </ul>
            {info.received.length > 0 && (
              <section className={cn(card, "mt-6 p-5")}>
                <p className="text-sm font-semibold">Received</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {info.received.map((d, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <Check className="size-4 shrink-0 text-forest" />
                      <span className="min-w-0 flex-1 truncate">{d.name}</span>
                      <span className="shrink-0 text-xs text-smoke">{when(d.at)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className="mt-6 text-xs text-smoke">
              This link works until{" "}
              {new Date(info.expires_at).toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
              })}
              . It can only add files to your application; it can&apos;t show anything already on
              it.
            </p>
          </>
        )}
      </div>
    </PageShell>
  );
}

function DropBox({
  item,
  hint,
  busy,
  done,
  onFiles,
}: {
  item: Item;
  hint: string;
  busy: boolean;
  done: string[];
  onFiles: (files: FileList) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  return (
    <li>
      <button
        type="button"
        data-drop={item.key}
        className={cn(
          card,
          "flex w-full items-center gap-4 p-4 text-left transition",
          over ? "ring-2 ring-leaf" : "hover:ring-1 hover:ring-ink/30",
        )}
        onClick={() => ref.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
        }}
      >
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-full",
            done.length ? "bg-leaf/20 text-forest" : "bg-sand",
          )}
        >
          {busy ? (
            <Loader2 className="size-5 animate-spin" />
          ) : done.length ? (
            <Check className="size-5" />
          ) : (
            <FileUp className="size-5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{item.label}</span>
          <span className="block text-xs text-smoke">
            {done.length ? `Sent: ${done.join(", ")}` : hint || "Drop files here or tap to choose"}
          </span>
        </span>
      </button>
      <input
        ref={ref}
        type="file"
        multiple
        accept="application/pdf,image/jpeg,image/png,image/heic,.heic"
        className="sr-only"
        aria-label={`Choose files: ${item.label}`}
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </li>
  );
}
