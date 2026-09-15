# Visual Reference — VedaMandir Pooja Details (observed, not copied)

Reference URL: https://vedamandir.com/tam/pooja-details/381
Inspected: 2026-09-15 via Playwright at 1440x1000, 390x844 (+ scrolled sections).
All values below are estimates derived from rendered output / computed styles.
No reference source code, CSS, images, text or assets were copied.

## 1. Global tokens (derived)

- Page background: white `#ffffff`; content sections alternate white / warm paper.
- Body font: `"Noto Sans Tamil", sans-serif`, 16px, color `#333333`.
- Heading font: `"Noto Serif Tamil", serif`, weight 600.
  - H1 (event title): ~36px / line-height ~52px, color deep maroon `#470A00`.
  - H2 (section titles): ~28-30px serif, color `#470A00`-ish dark maroon.
- Primary maroon (CTA / accents): approx `#8B0E01` (buttons), darker shade `#470A00` (headings).
- Success green (WhatsApp / trust): approx `#1E9E4A` / `#128C4B`-family; trust band bg pale mint approx `#EAF6EF`.
- Countdown boxes: pale blush bg approx `#FDF1EC`, border `#F0D9D2`, red numerals.
- Borders: warm light gray `#E8DDD3` / `#EAD9C6`; card radius ~12-16px.
- Primary buttons: pill radius `999px`, height ~56-64px for the hero CTA, white bold text with price + divider + label.
- Header: white, height ~92px desktop, bottom hairline border; logo left, uppercase nav centre, green outline "Need Help? WhatsApp" pill right.
- Content max width: fluid with ~24-48px gutters; main column + ~360px sticky sidebar on desktop.

## 2. Header (desktop)

- Left: flame logo + wordmark (ours: keep Nava Chandi identity, flame-style SVG is generic enough to recreate simply).
- Centre nav: HOME / PUJA / PACKAGES / SAMARPANA / ACCOUNT — small uppercase sans, letter-spaced.
- Right: green outline pill with WhatsApp icon, two-line label "Need Help? / WhatsApp".
- Mobile: compact bar — back chevron + Tamil title + circular WhatsApp (green) and Call (blue) buttons.

## 3. Hero (desktop two-column, ~50/50)

Left column:
- Media card: rounded ~16px, 4:3-ish poster with mute/sound chip overlay.
- Below: 3 mini-stats in a row separated by hairlines: "3.75L+ ratings | 20.62L+ pujas conducted | 4.9/5 Average ratings".
- Two small outline pill buttons: "♡ Wishlist", "⎋ Share".
  (We will NOT copy ratings/wishlist; we show honest Nava Chandi facts: price, family size, date.)

Right column:
- Small red eyebrow line (Tamil, with ❋ ornaments).
- H1 serif Tamil event name.
- Info card: bordered rounded-12 box, two rows with icons:
  row 1 temple icon + venue short text; row 2 calendar icon + date + "Auspicious Muhurat".
- Note: "This puja includes up to **4 family members** (maroon bold) at no extra cost."
- Countdown row: left label small-caps "MUHURAT ENDS IN" + bold "Reserve your sankalp"; right 4 boxes DD/HRS/MIN/SEC with colons between.
- Primary CTA: full-width dark-red pill, "₹801 | Book Now" (~60px tall).
- Two secondary outline pills side-by-side: "Book via WhatsApp" (green) / "Book via Call" (blue).
- Assurance grid: 4 mini items (icon + 2-line Tamil) on pale mint rounded card.

Mobile hero: media first (full-bleed rounded), title, info card, family note, countdown boxes (4 fit), CTA; sticky bottom bar appears (dark red, price left + white "Book Now" pill right).

## 4. Trust strip

- Full-width pale-mint band repeating the 4 assurances with icons (video proof, experienced pandits, holy temples, pure Vedic method).

## 5. Sticky section navigation

- Sticky under header, white with hairline border, horizontally scrollable on mobile.
- Tabs: About, Recommendations, Benefits, Process, Temple, Inclusions, FAQ, Gallery.
- Active tab: maroon text + short maroon underline indicator.

## 6. Content body (desktop: main ~2fr + sidebar ~1fr sticky)

- About: paragraph (clamped + "Read More" toggle) + meta strip: 3 cells (TRADITION/Vedic | DURATION/~2h | FOR/Family of 4) in bordered rounded box.
- Recommendations: horizontal scroll-snap cards (image top, 2-line title clamp, venue small, price + small red "Book Now" pill). (We have no other events; we OMIT this, or reuse gallery — decision: omit, do not fabricate.)
- Benefits: 2-col grid cards; red rounded-square icon + bold title + body; radius ~12, light border.
- Process: vertical timeline — maroon outline numbered circles (01..06) joined by hairline; cards right with title + body; one step flagged "✦ The Core Ritual".
- Temple details: H3 + city; gallery thumbs (4, rounded, lightbox-ish).
- Inclusions: numbered "01" + paragraph.
- FAQ: accordion rows with plus icons, bordered, first open.
- Sidebar cards: "Included with this Puja / NO HIDDEN CHARGES" checklist card; "Unsure which ritual to book?" advisor card with green "WhatsApp Expert" + outline "Mail us" + "Advisors online · 8 AM – 11 PM IST" caption.

## 7. Footer

- Dark maroon CTA band (headline + sub + "Find the Right Puja" button + secure/video/pandit ticks).
- Cream footer: brand col + Quick Links + Legal + Contact cols; bottom copyright hairline.

## 8. Mobile behaviour (390px)

- Single column; section nav scrolls horizontally, sticky.
- Countdown boxes shrink to fit (4 × ~72px + colons).
- Bottom sticky CTA bar: safe-area padding, hides near registration form & footer (avoid overlap).
- Tap targets ≥ 44px; Tamil never clipped; no horizontal overflow (recommendation rail scrolls internally).

## 9. Motion

- Smooth anchor scroll; accordion height transition; tab indicator; subtle hover lift on cards/buttons; `prefers-reduced-motion` respected.

## 10. Design tokens adopted for our rebuild (equivalent, original values)

```
--bg: #FFFDF8 (warm ivory)      --surface: #FFFFFF
--ink: #2D1A12 (dark readable)  --muted: #6B5B52
--maroon: #8B1E0F (primary)     --maroon-deep: #4A0E06 (headings/footer)
--gold: #B47718 (restrained accent)
--mint: #EAF5EE (trust band)    --blush: #FDF0E9 (countdown boxes)
--line: #EBDCC8 (borders)       --radius: 14px cards / 999px pills
--font-body: "Noto Sans Tamil"   --font-display: "Noto Serif Tamil"
--content-max: 1200px; gutters 20px mobile / 28px desktop
```
