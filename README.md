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
