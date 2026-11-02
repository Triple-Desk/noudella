# Noudella Business System

Single-owner business app for Noudella (handmade candles, gifts, gypsum & concrete products):
materials, product recipes, accurate unit costing, orders & profit, purchases (weighted average),
inventory, production batches, and a public customer catalogue.

- `index.html` — the owner's app (Arabic, RTL), hosted on GitHub Pages. It talks to the Google Apps Script API.
  The connection details are **not** stored here; they come from the owner's private link
  (`#d=<deployment id>&k=<key>`) and are remembered on the device.
- `catalog/` — the public customer catalogue (`https://triple-desk.github.io/noudella/catalog/`).
  It reads only the read-only catalogue view of the API (`GET …/exec?a=catalog`, no key): names, photos,
  collections, sizes and — only when the owner turns prices on — selling prices. Never costs, stock or customers.
  Customers build an order and send it on WhatsApp; there are request forms for favours and corporate gifts,
  a price-list view (saved as an image) and an A4 print layout (`#print` opens the print dialog).
- `apps-script/` — server code (Google Apps Script). Data lives in the owner's Google Sheet.
- `test/` — `node test/run-tests.js` (engine + server on mocked Google services),
  `cd test && npm i jsdom@24 && node ui-test.js` (owner app flows) and `node catalog-test.js` (public catalogue).
