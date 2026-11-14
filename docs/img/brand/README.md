# TraceHarness brand

The mark is an **H drawn as five ledger rows**. The posts are log entries; the middle row, the
crossbar, is the measured one and the only colored element. TraceHarness records every action of a
coding agent in a ledger and lets you follow one number down to the row behind it: the mark is that
idea, nothing more.

| File | Use |
|---|---|
| `lockup-light.svg` / `lockup-dark.svg` | mark + wordmark on light / dark backgrounds (transparent) |
| `mark-light.svg` / `mark-dark.svg` | the mark alone |
| `mark-mono.svg` | one color (`currentColor`), for print and embossing |
| `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png` | browser tab and home-screen icons |
| `app-icon.svg`, `icon-512.png` | avatar, app icon |
| `social-preview.svg` / `.png` | 1280 × 640 card (GitHub repository settings → Social preview) |

## Construction

- 64-unit grid. Five rows of height 8 on an 11-unit pitch (rows at y = 6, 17, 28, 39, 50).
- Posts 16 wide at x = 7 and x = 41; the crossbar spans x = 7 to 57. Corner radius 2 everywhere.
- Keep clear space of one row height (8 units at mark scale) on every side of the mark.
- Do not recolor the posts, add effects, or set the wordmark in another typeface.

## Color

| Role | Light | Dark |
|---|---|---|
| Ink (posts, wordmark) | `#0b0f14` | `#f2f4f7` |
| Measured row | `#1d6ae5` | `#3d8bff` |
| Ground | `#ffffff` | `#0b0f14` |

## Type

The wordmark is **Instrument Sans Bold**, tracked −1.8 %, converted to outlines so it renders the
same everywhere (GitHub included). Supporting text uses **IBM Plex Mono**, the console's monospace.
Both are licensed under the SIL Open Font License 1.1 (`InstrumentSans-OFL.txt`,
`IBMPlexMono-OFL.txt`).
