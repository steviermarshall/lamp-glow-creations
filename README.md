# Lamp

Lamp is a marketplace for merchant cash advances (MCA): a business sells part of its future
receivables to a funder for cash now. Merchants apply once at [getlamp.app](https://getlamp.app),
Lamp's reps work the file, and funders compete on it.

The site is TanStack Start (React, file routes in `src/routes/`) on Supabase (Lovable Cloud). It is
hosted by [Lovable](https://lovable.dev), which deploys from `main` of
`steviermarshall/lamp-glow-creations`. Changes made in the Lovable editor are committed to that
repository, and commits pushed to `main` sync back to the editor, so keep `main` working and never
rewrite its history (see `AGENTS.md`).

## How a file moves

1. **Quick questions.** On `/application` (or a rep's `/application/<rep>`) the merchant answers a
   few quick questions (amount, purpose, monthly deposits, time in business, credit guess,
   industry, timeline) and gives their name, business, phone and email. That first screen posts to
   `/api/application/start`, which saves a lead at once, within a per-network limit, and emails the
   rep (or Lamp, for the website) so someone can call while the merchant is still on the page.
2. **Full application.** The rest of the application follows on the same page and is saved as a
   draft as the merchant goes.
3. **Signing.** The merchant signs on the page. The signed file lands with the rep whose link it
   came from, or unassigned when it came from the website.
4. **Documents.** Staff ask for documents (statements, voided check, ID) with a one-time
   `/upload/<secret>` link; the merchant drops the files there without signing in.
5. **Staff.** Reps and admins work the file in the staff portal (`/staff`): documents, messages,
   funders, offers.

Sensitive data (documents, the full application with SSNs, new leads) goes through the site's own
server routes, never the Supabase client in the browser. `docs/database.md` explains why and how.

## Routes

| Route | What it is |
| --- | --- |
| `/` | Home page: amount picker, how it works, funding options, FAQ |
| `/application` | The website's own application: quick questions, then the full application. The file lands unassigned |
| `/application/<rep>` | A rep's public link: the same application, filed with that rep |
| `/application/<rep>?i=<token>` | A personal link a rep sent one merchant, with their details filled in |
| `/application/<rep>/pdf` | The same application as one page, filled in and signed on the page (also takes `?i=`) |
| `/upload/<secret>` | A documents link sent to one merchant |
| `/offer-check` | Offer Check: enter an offer's amount, payback and term to see its real cost, and compare up to three |
| `/account` | A merchant's own account after signing in: their file, documents, messages and offers |
| `/login` | Sign in (email link or Google) |
| `/staff` | The staff portal, for reps and admins |
| `/reminders/stop?t=<token>` | The stop link in a "finish your application" reminder |
| `/discord-link?t=<token>` | Connects a rep's Discord to their Lamp login, for alerts in Discord DMs |
| `/apply`, `/apply/<rep>` | Old links. They redirect to `/application` and `/application/<rep>`, keeping the quick answers and `utm_` tags |
| `/how-it-works`, `/about`, `/faq`, `/privacy`, `/terms` | Content and legal pages |
| `/api/*` | The site's server routes (`src/routes/api.*.ts`, code in `src/lib/*.server.ts`) |

## Development

The project uses [bun](https://bun.sh).

```sh
bun install
bun run dev
```

The browser needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Server secrets live
in Lovable Cloud's secrets and never in this repository: only `VITE_` publishable values may be
committed (`AGENTS.md`).

## Checks

Run all four before calling anything done. The same steps run on every pull request and every
change to `main` (`.github/workflows/checks.yml`).

```sh
bunx tsc --noEmit -p .                  # types
bunx eslint . --quiet                   # lint and formatting
bun run build                           # build
deno test --node-modules-dir=none tests/ # every test in tests/
```

Files named `tests/*.local.ts` check the database rules against a local Supabase stack only. Each
one says at the top how to run it.

## Docs

- `AGENTS.md`: the rules for anyone changing this code, people or agents.
- `docs/database.md`: tables, who may read and write what, and what goes through the site's server.
- `docs/calendar.md`, `docs/discord.md`: the calendar and Discord set-ups.
- `supabase/migrations/`: every database change, in order.

## Campaign links

`/application` and `/application/<rep>` accept the quick answers and `utm_` tags in the link.
Anything answered in the link is skipped, and the tags are saved with the lead. Old `/apply`
links pass the same values on when they redirect.

```
/application?amount=50-100k&industry=trucking&utm_source=email&utm_campaign=fall
/application/zeus?amount=25-50k&utm_source=facebook
```

| Param | Values |
| --- | --- |
| `amount` | `lt-25k`, `25-50k`, `50-100k`, `100-250k`, `250k-plus` |
| `purpose` | `cash-flow`, `payroll`, `inventory`, `equipment`, `expansion`, `other` |
| `revenue` | `lt-20k`, `20-50k`, `50-100k`, `100-250k`, `250k-plus` |
| `tib` | `lt-6m`, `6-12m`, `1-2y`, `2-5y`, `5y-plus` |
| `credit` | `lt-550`, `550-649`, `650-699`, `700-plus`, `unsure` |
| `industry` | `restaurant`, `trucking`, `construction`, `retail`, `beauty`, `auto`, `medical`, `other` |
| `timeline` | `asap`, `month`, `exploring` |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | free text, saved with the lead |

A value that is not in the list is ignored. Names, emails and phone numbers in the link are not
carried (`carriedSearch` in `src/lib/apply.ts` keeps only the quick answers and `utm_` tags), and
the rep comes from the link's path, not from a `ref` parameter.
