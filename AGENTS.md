# Nava Chandi Yagam Website — Visual Refactor Instructions

## Primary objective

Refactor the existing Nava Chandi Yagam website into a premium,
high-conversion Tamil spiritual/event website.

Primary visual reference:

https://vedamandir.com/tam/pooja-details/381?gad_source=1&gad_campaignid=24044674779

Existing production website:

https://navachandiyagam.online/

The reference site is a VISUAL / UX reference.

Reproduce its overall level of polish, page density, spatial rhythm,
visual hierarchy, responsive behaviour, card treatment, section composition,
CTA placement and interaction quality as closely as reasonably possible.

DO NOT blindly copy its source code.

DO NOT reuse VedaMandir:
- logo
- branding
- copyrighted text
- photographs
- videos
- icons unique to their brand
- proprietary assets
- tracking scripts
- analytics
- API endpoints
- payment integrations
- bundled JS/CSS

Our website must remain branded as Nava Chandi Yagam.

Use the existing Nava Chandi content, event information, images and
functionality wherever possible.

If a visual asset is missing, use a tasteful local placeholder or create
the required component structure without stealing the reference asset.

---

# CRITICAL WORKFLOW

Do not immediately start editing.

First inspect:
1. the entire existing repository
2. package.json and framework
3. application routes
4. styling system
5. existing assets
6. form implementation
7. backend/API integrations
8. mobile behaviour
9. build and deployment configuration

Run the current application and establish a baseline before modifying it.

Do not replace the project with a new framework unless absolutely necessary.

Preserve working functionality.

---

# REFERENCE WEBSITE INSPECTION

Use browser/Playwright tools to inspect the VedaMandir reference page.

Do not depend only on HTML text extraction.

Inspect the rendered page visually.

Capture screenshots of the reference at approximately:

Desktop:
1440x1000

Tablet:
768x1024

Mobile:
390x844

Also inspect the entire page by scrolling from top to bottom.

Study:

- overall maximum content width
- page gutters
- header dimensions
- typography hierarchy
- Tamil typography
- heading sizes
- body sizes
- font weights
- line heights
- hero layout
- image aspect ratios
- section spacing
- whitespace
- borders
- shadows
- radii
- background colours
- accent colours
- sticky/fixed elements
- CTA dimensions
- tabs
- badges
- cards
- trust indicators
- countdown treatment
- icon size and alignment
- FAQ behaviour
- gallery
- footer
- desktop/mobile differences

Use browser computed styles where useful.

Create:

docs/visual-reference.md

Record the derived design tokens and observations there.

Do not copy minified CSS from the reference website.

Derive an equivalent local design system from observation.

---

# TARGET EXPERIENCE

The redesigned Nava Chandi page should feel like a polished commercial
puja/event booking experience rather than a basic event landing page.

It should be visually close in QUALITY and STRUCTURE to the reference,
while clearly remaining Nava Chandi Yagam.

Prioritise Tamil.

Tamil rendering must look excellent.

Do not shrink Tamil text excessively.

---

# PAGE ARCHITECTURE

Adapt the existing Nava Chandi content into approximately this hierarchy:

1. Header
2. Hero / event identity
3. Trust/social-proof strip
4. Main event information
5. Date / venue / price information
6. Countdown if the repository contains a valid event date
7. Primary registration CTA
8. Quick assurance / feature cards
9. Sticky section navigation
10. About Nava Chandi Yagam
11. Key event metadata
12. Benefits / reasons to participate
13. Yagam / ceremony process
14. Venue section
15. What participants receive / what is included
16. Registration section
17. FAQ
18. Gallery if appropriate assets exist
19. Final conversion CTA
20. Footer

Do NOT invent religious claims or logistical promises that are not present
in our source material.

If information required for a section does not exist, simplify that section
rather than fabricate facts.

---

# HERO

The hero is the most important area.

Create a premium, dense but readable hero inspired by the reference.

It should communicate immediately:

நவசண்டி யாகம்

A concise supporting Tamil sentence.

Event date.

Venue.

Participation price:
₹1,000

Primary CTA:
பங்கேற்க பதிவு செய்யவும்

Secondary CTA where appropriate.

Family participation information currently available on our website should
be presented prominently.

Use the existing Nava Chandi photography/assets where available.

The layout should be beautiful on both desktop and mobile.

---

# DESIGN LANGUAGE

Aim for a sacred/premium visual language:

warm ivory / cream backgrounds
deep spiritual red / maroon accents
restrained saffron / gold accents
dark readable text
subtle borders
soft shadows
generous but not excessive whitespace

Avoid:
- neon colours
- generic SaaS blue
- huge gradients
- glassmorphism everywhere
- excessive animation
- enormous text
- excessive rounded cards
- generic AI-generated dashboard appearance

