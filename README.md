# Lamp Site Launch

i  want to create this website for this business , connected to this git hub account https://github.com/steviermarshall/Lamp-SIte-.git

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://lamp-glow-creations.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/cd655cf9-29e7-4199-9c12-4d17b1b352f1).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Site structure

| Route | What it is |
| --- | --- |
| `/` | Landing page: amount picker, how it works, funding options, cost calculator, FAQ |
| `/apply` | One-question-per-screen flow → estimate → create account (Google or email link) |
| `/login` | Sign in for returning users |
| `/account` | Dashboard: file status, document uploads, answers |
| `/about`, `/faq`, `/privacy`, `/terms` | Content & legal pages |

## Accounts (Lovable Cloud / Supabase)

Accounts, leads and uploads use Supabase. Until it's connected, the site still works and
the last step falls back to "email us your answers".

1. In Lovable, enable **Cloud** (or connect Supabase). It provides `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY`.
2. Run `supabase/migrations/20260928000000_applications_leads_documents.sql` (creates
   `applications`, `leads`, and a private `documents` storage bucket, all with row-level security).
3. Auth settings: enable **Email** (magic link) and **Google** providers, and add your site URL
   plus `/account` to the allowed redirect URLs.

Applications and leads are visible to the Lamp team in the Supabase table editor; change an
application's `status` to `reviewing` / `offers_ready` / `funded` to update the customer's dashboard.

## Email-marketing links

`/apply` accepts URL parameters so a campaign link can skip questions you already know and greet
people by name. Anything answered in the link is skipped; UTM tags are saved with the application.

```
/apply?name=Maria&amount=50-100k&industry=trucking&utm_source=email&utm_campaign=fall
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
| `name`, `business`, `email`, `phone` | free text (prefills the contact step) |

With Mailchimp/Klaviyo merge tags, e.g. `/apply?name=*|FNAME|*&email=*|EMAIL|*&utm_source=email`.
