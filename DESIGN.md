---
name: Couch TV
description: A household streaming app for one Samsung TV that looks and behaves like the Apple TV app on tvOS.
colors:
  focus-white: "#ffffff"
  ground: "#000000"
  sheet: "#1c1c1e"
  sheet-raised: "#2c2c2e"
  label-secondary: "rgba(235,235,245,.85)"
  label-muted: "rgba(235,235,245,.62)"
  wordmark-dim: "rgba(255,255,255,.5)"
  fill-quiet: "rgba(255,255,255,.07)"
  fill: "rgba(255,255,255,.14)"
  fill-strong: "rgba(255,255,255,.2)"
  on-focus-muted: "rgba(0,0,0,.6)"
  status-green: "#30d158"
  status-green-on-white: "#1f8f3c"
  status-red: "#ff453a"
  status-red-on-white: "#d70015"
  caret-blue: "#0a84ff"
typography:
  display:
    fontFamily: "Inter, Arial, Helvetica, sans-serif"
    fontSize: "76px"
    fontWeight: 700
    lineHeight: 1.04
    letterSpacing: "-1.5px"
  headline:
    fontFamily: "Inter, Arial, Helvetica, sans-serif"
    fontSize: "57px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-.5px"
  headline-sm:
    fontFamily: "Inter, Arial, Helvetica, sans-serif"
    fontSize: "48px"
    fontWeight: 700
    letterSpacing: "-.3px"
  title-lg:
    fontFamily: "Inter, Arial, Helvetica, sans-serif"
    fontSize: "38px"
    fontWeight: 700
    letterSpacing: "-.3px"
  title:
    fontFamily: "Inter, Arial, Helvetica, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    letterSpacing: "-.3px"
  body-lg:
    fontFamily: "Inter, Arial, Helvetica, sans-serif"
    fontSize: "31px"
    fontWeight: 500
    lineHeight: 1.35
  body:
    fontFamily: "Inter, Arial, Helvetica, sans-serif"
    fontSize: "29px"
    fontWeight: 400
    lineHeight: 1.42
  label:
    fontFamily: "Inter, Arial, Helvetica, sans-serif"
    fontSize: "26px"
    fontWeight: 500
    lineHeight: 1.18
  caption:
    fontFamily: "Inter, Arial, Helvetica, sans-serif"
    fontSize: "24px"
    fontWeight: 500
rounded:
  card: "12px"
  control: "16px"
  chip: "24px"
  capsule: "32px"
  sheet: "40px"
  round: "50%"
spacing:
  safe-x: "90px"
  player-x: "96px"
  bar-top: "40px"
  content-top: "150px"
  row-gap: "34px"
  card-gap: "46px"
  control-gap: "20px"
  list-gap: "8px"
components:
  tab:
    textColor: "{colors.label-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.capsule}"
    padding: "0 30px"
    height: "64px"
  tab-current:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.focus-white}"
  tab-focused:
    backgroundColor: "{colors.focus-white}"
    textColor: "{colors.ground}"
  button:
    backgroundColor: "{colors.fill-strong}"
    textColor: "{colors.focus-white}"
    rounded: "{rounded.control}"
    padding: "0 34px"
    height: "80px"
  button-focused:
    backgroundColor: "{colors.focus-white}"
    textColor: "{colors.ground}"
  list-row:
    backgroundColor: "{colors.fill-quiet}"
    textColor: "{colors.focus-white}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.control}"
    padding: "16px 30px"
    height: "92px"
  list-row-focused:
    backgroundColor: "{colors.focus-white}"
    textColor: "{colors.ground}"
  card-art:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.card}"
    width: "292px"
    height: "164px"
  card-art-wide:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.card}"
    width: "480px"
    height: "270px"
  chip:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.label-secondary}"
    typography: "{typography.caption}"
    rounded: "{rounded.chip}"
    padding: "8px 18px"
  search-field:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.focus-white}"
    typography: "{typography.title-lg}"
    rounded: "{rounded.control}"
    padding: "0 30px"
    height: "96px"
  sheet:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.focus-white}"
    rounded: "{rounded.sheet}"
    width: "780px"
  toast:
    backgroundColor: "{colors.sheet-raised}"
    textColor: "{colors.focus-white}"
    rounded: "{rounded.sheet}"
    padding: "20px 38px"
  player-control:
    backgroundColor: "rgba(255,255,255,.16)"
    textColor: "{colors.focus-white}"
    rounded: "{rounded.round}"
    size: "80px"
