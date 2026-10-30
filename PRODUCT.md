# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
One household, on the sofa about 3 m from a 55" Samsung TV (UA55AU7700, 2021), using only the TV remote.
Personal app: not published, not shared with other households, no store listing.

## Product Purpose
Couch TV is the household's own streaming app: browse films and series (TMDB catalog), play them through
the stream providers and the TV's own torrent service, keep Continue Watching and My List, and watch live
sports channels. Success is picking something and having it play with as few remote presses as possible,
and the app feeling as finished as the TV apps it sits next to.

## Positioning
A self-built, single-household app that plays from its own sources (LAN relay, on-TV torrent service, public
IPTV) instead of a subscription catalog, while looking and behaving like a first-party TV app.

## Operating Context
- Remote only: arrows, OK, Back, media keys (Play/Pause, Rewind, Fast-forward, Stop), digits.
- Launched from the household's own Home launcher (`~/tv-shinnagans/launcher`), which shows a
  "Continue in Couch TV" row and can open Couch TV on a title, a resume, or My List.
- Viewing in a living room, usually evening, lights low.

## Capabilities and Constraints
- Tizen 6.0 web app, Chromium 76, fixed 1920×1080 viewport, ~1.1 GB RAM TV CPU. Rules in CONTRACT.md:
  ES2019 only; no flex `gap`, `inset`, `aspect-ratio`, `:is()`, `backdrop-filter` (no real blur).
- Measured on this TV: repainting a large layer costs ~1.3 s per frame, animating width/height ~220 ms.
  Only `transform` and `opacity` animate; no per-frame JS.
- Screens: Home, Movies, Series, My List, Sports, Search, Details, Settings, and the full-screen Player
  (scrubbing, subtitles, quality, episodes, Up Next).
- Plain `<script>` files, one global each, no frameworks or bundler; fonts are bundled, nothing loads from
  the network except data and artwork.

## Brand Commitments
- Name and wordmark: lowercase "couch tv", with "tv" at 50% white.
- Feel: the Apple TV app on tvOS (structure, focus behaviour, player), chosen by the user 2026-10-26.
- Typeface: Inter (the open face closest to San Francisco, which cannot be bundled on a Samsung TV).
- The translucent glass focus highlight that slides between cards (shell.js `.focus-glass`) stays; the user
  likes it and wants it in the player too.
- The Home launcher will be restyled to match in a later pass; until then the two apps may differ.

## Evidence on Hand
- Real catalog artwork, titles and descriptions come from TMDB at runtime; the desktop preview (`web/dev.html`)
  uses mock data from `web/js/dev/mock-data.js`.
- No reviews, ratings sources beyond TMDB's, or press exist; none should be invented.

## Product Principles
- One obvious focus at all times, legible from 3 m.
- Playing beats browsing: the Play key and Continue Watching start video in one press.
- Native-feeling over novel: behave the way a TV owner already expects a first-party app to behave.
- Never trade responsiveness on the TV for decoration.

## Accessibility & Inclusion
Minimum text 24 px at 1080p; Settings › Remove animations must stop all motion except loading indicators.
