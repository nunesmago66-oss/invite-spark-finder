<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules

- Invite checks run only through the `checkInvite` server function (`src/lib/vanity/`); the browser never calls Discord directly, so CORS and rate-limit handling stay in one place.
- Verification rules (status classification, min interval, batch auto-pause, consecutive-error pause, stop-on-429 queue) live in `src/lib/vanity/check-rules.ts` with tests beside it; change them there, not in components.
- Scanner candidate generation and compact result storage live in `src/lib/vanity/scanner.ts` so ~48k results fit in localStorage and survive reloads.
- User data (catalog, favorites, selection, scan results/progress) is stored in the browser only (localStorage/sessionStorage); no accounts or backend database.
- Meaning discovery uses a deterministic multilingual dictionary and phonetic generator in `meaning-generator.ts`; invented sounds remain separate from dictionary meanings to prevent fabricated translations.
- Exhaustive and meaning scanners have separate persistent configs/results and use the same ScannerTab/verification queue; shared cooldown and last-request time plus mutual exclusion preserve rate limits across modes.
- Persist browser state through versioned validation and non-destructive recovery sidecars; surface save failures and retain unsaved values for retry/backup to avoid silent data loss.
- Hold a Web Lock or an atomic IndexedDB readwrite transaction for the entire verification queue; fail closed if neither works, and reread shared timing under the lock to prevent cross-tab overlap.