---

# Design System: Couch TV

## Overview

**Creative North Star: "The Lifted Card"**

Couch TV is the Apple TV app on tvOS, rebuilt for a 2021 Samsung TV that cannot blur. The world is black, and the artwork is the colour: the focused title's backdrop bleeds in from the top right behind a black shade, rows of art-only cards run off the right edge, and everything else is white type and translucent white fills. Chrome is a capsule tab bar centred across the top that tucks away as you move down and returns when focused.

Focus is the whole personality. It is physical: a tab, button or row turns solid white with black text and lifts on a spring with a soft shadow beneath it; artwork never gets a white fill or a ring of its own but receives one sliding glass layer (a light rim plus a diagonal sheen) that travels from card to card. The same glass moves across the player's round controls and its menu rows, so the player feels like the same world. Density is tvOS-low: few, large things, legible from 3 m, sentence case throughout.

The platform shapes the look as much as the reference does. Chromium 76 has no `backdrop-filter`, and a large repaint costs about 1.3 s per frame on this TV, so tvOS "materials" are faked with translucent white over black and near-opaque greys for sheets, and only transform and opacity ever animate. The user rejected the earlier left-rail look and the generic streaming dashboard: no side rail, no per-card rings, no uppercase eyebrows, no boxed panels.

**Key Characteristics:**
- Black ground; artwork is the only colour on a browse screen.
- Capsule tab bar across the top, not a side rail.
- Focus = white fill, black text, 1.08 spring lift, soft shadow; artwork focus = the sliding glass.
- Inter in a tvOS ramp, bold tight titles, sentence case, no tracked caps.
- Continuous-looking corners scaled to the object: 12 cards, 16 controls, 32 capsules, 40 sheets.
- Transform and opacity are the only animated properties.

## Colors

A monochrome tvOS dark palette: black, white and translucent white, with iOS system colours reserved for status and the text caret.

### Primary
- **Focus White** (focus-white): the focus colour, not a decoration. It fills whatever control holds focus (tab, button, row, key, alert action), fills progress bars and the scrub head, and is the default text colour. Its job is to be the one obvious thing on screen.

### Secondary
- **System Green** (status-green): the On state of iOS switches and "connected" status values in Settings.
- **System Red** (status-red): "down" status values and the Live badge in the player.
- **Deep Green / Deep Red on White** (status-green-on-white, status-red-on-white): the same statuses when their row is focused and turns white; the bright versions fail on a white fill.

### Tertiary
- **Caret Blue** (caret-blue): the blinking text caret in the search field, and nothing else.

### Neutral
- **Black Ground** (ground): every screen's background, the player, the shades that fade artwork into the left and bottom edges.
- **Sheet Grey** (sheet): player menus, card placeholders and skeletons; the opaque "material" that stands in for tvOS blur.
- **Raised Grey** (sheet-raised): alert buttons, toasts, the scrub bubble, Up Next and error sheets (as 97% opaque), letterboxed channel-logo cards.
- **Secondary Label** (label-secondary): descriptions, chips, unfocused keyboard keys, unfocused menu rows.
- **Muted Label** (label-muted): meta lines, unfocused tabs, card titles, section labels, hints.
- **Quiet Fill** (fill-quiet): resting list rows (settings, episodes, menus, recent searches, wide keys).
- **Fill** (fill): the current tab, chips, the search field, retry buttons.
- **Strong Fill** (fill-strong): resting action buttons on a title's page.
- **On-Focus Muted** (on-focus-muted): secondary text inside a focused white row.
- **Wordmark Dim** (wordmark-dim): the "tv" half of the "couch tv" wordmark.

### Named Rules
**The White Is Focus Rule.** A solid white fill means "this has focus" (or is a progress fill). Never use a white fill for a resting control, a selected state or an emphasis badge at large size; the current tab is a 14% fill, not white.

**The Artwork Is The Colour Rule.** Chrome stays monochrome. Hue comes from titles' artwork and from the four system colours in their named roles; there is no brand accent.

## Typography

**Display Font:** Inter (with Arial, Helvetica, sans-serif), bundled as one variable file, weights 400 to 800.
**Body Font:** Inter, same file.

**Character:** Inter stands in for San Francisco, which cannot ship on a Samsung TV. Bold titles with slight negative tracking, medium-weight labels, regular body; the ramp follows tvOS sizes at 1080p.

