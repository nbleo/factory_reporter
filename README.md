# Factory Reporter

Offline-first factory visit reports, written on site and exported as one A4 PDF.

- English UI, mobile first, works offline as a PWA (no build step, no dependencies).
- 7 sections, 25 default checklist items, each recorded as OK / Partly / Issue /
  N/A with a note and optional photos. Nothing is scored.
- **Cover photo**: the factory gate or main building. It becomes the thumbnail on
  the home screen, so a visit is recognised at a glance, and it is printed on the
  cover of the PDF.
- **Editable template**: section titles, field labels, every option list (products,
  in-house processes, contact roles, export markets, buildings…), the four record
  states and the photo categories can all be renamed, reordered, extended or
  deleted in Settings. The defaults are a shower-enclosure factory; retune them
  in a minute for a hardware, faucet or glass factory.
- Checklist wording, add/delete/reorder and "reset to defaults" live in Settings.
- Camera import with client-side resize, summary comments on the home screen,
  one-tap PDF with cover, findings tables, summary and photo appendix.
- Records go to a separate **private** repository through a fine-grained token;
  the app refuses to write to a public repository.

Program only. No factory data, no company data and no tokens in this repository.

## Live app

<https://nbleo.github.io/factory_reporter/> - open it on the phone and use
"Add to Home Screen" to install it as an app.

## Deploying a change

The site is published from the `gh-pages` branch (Pages -> "Deploy from a
branch", branch `gh-pages`, folder `/ (root)`). `gh-pages` is generated: it holds
a copy of `app/` at its root, rebuilt in full on every release.

```bash
GITHUB_TOKEN=<fine-grained PAT> python scripts/push_via_api.py --pages --message "v2.1.1: ..."
```

The script pushes `main` (source), rebuilds `gh-pages` from `app/`, and points
Pages at it. `git push` itself does not work on this network; the script talks
to `api.github.com` instead.

Token needs, on `nbleo/factory_reporter` (fine-grained, **All repositories**):

| Permission | Level | Why |
|---|---|---|
| Contents | Read and write | push `main` and rebuild `gh-pages` |
| Pages | Read and write | only for the very first setup, or to re-point the source |

`.github/workflows/*` cannot be pushed without the separate **Workflows**
permission, which is why deployment uses a branch instead of an Action.

Remember to bump `APP_VERSION` in `app/js/model.js` and the `CACHE` name in
`app/sw.js` together - the service worker only refreshes when the cache name
changes. `tests/e2e_offline.js` asserts that the two match.
