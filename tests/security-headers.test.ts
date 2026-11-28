// deno test --node-modules-dir=none tests/security-headers.test.ts
//
// 2026-11-27, gap 13. getlamp.app sent no content-security-policy, x-frame-options or
// permissions-policy, so any site could put Lamp's application or staff pages in a frame and
// trick a click. src/server.ts now adds them to every response it sends: frame-ancestors 'self'
// (plus the Lovable editor on Lovable preview addresses, so the editor preview keeps working),
// x-frame-options SAMEORIGIN off those preview addresses, base-uri 'self', object-src 'none',
// and camera, microphone, location and payment turned off. These tests run the server with a
// stub in place of TanStack Start's handler.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { createServer } from "../src/server.ts";

type Handler = (request: Request) => Response | Promise<Response>;

function serve(handler: Handler) {
  return createServer(() => Promise.resolve({ fetch: (request: Request) => handler(request) }));
}

function page(): Response {
  return new Response("<!doctype html><p>ok</p>", {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function get(url: string, handler: Handler = page): Promise<Response> {
  const response = await serve(handler).fetch(new Request(url), {}, {});
  await response.body?.cancel();
  return response;
}

function csp(response: Response): string {
  return response.headers.get("content-security-policy") ?? "";
}

Deno.test("getlamp.app: the application page carries every header", async () => {
  const response = await get("https://getlamp.app/application");
  assertEquals(response.status, 200);
  assertEquals(csp(response), "frame-ancestors 'self'; base-uri 'self'; object-src 'none'");
  assertEquals(response.headers.get("x-frame-options"), "SAMEORIGIN");
  assertEquals(
    response.headers.get("permissions-policy"),
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  assertEquals(response.headers.get("x-content-type-options"), "nosniff");
  assertEquals(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
});

Deno.test(
  "getlamp.app: no script-src, so the inline head scripts and the host script still run",
  async () => {
    // Only paths the worker serves. Static files in public/ (such as /forms/lamp-application.pdf)
    // are answered by the host's asset layer before src/server.ts runs, so they never get these
    // headers and are not tested here.
    for (const path of ["/application", "/staff", "/application/rep-1/pdf"]) {
      const value = csp(await get(`https://getlamp.app${path}`));
      assert(!value.includes("script-src"), `${path}: ${value}`);
      assert(!value.includes("default-src"), `${path}: ${value}`);
      assert(!value.includes("lovable.dev"), `${path}: only Lamp may frame getlamp.app`);
      assert(!value.includes("gptengineer"), `${path}: only Lamp may frame getlamp.app`);
    }
  },
);

Deno.test(
  "Lovable preview addresses: lovable.dev may frame the page, and no x-frame-options",
  async () => {
    for (const host of [
      "abc123.lovableproject.com",
      "id-preview--abc123.lovable.app",
      "abc123.lovableproject-dev.com",
      "abc123.gpt-eng.com",
      "abc123.gptengineer.run",
    ]) {
      const response = await get(`https://${host}/staff`);
      assertEquals(
        csp(response),
        "frame-ancestors 'self' https://lovable.dev https://*.lovable.dev https://gptengineer.app https://*.gptengineer.app; base-uri 'self'; object-src 'none'",
        host,
      );
      assertEquals(response.headers.get("x-frame-options"), null, host);
      assertEquals(
        response.headers.get("permissions-policy"),
        "camera=(), microphone=(), geolocation=(), payment=()",
        host,
      );
    }
  },
);

Deno.test("look-alike addresses get the strict policy", async () => {
  for (const host of [
    "lovableproject.com.evil.example",
    "evil-lovableproject.com",
    "lovable.app",
    "gptengineer.run.evil.example",
    "evil-gpt-eng.com",
    // The editor's own domains are not preview addresses.
    "lovable.dev",
    "abc.gptengineer.app",
  ]) {
    const response = await get(`https://${host}/staff`);
    assertEquals(csp(response), "frame-ancestors 'self'; base-uri 'self'; object-src 'none'", host);
    assertEquals(response.headers.get("x-frame-options"), "SAMEORIGIN", host);
  }
});

Deno.test("headers a route already set are left alone", async () => {
  const response = await get(
    "https://getlamp.app/application/rep-1/pdf",
    () =>
      new Response("%PDF-1.7", {
        headers: {
          "content-type": "application/pdf",
          "content-security-policy": "sandbox",
          "x-frame-options": "DENY",
          "referrer-policy": "no-referrer",
        },
      }),
  );
  assertEquals(response.headers.get("content-type"), "application/pdf");
  assertEquals(csp(response), "sandbox");
  assertEquals(response.headers.get("x-frame-options"), "DENY");
  assertEquals(response.headers.get("referrer-policy"), "no-referrer");
  // The ones it didn't set are still filled in.
  assertEquals(
    response.headers.get("permissions-policy"),
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  assertEquals(response.headers.get("x-content-type-options"), "nosniff");
});

Deno.test(
  "a response whose headers can't be changed is copied, with its status, body and headers",
  async () => {
    // Response.redirect hands back headers that throw on set().
    const redirect = Response.redirect("https://getlamp.app/login", 302);
    let immutable = false;
    try {
      redirect.headers.set("x-probe", "1");
    } catch {
      immutable = true;
    }
    assert(immutable, "the stub must really have immutable headers");

    const redirected = await get("https://getlamp.app/account", () =>
      Response.redirect("https://getlamp.app/login", 302),
    );
    assertEquals(redirected.status, 302);
    assertEquals(redirected.headers.get("location"), "https://getlamp.app/login");
    assertEquals(csp(redirected), "frame-ancestors 'self'; base-uri 'self'; object-src 'none'");
    assertEquals(redirected.headers.get("x-frame-options"), "SAMEORIGIN");

    // A fetched-style response with a body: freeze its headers the same way and check the body.
    const frozen = new Response("hello", { status: 201, statusText: "Created" });
    const headers = frozen.headers;
    Object.defineProperty(frozen, "headers", {
      value: new Proxy(headers, {
        get(target, prop) {
          if (prop === "set") {
            return () => {
              throw new TypeError("immutable");
            };
          }
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    });
    const copied = await serve(() => frozen).fetch(
      new Request("https://getlamp.app/api/x"),
      {},
      {},
    );
    assert(copied !== frozen, "a new response is made");
    assertEquals(copied.status, 201);
    assertEquals(copied.statusText, "Created");
    assertEquals(await copied.text(), "hello");
    assertEquals(copied.headers.get("x-frame-options"), "SAMEORIGIN");
    assertStringIncludes(csp(copied), "frame-ancestors 'self'");
  },
);

Deno.test("the error page gets the headers too, when the handler throws", async () => {
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    const response = await serve(() => {
      throw new Error("boom");
    }).fetch(new Request("https://getlamp.app/staff"), {}, {});
    assertEquals(response.status, 500);
    assertStringIncludes(await response.text(), "<!doctype html>");
    assertEquals(response.headers.get("x-frame-options"), "SAMEORIGIN");
    assertEquals(csp(response), "frame-ancestors 'self'; base-uri 'self'; object-src 'none'");
  } finally {
    console.error = original;
  }
  assertEquals(errors.length, 1);
});

Deno.test("the error page that replaces h3's swallowed 500 gets the headers too", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const response = await serve(
      () =>
        new Response(JSON.stringify({ status: 500, unhandled: true, message: "HTTPError" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    ).fetch(new Request("https://getlamp.app/application"), {}, {});
    assertEquals(response.status, 500);
    assertEquals(response.headers.get("content-type"), "text/html; charset=utf-8");
    assertStringIncludes(await response.text(), "<!doctype html>");
    assertEquals(response.headers.get("x-frame-options"), "SAMEORIGIN");
    assertEquals(
      response.headers.get("permissions-policy"),
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
  } finally {
    console.error = original;
  }
});