### Hierarchy
- **Display** (700, 76px, 1.04): a title's name on Home's cover and on its details page, and the paused player's title; max two lines. A title logo replaces it when one exists.
- **Headline** (700, 57px, 1.1): alert titles, the Settings help heading, the playing title in the player.
- **Headline Small** (700, 48px): player menu sheet headings and the playback error title.
- **Title Large** (700, 38px): section titles on a title's page (Episodes, related), the search results heading, the search query text (600), the player clock (600).
- **Title** (700, 34px): row headings on Home and browse screens.
- **Body Large** (500, 31px, 1.35 to 1.4): alert body, setting labels, alert action labels (600), keyboard keys.
- **Body** (400 to 500, 29px, 1.42): descriptions, tab labels, button labels (600), the app default.
- **Label** (500, 26px): card titles, counts, time deltas, button labels in the player.
- **Caption** (500, 24px): chips, setting details, episode subtitles, menu hints. 24px is the floor.

### Named Rules
**The 24px Floor Rule.** No text renders below 24px at 1080p; that is the product's legibility minimum at 3 m.

**The Sentence Case Rule.** Every label, heading and hint is sentence case at normal tracking. Titles track slightly tighter (-0.3 to -1.5px); nothing is uppercase and letter-spaced.

## Layout

A fixed 1920x1080 canvas, no breakpoints. Content sits inside 90px side margins (the player uses 96px). The tab bar occupies the top band: capsules start 40px down, centred, with the wordmark at the left; browse content starts at 150px. On Home, the focused title's backdrop fills the top-right 1500x844 area under a left and bottom black shade, the title block sits at the left from 168px, and rows begin roughly halfway down.

Rows are horizontal tracks that scroll by transform, running off the right edge; rows scrolled above the viewport fade out. Grids are fixed column counts (five 292px columns on browse screens, four 232px columns in search). Settings is a two-pane split: a large explanation of the focused setting on the left (690px), the list on the right (960px). Search is the same split: field and keyboard left (640px), results right. Player menus are a 780px sheet floating 64px from the right edge.

**The Room To Lift Rule.** Every scrolling viewport leaves margin around its cards for a 1.08 scale and its shadow; nothing focusable sits flush against a clipping edge.

## Elevation & Depth

Depth is focus-driven. Resting surfaces are flat translucent fills or opaque greys with no shadow; a focused element gains a soft, large, downward shadow as it lifts, and floating sheets (menus, toasts, Up Next, the scrub bubble) carry a deep ambient shadow because they sit over moving video or artwork. Black linear gradients do the rest: they fade artwork into the ground and keep the tab bar and player text legible.

### Shadow Vocabulary
- **Lift** (`box-shadow: 0 18px 40px rgba(0,0,0,.5)`): a focused button, row or alert action.
- **Tab lift** (`box-shadow: 0 12px 28px rgba(0,0,0,.45)`): a focused capsule tab.
- **Glass** (`box-shadow: 0 24px 60px rgba(0,0,0,.55)`): under the sliding glass on artwork (0 18px 44px in the player).
- **Floating sheet** (`box-shadow: 0 30px 90px rgba(0,0,0,.6)`): player menu sheet; 0 14px 34px for toasts, bubbles and messages.

