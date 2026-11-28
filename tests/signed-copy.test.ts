// deno test --node-modules-dir=none tests/signed-copy.test.ts
//
// 2026-11-23: the first application signed from a link (two owners) landed with everything but
// its signed PDF copy. The second, 34 minutes later, saved its copy in two seconds. The page tried
// once, swallowed whatever went wrong and told nobody, so the cause could not be read back. Now it
// tries again, and a copy that still did not save is written on the file's timeline with why.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { COPY_ALREADY_SAVED, copyMissingNote, saveSignedCopy } from "../src/lib/signed-copy.ts";
import server from "../src/lib/application-links.server.ts" with { type: "text" };
import steps from "../src/components/application/link-application.tsx" with { type: "text" };
import paper from "../src/components/application/paper-application.tsx" with { type: "text" };

const pdf = new Uint8Array([37, 80, 68, 70]);
const quick = { waitMs: 0 };

Deno.test("copy: saved first time means one build, one send, nothing to report", async () => {
  let builds = 0,
    sends = 0;
  const why = await saveSignedCopy(
    async () => (builds++, pdf),
    async () => (sends++, null),
    quick,
  );
  assertEquals([why, builds, sends], [null, 1, 1]);
});

Deno.test("copy: a send that fails is tried again without building the PDF twice", async () => {
  let builds = 0,
    sends = 0;
  const why = await saveSignedCopy(
    async () => (builds++, pdf),
    async () => (++sends === 1 ? "Couldn't store the file. Try again." : null),
    quick,
  );
  assertEquals([why, builds, sends], [null, 1, 2]);
});

Deno.test("copy: a dropped connection is tried again too", async () => {
  let sends = 0;
  const why = await saveSignedCopy(
    async () => pdf,
    async () => {
      if (++sends === 1) throw new TypeError("Failed to fetch");
      return null;
    },
    quick,
  );
  assertEquals([why, sends], [null, 2]);
});

Deno.test("copy: 'already saved' on the second try means the first one landed", async () => {
  let sends = 0;
  const why = await saveSignedCopy(
    async () => pdf,
    async () => {
      if (++sends === 1) throw new Error("timed out");
      return COPY_ALREADY_SAVED;
    },
    quick,
  );
  assertEquals(why, null);
  assert(server.includes(`const already = "${COPY_ALREADY_SAVED}";`), "the server's own words");
});

Deno.test(
  "copy: after two failures it says which step failed and why, and never throws",
  async () => {
    assertEquals(
      await saveSignedCopy(
        async () => {
          throw new Error("Couldn't load the application form.");
        },
        async () => null,
        quick,
      ),
      "the PDF could not be built (Couldn't load the application form.)",
    );
    assertEquals(
      await saveSignedCopy(
        async () => pdf,
        async () => "That PDF is too large.",
        quick,
      ),
      "the upload was refused (That PDF is too large.)",
    );
    assertEquals(
      await saveSignedCopy(
        async () => pdf,
        async () => {
          throw new TypeError("Failed to fetch");
        },
        quick,
      ),
      "the upload did not go through (Failed to fetch)",
    );
  },
);

Deno.test("timeline: the note says what happened and what to do", () => {
  const note = copyMissingNote("the upload did not go through (Failed to fetch)");
  assert(
    note.startsWith(
      "The signed PDF copy did not save from the merchant's browser: the upload did not go through",
    ),
  );
  assert(note.includes("use the application's Download to make the PDF"));
  assert(copyMissingNote("x".repeat(500)).length < 400);
});

Deno.test("pages: both application pages use it and pass the reason on", () => {
  for (const [name, page] of [
    ["step-by-step", steps],
    ["one-page", paper],
  ] as const) {
    assert(page.includes("const copyError = await saveSignedCopy("), name);
    assert(page.includes("...(copyError ? { copy_error: copyError } : {}),"), name);
    assert(
      !page.includes("/* staff build it from the saved answers */"),
      `${name} still swallows it`,
    );
  }
});

Deno.test("server: the reason is written on the file only while the copy is really missing", () => {
  const fn = server.slice(server.indexOf("export async function notifyNewApplication("));
  const note = fn.indexOf("copyMissingNote(opts.copyError.trim())");
  assert(note > 0);
  // after the caller is proven and the file is signed, never before
  assert(
    fn.indexOf("if (!allowed) return json(404") < note && fn.indexOf('"Not signed yet."') < note,
  );
  assert(fn.slice(0, note).includes('.eq("kind", "funder_application")'));
  assert(fn.slice(0, note).includes("(copy.count ?? 0) === 0"));
});
