// deno test --node-modules-dir=none tests/lead-intake.test.ts
//
// Leads come in one way: the application's first screen, through POST /api/application/start,
// which checks the per-network limit before it saves anything. The old POST /api/leads (the lead
// form of the /apply flow, removed 2026-11-27) took any answers and any rep's ref, so anyone could
// make fake leads and "Started on your link" alerts for any rep. These read the sources as text,
// so no file permission is needed. tests/server-stamp.local.ts checks the same against a running
// site and a local database.
import { assert, assertEquals } from "jsr:@std/assert@1";
import routeTree from "../src/routeTree.gen.ts" with { type: "text" };
import useAuth from "../src/hooks/use-auth.ts" with { type: "text" };
import start from "../src/lib/application-start.server.ts" with { type: "text" };

/** The paths the site answers, as the generated route tree lists them. */
const paths = new Set([...routeTree.matchAll(/\bpath: '([^']+)'/g)].map((m) => m[1]));

Deno.test("the site has no /api/leads route, so a post there gets a 404", () => {
  assert(paths.size > 10, "the route tree should list the site's paths");
  assertEquals(paths.has("/api/leads"), false);
  assertEquals(routeTree.includes("./routes/api.leads"), false);
});

Deno.test("the application's first screen is still a route", () => {
  assert(paths.has("/api/application/start"));
  assert(routeTree.includes("./routes/api.application.start"));
});

Deno.test("the browser no longer posts leads, and old /apply drafts are still saved", () => {
  assertEquals(useAuth.includes("/api/leads"), false);
  assertEquals(/\brecordLead\b/.test(useAuth), false);
  // the account page saves a finished pre-2026-11-19 /apply draft from this browser
  assert(useAuth.includes("export function saveDraftToAccount("));
});

/** True when the file is not there. A missing module rejects; no read permission is needed. */
async function missing(load: () => Promise<unknown>): Promise<boolean> {
  try {
    await load();
    return false;
  } catch (e) {
    return String(e).includes("Module not found");
  }
}

Deno.test("the route file, its server code and the old ApplyFlow are gone from src", async () => {
  // the route tree is rebuilt by the build, so this catches a re-added route file even before then
  assert(await missing(() => import("../src/routes/api.leads.ts", { with: { type: "text" } })));
  assert(await missing(() => import("../src/lib/leads.server.ts", { with: { type: "text" } })));
  assert(
    await missing(
      () => import("../src/components/site/apply-flow.tsx", { with: { type: "text" } }),
    ),
  );
});

// What the limit does (429 when over, nothing saved) is tested with stubs and against a local
// stack (tests/server-stamp.local.ts). This only checks the one place that saves leads still
// calls the limit and still saves with the server's stamp, whichever way the file is laid out.
Deno.test(
  "the first screen still calls the per-network limit and saves with the server stamp",
  () => {
    assert(start.includes('"lead_intake_allowed"'), "the limit is checked");
    // the insert carries the server's stamp (visitor()), which the leads table requires
    assert(/visitor\(\)\s*\.from\("leads"\)\s*\.insert\(/.test(start), "the lead is saved");
  },
);