### Named Rules
**The No Blur Material Rule.** There is no `backdrop-filter` on this TV. tvOS materials are faked: 7 to 20% white fills for controls, 97% opaque greys for sheets. A static, already-blurred backdrop on its own layer (a title page's soft hero) is allowed; live blur behind moving content is not.

**The Shadow Means Lifted Rule.** A shadow appears only on something focused or floating over video. Resting cards and rows have none.

## Shapes

Continuous-looking rounded rectangles sized to the object: 12px on artwork, keyboard keys and recent-search pills; 16px on buttons, list rows, the search field and alert actions; 24px on chips; 32px capsules for tabs and the Up Next card; 40px on menu sheets, toasts and messages; full circles for player controls, the scrub head and switch knobs. Borders are almost absent: the only strokes are the glass's 2px 60% white rim and thin outlined rating/CC badges. The glass is created at each artwork size with the artwork's own radius and only ever scaled, so its corners always match the card.

## Components

### Buttons
Translucent at rest, solid white when chosen.
- **Shape:** gently rounded (16px), 80px tall, min 190px wide (Play 240px), optional 32px icon left of the label.
- **Rest:** strong fill, white 29px semibold label.
- **Focus:** white fill, black label, lift shadow, scale 1.08 on the focus spring.
- **Alert actions:** 600x86px stacked and centred under a box-less alert (centred text over an 80% black shade), raised grey at rest, same white focus.

### Chips
- **Style:** fill, secondary label, 24px medium, 24px radius; genre and fact tags on a title's page. Not focusable.

### Cards
Art-only on Home, art plus muted title on browse screens.
- **Corner Style:** 12px on the artwork.
- **Background:** sheet grey placeholder; a grey gradient fallback with the title when artwork is missing.
- **Shadow Strategy:** none at rest; the sliding glass carries the shadow on focus.
- **Focus:** the card scales 1.08; the glass slides onto it; its title turns white. No ring is drawn on the card itself.
- **Overlays:** a title logo or a 24px semibold caption over a bottom black gradient; a 6px white progress bar along the bottom edge for resume.

### Inputs / Fields
- **Search field:** 96px tall fill with 16px radius, 38px semibold query (muted when empty), caret-blue blinking caret.
- **Keyboard:** borderless letter keys (secondary label), wide keys on quiet fill, 12px radius. Focus is a colour swap to white with black text, no scale, so moving across keys repaints only the key.
- **Switch:** iOS switch, 78x46, grey track at rest, status green when on, white knob that slides on the spring.

### Navigation
- **Tab bar:** capsule tabs (32px radius, 64px tall) centred across the top over a black-to-clear gradient; Search and Settings are icon-only capsules. Rest: muted label, no fill. Current screen: 14% fill, white label. Focus: white fill, black label, 1.08 lift with the tab shadow. The bar tucks up and fades while a screen is scrolled down or a page is pushed, and always returns when focused.
- **In-page tabs:** the same capsule language at 28px (seasons, browse filters).

### List Rows
- **Style:** quiet fill, 16px radius, 92px min height (episodes 112px), label left, value or chevron right.
- **Focus:** white fill, black text, secondary text drops to on-focus-muted, lift shadow. Settings rows do not scale (cheap on the TV); episode rows scale 1.03.

### The Sliding Glass (signature)
One layer per artwork size, positioned and sized only with `transform`, that moves between focused artworks: a 2px 60% white rim, a 150-degree white sheen fading out by 55%, a deep shadow, moving on the focus spring (280ms). Moving focus repaints nothing. The player reuses it on its round controls (80px circle) and its menu rows (18px radius).

### Player
Title low at the left above a 1400px scrubber over a bottom black gradient; round 80px translucent controls (16% white) whose label appears below the focused one; clock top right. Scrubbing shows a raised grey bubble with time and delta above a white head. Menus are a sheet-grey panel on the right that slides in 40px. Pausing shows a left-weighted black gradient with the 76px title, description, progress and a white key hint. Up Next is a raised grey 32px card at the bottom right with a white Play button and a countdown bar.

### Motion
- **Focus spring** (`cubic-bezier(.2,1.15,.4,1)`, 220 to 280ms): every lift, the glass, switch knobs, the scrub head.
- **Slide ease** (`cubic-bezier(.22,1,.36,1)`, 260 to 420ms): row and page scrolling, the tab bar tucking, sheets, cover crossfades, screen fade-in.
- **Fades** (`ease-out`, 150 to 220ms): opacity changes.
- Settings > Remove animations and `prefers-reduced-motion` stop every transition and animation except loading indicators.

## Do's and Don'ts

### Do:
- **Do** show focus as a white fill with black text and a 1.08 spring lift on tabs, buttons and rows, and as the sliding glass on artwork and player controls.
- **Do** fake materials with translucent white over black (7%, 14%, 20%) and 97% opaque greys for floating sheets.
- **Do** animate only `transform` and `opacity`; size the glass and progress bars with `scale()`, never width or height.
- **Do** let a title's artwork bleed in from the top right under black shades, and use its logo in place of the display title when available.
- **Do** keep every text at 24px or larger, sentence case, on the Inter ramp.
- **Do** use iOS green and red only for On and status values, with the deep variants on a focused white row.

### Don't:
- **Don't** use a left or side navigation rail; navigation is the capsule tab bar across the top.
- **Don't** draw a ring or border on each focused card; one glass layer slides between them.
- **Don't** use uppercase, letter-spaced eyebrows or kickers above titles.
- **Don't** box content in bordered panels; group with fills, spacing and sheets.
- **Don't** use `backdrop-filter` or animate a large area's paint (blur, gradients, width, height); a large repaint costs about 1.3 s on this TV.
- **Don't** fill a resting or merely selected element with solid white; white is reserved for focus.
