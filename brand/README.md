# Noudella brand files

Vector rebuild of the owner's gold medallion logo (paths only, no fonts needed), for print and the website.

- `noudella-medallion-*.svg` — full medallion (outer ring, mark, NOUDELLA)
- `noudella-logo-*.svg` — mark + NOUDELLA, no outer ring
- `noudella-mark-*.svg` — mark only (rings, flame, N)
- `noudella-wordmark-*.svg` — NOUDELLA only
- Colours: `gold` #C8944A · `burgundy` #6D1833 · `ink` #30272B · `white` (foil / stamp / dark grounds)
- `*-gold.png` — 2048 px exports
- `qr-catalog-*.svg` → https://triple-desk.github.io/noudella/catalog/ · `qr-whatsapp-*.svg` → https://wa.me/201141151032

Brand colours: burgundy #6D1833 (screens, social), deep wine #5A0C18 (print backgrounds), gold #C8944A,
bronze #9C724E (gold-coloured text on ivory), ivory #FCEFDC, off-white #FAF8F6, ink #30272B.
Fonts: Amiri (Arabic headings), IBM Plex Sans Arabic (Arabic text), Cormorant Garamond (Latin), Pinyon Script (accent).
Minimum logo size: 15 mm.

## Print kit (2026-11-02)
- Design canvas «تصميمات نوديلا» (print page) — real sizes with 3 mm bleed; export from the canvas (Share › Export).
- `illustrations/sprig-*-{ivory,wine}.svg` — original botanical sprigs (bronze stems, olive-gold leaves, burgundy berries): corner, side, pair, tiny; `sprig.py` / `build_sprigs.py` regenerate them.
- `illustrations/pack-*.svg` — packaging-guide line illustrations (wrap, box, gift set, clear bag); `illus.py` regenerates them.
- `qr-*-paper.svg` — QR codes on the ivory print ground.
- `previews/print-kit-overview.jpg`, `previews/print-kit-contact-sheet.jpg` — previews of the whole print set.
- Print family rules: grounds ivory #FBF4E8 and wine #5A0C18; sprig stem #9C724E, leaves #E6CDA4 / #D2A66B, berries #6D1833 / #8A242A; internal pieces (shipping label, order prep card) white A6, 4 per A4; cut shapes: round 4/8 cm, seal & fragile 2 mm rounded rectangles, tags with 7 mm clipped corners and a 4 mm hole.

## Event kit (2026-11-26)
- Design canvas «تصميمات نوديلا», page «المعرض» (first page): roll-up 85 × 200 cm, table front drop 50 × 70 cm, framed name sign A5,
  price list A4, price tents (6 per A4, folded), QR sign A5, favours sign A5, stick tag 4 × 4 cm front/back, round bouquet tag 5 cm
  front/back, flyer A5 two sides, booking form A5, print-shop guide A4 (sizes, stock, finish, quantities).
- Burgundy #6D1833 is the major colour on every print ground now (the older wine #5A0C18 grounds were moved to it); gold #C8944A
  lines and ivory #FBF4E8 paper; fonts unchanged (Amiri, IBM Plex Sans Arabic, Cormorant Garamond, Pinyon Script).
- `illustrations/gerbera-*.svg` — original gerbera (daisy) line art from the owner's tag reference: corner cluster, spray, single,
  head; `-ivory` = burgundy lines on ivory, `-burgundy` = gold lines on burgundy. `gerbera.py out/` regenerates them.
- Prices on the price list and tents come from the live catalogue of 2026-11-26 (names spelled for print).
- `previews/event-kit-overview.jpg` — the whole event kit at a glance.
