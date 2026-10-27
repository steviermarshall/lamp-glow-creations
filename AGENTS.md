<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Sensitive data goes through the site's server

Files in the `documents` bucket, changes to `documents` rows, staff reads of the full
application (SSNs) and the public lead form go through the site's own server routes
(`/api/documents`, `/api/documents/upload`, `/api/application-details`, `/api/leads`), not the
Supabase client in the browser. The database refuses the browser for those once the server
stamp is switched on (`docs/database.md`, "Through the site's server"), so a new screen that
calls `supabase.storage` or writes `documents` from the browser gets nothing back.
