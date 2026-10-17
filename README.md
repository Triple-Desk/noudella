# Noudella Business System

Single-owner business app for Noudella (handmade candles, gifts, gypsum & concrete products):
materials, product recipes, accurate unit costing, orders & profit, purchases (weighted average),
inventory, production batches.

- `index.html` — the app (Arabic, RTL), hosted on GitHub Pages. It talks to the Google Apps Script API.
  The connection details are **not** stored here; they come from the owner's private link
  (`#d=<deployment id>&k=<key>`) and are remembered on the device.
- `apps-script/` — server code (Google Apps Script). Data lives in the owner's Google Sheet.
- `test/` — `node test/run-tests.js` (engine + server on mocked Google services) and
  `cd test && npm i jsdom@24 && node ui-test.js` (interface flows).
