---
version: 1
slug: "web-index-html"
primary_target: "web/index.html"
related_targets: ["web/dev.html","web/player-dev.html"]
---

# Couch TV app (all screens + player)

Scope: every screen of the Tizen app (Home, Movies, Series, My List, Live TV, Search, Details, Settings,
dialogs, loaders) and the full-screen Player. Mode: Operate. One household, sofa, remote only, lights low.

## Direction contract

THESIS: Couch TV behaves and looks like the Apple TV app on tvOS: a tab bar across the top instead of a
left rail, content-first full-bleed artwork, focus as a physical lift (scale, shadow, the sliding glass
sheen), and the Apple TV player. It refuses the generic "streaming dashboard" look: side rail, white
rings drawn on each card, uppercase eyebrows, boxed panels. Card focus is the user-approved sliding glass
(a light rim plus sheen), one layer that moves, not a ring per card.

OWN-WORLD: black ground with artwork bleeding to the edges; tvOS dark materials faked as translucent
white fills (no blur on this TV): 12-16% white for controls, near-opaque #1c1c1e/#2c2c2e for sheets.
Focus = white fill with black text for buttons, tabs and rows, lifted 1.06-1.1 with a soft offset shadow;
artwork focus = the sliding glass sheen. Inter, tvOS type ramp (76/57/48/38 titles, 29-31 body), sentence
case, no tracking-heavy caps. Continuous-looking corners: 12 cards, 16 buttons, 32-40 sheets, capsules for
tabs. Motion: tvOS spring on focus, ease-out slides, nothing but transform/opacity.

STORY: open the app, see the tab bar and a big backdrop of what's focused, move down into rows; every
focus move feels like lifting a card on Apple TV; Play starts video, and the player is the Apple TV
player with the same glass moving across its controls and menus.

FIRST VIEWPORT: Home. Top 40-112px: wordmark left, capsule tab bar centred (Search icon, Home, Movies,
Series, Live TV, My List, Settings icon). Backdrop of the focused title fills the top-right two-thirds;
title (logo or 76px bold), meta and 3-line description at left from y 170. Focused row heading at y 560,
cards beneath with the glass on the focused card. Primary action: OK on a card (Play key plays).

FORM: user-pinned canon: Apple TV app (tvOS), chosen by the user 2026-10-26; no concept roll (a pinned
direction beats the roll). Reference product to sit alongside: Apple TV app on tvOS 17. Seed key: none.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Launcher restyle to match follows in a separate pass (user: "Launcher too, later").
