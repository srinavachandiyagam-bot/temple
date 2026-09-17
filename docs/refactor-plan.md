# Refactor Plan — Nava Chandi Yagam premium rebuild

## CURRENT (what exists today)

- Stack: Express (`src/server.js`, routes in `src/routes/api.js`) serving a single
  vanilla-JS page `public/index.html` (~1MB, mostly inline base64 images) + `public/admin.html`.
  No frontend framework, no build step. SQLite (default) or Postgres. Cashfree payments
  with `MOCK_MODE=true` simulator. Tests in `test/` run with plain `node` (`npm test`).
- Page structure: sticky simple header (brand + 4 links + lang select + burger) →
  full-bleed hero (busy poster bg, low-contrast overlaid title/tagline/₹ pill/2 CTAs) →
  About + 3 cards → Event details (date/time/amount/venue + map btn) → registration form
  (name, mobile, email, gothram, rasi, natchathiram, address, up to 4 family members,
  optional donation, fee/total preview, Cashfree submit) → gallery → videos → contact
  → footer → WhatsApp float.
- Content source: `STANDALONE_DATA` inline + `/api/public` overlay from `data/settings.json`
  (Tamil+English, language toggle via `data-ta/data-en`, `localStorage.siteLang`).
- Assets: poster + 2 photos were inline base64 → extracted to `public/uploads/`
  (`poster.jpg`, `IMG_3534.jpeg`, `IMG_3533.jpeg`); `public/videos/` empty.
- Event facts (do not invent beyond these): 18-10-2026, காலை 7:00, ₹1,000,
  Sri Mariamman Temple Senthampalayam/Kavindapadi/Erode-638455, sankalpam for
  well-being/health/prosperity/peace, temple-committee organised, 1+4 family per
  registration, contacts Primary 9150232419 Marimuthu / 7539953653 Mevi Murugan / 6381606039 Balaji / 8838581693 Abishek Marimuthu, email srinavachandiyagam@gmail.com, map URL, WhatsApp 9150232419, footer "Website Managed by Abishek Marimuthu".
- Gaps vs reference: no countdown, no sticky section nav, no sidebar, no process
  timeline, no FAQ, weak mobile rhythm, hero contrast issues, scattered hex values.

## REFERENCE (what VedaMandir does visually)

See `docs/visual-reference.md`. In short: white ~92px header; 2-col hero
(media card + stats left; eyebrow/H1/info-card/family-note/countdown/big pill CTA/
WhatsApp+Call outlines/mint assurance grid right); mint trust band; sticky
scrollable section tabs with maroon indicator; main+sticky-sidebar body
(about+meta strip, recommendations rail, benefit cards, numbered process timeline,
temple, inclusions, FAQ accordion, gallery); dark-maroon footer CTA + cream footer;
mobile sticky bottom booking bar; Noto Serif/Sans Tamil pairing.

## MAPPING (existing → new, no fabricated facts)

| Existing | New home |
|---|---|
| Header brand/links/lang/menu | Premium white header: flame mark + நவசண்டி யாகம்; links About/Benefits/Event/Process/Venue/Register/Contact; lang select; mobile burger |
| Hero title/tagline/₹/CTAs/poster | 2-col hero: left poster card + fact row (₹1,000 · 1+4 குடும்பம் · 18-10-2026); right eyebrow/H1/info-card (venue+date rows)/family note/countdown to 2026-10-18T07:00+05:30/primary CTA pill/WhatsApp+Call outlines/4-item assurance grid (sankalpam, வேத ஆகம முறை, கோவில் குழு ஏற்பாடு, நேரடி தொடர்பு — all from about/contacts) |
| About + 3 benefit cards | About (full text, no clamp needed) + meta strip (தேதி/நேரம்/பங்கேற்பு) + benefits grid reusing benefit1-3 settings keys |
| Event details block | Folded into hero info-card + dedicated "நிகழ்வு" section with date/time/fee/venue cards + map CTA |
| (none) | "யாக முறை" numbered timeline, 4 steps paraphrased from about text only: சங்கல்பம் / சண்டிகா வழிபாடு / நவசக்தி அருள் வேண்டல் / குடும்பத்துடன் அருள் பெறுதல் |
| Contact/venue | "இடம்" section (address, map, organiser, 4 phone cards: Primary 9150232419 + 7539953653, 6381606039, 8838581693 Abishek Marimuthu, email srinavachandiyagam@gmail.com, Website Managed by Abishek Marimuthu) |
| (none) | "உங்களுக்கு" inclusions: family sankalpam + 4 members + contact support (numbered 01-03, grounded) |
| Registration form | Same fields/contract, restyled: grouped fieldsets, focus/error/loading/success states, fee/total summary, donation input |
| (none) | FAQ accordion (5 Qs answered strictly from settings: fee, family, date/venue, how to register/pay, contact) |
| Gallery/videos | Same dynamic grids, lazy images, horizontal rail on mobile; hidden when empty |
| Footer | Maroon final-CTA band + cream footer (brand, quick links, contact, copyright from footer_* keys) |
| WhatsApp float | Kept; plus mobile sticky CTA bar (price + பதிவு) hiding near form/footer |
| Recommendations rail | OMITTED (no other events; would require fabrication) |

## COMPONENT PLAN (single-file rebuild of `public/index.html`)

Keep one vanilla file (no new deps): CSS design tokens (`:root`), header, hero,
trust band, section nav, main+aside layout, sections (about/benefits/event/process/
venue/inclusions/register/faq/gallery/videos/final-cta), footer, sticky mobile CTA.
JS: preserve ALL existing hooks/IDs/contracts (`load`, `applyLang`, `checkPaymentReturn`,
Cashfree/mock submit, rasi/nakshatra selects, member blocks, donation preview) and add:
countdown to event date, scroll-spy tabs, FAQ accordion, sticky-CTA visibility,
burger menu, reveal-on-scroll (reduced-motion safe). Images via `/uploads/` with
`IMAGE_DATA={}` fallback removed (loader keeps `/uploads/` + datauri fallback logic).

## Verification

- `MOCK_MODE=true` server; Playwright screenshots 1440x1000 / 768x1024 / 390x844;
  3 refinement passes; `npm test`; mock registration POST; no console errors;
  no horizontal overflow; production `node index.js` boot check.