The reference website should guide the actual choices.

Create reusable design tokens.

Do not scatter arbitrary hex values throughout components.

---

# CARDS

Reference the VedaMandir visual rhythm.

Cards should use:
- consistent radius
- subtle border
- subtle shadow when appropriate
- carefully aligned iconography
- compact mobile padding
- comfortable desktop padding

Cards should feel connected to one design system.

---

# SECTION NAVIGATION

Create a compact sticky horizontal section-navigation control similar in
behaviour to the reference.

Example labels based on content:

யாகம் பற்றி
பலன்கள்
நிகழ்வு
யாக முறை
இடம்
பதிவு
கேள்விகள்

On mobile it may horizontally scroll.

Clicking a tab should smoothly move to its section.

Active-section indication should update while scrolling if this can be
implemented cleanly.

---

# EVENT PROCESS

Turn appropriate ceremony/process information into a polished numbered
timeline/process section similar in visual sophistication to the reference.

Use:

01
02
03
...

with strong typographic hierarchy.

Do not fabricate steps if our existing content does not define them.

---

# REGISTRATION

The existing registration functionality is CRITICAL.

Do not break it.

Existing fields currently include information such as:

- primary participant name
- mobile
- email
- gothram
- rasi
- nakshatram
- address
- family-member information where implemented

Inspect the source and preserve the real behaviour.

Restyle the form heavily so it fits the new design.

Provide:
- proper labels
- focus states
- error states
- loading state
- success state
- mobile-friendly form controls
- accessible controls
- sensible grouping

Do not modify server/API contracts unless necessary.

---

# RESPONSIVE DESIGN

Mobile quality is critical.

Explicitly verify at:

390px
430px
768px
1024px
1440px

There must be:

no horizontal overflow
no clipped Tamil text
no overlapping fixed CTA
no broken menus
no tiny tap targets
no layout jumping
no unusable select controls

The mobile page should NOT merely be the desktop page stacked vertically.

Match the reference site's compact mobile rhythm.

---

# STICKY CTA

Create a tasteful mobile sticky registration CTA inspired by the reference.

It should show enough context to identify the event and provide a prominent
registration action.

It must:
- respect safe-area insets
- not obscure form controls
- not cover footer content
- behave correctly on small displays

---

# MOTION

Motion should be subtle.

Allowed examples:
- smooth anchor scrolling
- accordion transition
- tab indicator movement
- subtle hover feedback
- button press feedback
- restrained reveal animation

Respect prefers-reduced-motion.

Do not turn the site into an animation showcase.

---

# PERFORMANCE

Do not damage performance to achieve visual similarity.

Optimise images.

Avoid unnecessary JS.

Avoid unnecessary dependencies.

Lazy-load appropriate below-the-fold assets.

Prevent layout shift.

---

# ACCESSIBILITY

Maintain:
- semantic headings
- accessible labels
- keyboard navigation
- visible focus states
- adequate contrast
- meaningful alt text
- buttons instead of clickable divs where appropriate

---

# VISUAL ITERATION IS MANDATORY

After implementation:

1. Run the target locally.
2. Screenshot target at the same viewport as reference.
3. Compare reference and target visually.
4. Identify the largest discrepancies.
5. Fix them.
6. Screenshot again.
7. Repeat.

Perform at least THREE deliberate visual refinement passes.

Do not claim completion immediately after the first implementation.

Pay particular attention to:

- width
- padding
- vertical spacing
- font scale
- hero proportions
- card dimensions
- button dimensions
- border radius
- shadows
- mobile density
- sticky elements

---

# QUALITY BAR

I do not want an approximate AI redesign.

I want a carefully measured recreation of the reference site's visual
language adapted to Nava Chandi Yagam.

When deciding between:
"this looks okay"
and
"this more closely matches the reference"

choose the latter.

Do not stop at 60-70% similarity.

Continue refining obvious differences.

---

# FUNCTIONAL REGRESSION TEST

Before finishing verify:

- site loads
- navigation works
- mobile menu works
- all anchor links work
- form works
- selects work
- validation works
- submission works
- external map link works
- responsive layout works
- no console errors
- production build succeeds

Run lint/typecheck/tests/build according to the repository's tooling.

Do not remove functionality merely because it complicates the redesign.

---

# GIT SAFETY

Before modifying the repository inspect git status.

Do not delete unrelated files.

Do not overwrite environment secrets.

Do not expose .env values.

Do not commit unless explicitly requested.

---

# COMPLETION REPORT

At completion report:

- files changed
- components added
- design system changes
- reference elements reproduced
- functionality preserved
- responsive viewports tested
- commands/tests executed
- remaining visual differences