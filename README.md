# Factory Reporter

Offline-first factory visit reports, written on site and exported as one A4 PDF.

- English UI, mobile first, works offline as a PWA (no build step, no dependencies).
- 7 sections, and **an empty checklist by default**: the factory profile and the
  scale/facilities fields are filled in, while every checklist item is yours to
  write in Settings. A section with no item stays hidden in the form and in the
  PDF, so a fresh install never prints somebody else's questions.
- Items are records, not scores: OK / Partly / Issue / N/A plus a note and
  photos. The progress bar counts records.
- **Cover photo**: the factory gate or main building. It becomes the thumbnail on
  the home screen, so a visit is recognised at a glance, and it is printed on the
  cover of the PDF. Business-card photos are kept out of that fallback.
- **Business card**: photograph the card of the person you actually talk to. It
  prints in the factory profile, next to the contact it belongs to.
- **Own values**: main products, main markets and in-house processes carry a
  "+ Other" chip, so a product that is not on the list can simply be typed in.
  It is stored on the visit only - the template stays clean.
- Profile also records main markets and main customers / brands. There is no
  business-licence number and no licence-address comparison, and the commercial
  section no longer repeats export markets - they are recorded once, in the profile.
- **Editable template**: section titles, field labels, every option list (products,
  markets, in-house processes, contact roles, buildings…), the four
  record states and the photo categories can all be renamed, reordered, extended or
  deleted in Settings. The defaults are a shower-enclosure factory; retune them
  in a minute for a hardware, faucet or glass factory.
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
