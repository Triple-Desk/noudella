const assert = require('assert');
const { makeEnv } = require('./gas-mock');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); }
}
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(Number(a) - Number(b)) < eps, (msg || '') + ` expected ${b} got ${a}`);

const G = makeEnv();
let rq = 0;
function api(action, payload, requestId) {
  const body = JSON.stringify({ k: G._props.API_KEY, action, payload, requestId: requestId || ('r' + (++rq)) });
  return JSON.parse(G.doPost({ postData: { contents: body } }).getContent());
}
function ok(action, payload, rid) {
  const r = api(action, payload, rid);
  if (!r.ok) throw new Error(action + ' failed: ' + r.error + (r.details ? ' ' + JSON.stringify(r.details) : ''));
  return r;
}
const byName = (list, n) => list.find(x => x.name === n);

console.log('\nEngine');
t('unit conversion', () => {
  near(G.toBase_(1, 'kg', 'g'), 1000); near(G.toBase_(0.25, 'm', 'cm'), 25); near(G.toBase_(2, 'l', 'ml'), 2000);
  near(G.toBase_(1, 'dozen', 'pcs'), 12); near(G.toBase_(5, 'mm', 'cm'), 0.5);
  assert.throws(() => G.toBase_(1, 'kg', 'cm'));
});
t('price per base unit from owner samples', () => {
  near(G.pricePerBase_(300, 1, 'kg', 'g'), 0.3);
  near(G.pricePerBase_(300, 60, 'm', 'cm'), 0.05);
  near(G.pricePerBase_(35, 10, 'ml', 'ml'), 3.5);
  assert.throws(() => G.pricePerBase_(10, 0, 'kg', 'g'));
});
t('weighted average', () => {
  near(G.weightedAvg_(0, 0.3, 2000, 700), 0.35);
  near(G.weightedAvg_(2000, 0.35, 1000, 400), 1100 / 3000);
  near(G.weightedAvg_(-5, 0.3, 1000, 400), 0.4);
});
t('order totals with zero price → margin null', () => {
  const r = G.orderTotals_([{ qty: 3, unit_price: 0, unit_cost: 10 }], [], 0, 0);
  assert.strictEqual(r.margin, null); near(r.profit, -30);
});

console.log('\nSetup & seed');
t('setup creates database, folders, seed', () => {
  const msg = G.setup();
  assert.ok(/Created database/.test(msg), msg);
  assert.ok(/Already/.test(G.setup()), 'setup must be idempotent');
  const d = ok('bootstrap').data;
  assert.strictEqual(d.settings.business_name, 'نوديلا', 'text setting kept');
  assert.strictEqual(d.materials.length, 4); assert.strictEqual(d.products.length, 4);
  const cs = byName(d.products, 'شمعة الشمعدان');
  near(cs.cost.raw, 19.5 + 1.25, 'seed candlestick raw');   // 65 g × 0.30 + 25 cm × 0.05
  near(cs.cost.total, 20.75);
  assert.strictEqual(cs.cost.margin, null, 'zero selling price → margin null');
});

let D, CS, WAX, WICK, COLOR, MOLD, BOX, JORY;
function refresh(d) { D = d; CS = byName(D.products, 'شمعة الشمعدان'); JORY = byName(D.products, 'شمعة جوري');
  WAX = byName(D.materials, 'شمع عسل'); WICK = byName(D.materials, 'فتيل قطن'); COLOR = byName(D.materials, 'لون سائل');
  MOLD = byName(D.materials, 'قالب شمعة الشمعدان'); BOX = byName(D.materials, 'علبة هدية'); }
refresh(ok('bootstrap').data);

console.log('\nCosting');
t('full recipe: raw + packaging + tool allocation + other cost (no double counting)', () => {
  refresh(ok('saveMaterial', { name: 'علبة هدية', kind: 'packaging', base_unit: 'pcs', category: 'علب',
    price: { amount: 250, qty: 100, unit: 'pcs' }, opening: { qty: 50, unit: 'pcs' } }).data);
  near(BOX.avg_cost, 2.5); near(BOX.stock, 50);
  refresh(ok('saveRecipeLine', { product_id: CS.id, material_id: COLOR.id, qty: 1, unit: 'ml' }).data);
  refresh(ok('saveRecipeLine', { product_id: CS.id, material_id: MOLD.id, qty: 1, unit: 'pcs' }).data);
  refresh(ok('saveRecipeLine', { product_id: CS.id, material_id: BOX.id, qty: 1, unit: 'pcs' }).data);
  refresh(ok('saveProduct', { id: CS.id, name: CS.name, category: 'شموع', selling_price: 80, other_cost: 5, other_cost_label: 'تشغيل' }).data);
  near(CS.cost.raw, 24.25); near(CS.cost.packaging, 2.5); near(CS.cost.tool, 2); near(CS.cost.other, 5);
  near(CS.cost.total, 33.75); near(CS.cost.profit, 46.25); near(CS.cost.margin, 0.5781);
  near(CS.cost.total, CS.cost.raw + CS.cost.packaging + CS.cost.tool + CS.cost.other);
});
t('recipe line in another unit converts (0.25 m = 25 cm)', () => {
  const line = D.recipes.find(r => r.product_id === CS.id && r.material_id === WICK.id);
  refresh(ok('saveRecipeLine', { id: line.id, product_id: CS.id, material_id: WICK.id, qty: 0.25, unit: 'm' }).data);
  near(D.recipes.find(r => r.id === line.id).qty_base, 25); near(CS.cost.total, 33.75);
});
t('incompatible unit & duplicate material rejected', () => {
  assert.ok(!api('saveRecipeLine', { product_id: CS.id, material_id: WICK.id, qty: 1, unit: 'kg' }).ok);
  assert.ok(!api('saveRecipeLine', { product_id: CS.id, material_id: WAX.id, qty: 10, unit: 'g' }).ok);
  assert.ok(!api('saveRecipeLine', { product_id: CS.id, material_id: COLOR.id, qty: 0, unit: 'ml' }).ok, 'zero qty');
  assert.ok(!api('saveRecipeLine', { product_id: CS.id, material_id: COLOR.id, qty: 'abc', unit: 'ml' }).ok, 'NaN qty');
});
t('tool without life units warns and costs 0', () => {
  refresh(ok('saveMaterial', { name: 'قالب جوري', kind: 'tool', base_unit: 'pcs', price: { amount: 150, qty: 1, unit: 'pcs' } }).data);
  const mold2 = byName(D.materials, 'قالب جوري');
  refresh(ok('saveRecipeLine', { product_id: JORY.id, material_id: WAX.id, qty: 100, unit: 'g' }).data);
  refresh(ok('saveRecipeLine', { product_id: JORY.id, material_id: mold2.id, qty: 1, unit: 'pcs' }).data);
  near(JORY.cost.tool, 0); assert.ok(JORY.cost.warnings.some(w => /مرات استخدام/.test(w)));
  refresh(ok('saveMaterial', { id: mold2.id, name: 'قالب جوري', kind: 'tool', life_units: 50 }).data);
  near(JORY.cost.tool, 3); near(JORY.cost.raw, 30);
  refresh(ok('saveProduct', { id: JORY.id, name: JORY.name, selling_price: 60 }).data);
});

console.log('\nPurchases & stock');
t('purchase in kg updates stock and weighted average', () => {
  refresh(ok('savePurchase', { material_id: WAX.id, qty: 2, unit: 'kg', total_price: 700 }).data);
  near(WAX.stock, 2000); near(WAX.avg_cost, 0.35, 'stock was 0 → new price');
  refresh(ok('savePurchase', { material_id: WAX.id, qty: 1, unit: 'kg', total_price: 400 }).data);
  near(WAX.stock, 3000); near(WAX.avg_cost, 1100 / 3000);
});
t('duplicate submission (same requestId) only counted once', () => {
  const r1 = ok('savePurchase', { material_id: WICK.id, qty: 60, unit: 'm', total_price: 300 }, 'dup-1');
  const r2 = ok('savePurchase', { material_id: WICK.id, qty: 60, unit: 'm', total_price: 300 }, 'dup-1');
  assert.ok(r2.duplicate); refresh(r2.data); near(WICK.stock, 6000);
  assert.strictEqual(D.purchases.filter(p => p.material_id === WICK.id).length, 1);
});
t('reverse purchase only when it is the last movement', () => {
  refresh(ok('savePurchase', { material_id: COLOR.id, qty: 100, unit: 'ml', total_price: 300 }).data);
  near(COLOR.avg_cost, 3); const p1 = D.purchases[0];
  refresh(ok('savePurchase', { material_id: COLOR.id, qty: 100, unit: 'ml', total_price: 400 }).data);
  near(COLOR.avg_cost, 3.5); const p2 = D.purchases[0];
  assert.ok(!api('reversePurchase', { id: p1.id }).ok, 'older purchase cannot be reversed');
  refresh(ok('reversePurchase', { id: p2.id }).data);
  near(COLOR.stock, 100); near(COLOR.avg_cost, 3);
  assert.ok(!api('reversePurchase', { id: p2.id }).ok, 'no double reversal');
});
t('waste and stock count', () => {
  refresh(ok('adjustStock', { material_id: COLOR.id, mode: 'waste', qty: 10, unit: 'ml' }).data); near(COLOR.stock, 90);
  assert.ok(!api('adjustStock', { material_id: COLOR.id, mode: 'waste', qty: 1000, unit: 'ml' }).ok);
  refresh(ok('adjustStock', { material_id: COLOR.id, mode: 'count', qty: 0.08, unit: 'l' }).data); near(COLOR.stock, 80);
  near(COLOR.avg_cost, 3, 'adjustments never change average cost');
});

console.log('\nOrders & profit');
let ORDER_ID;
t('mixed order live estimate', () => {
  const r = ok('saveOrder', { customer: 'عروسة', lines: [
    { product_id: CS.id, qty: 10, unit_price: 80 }, { product_id: JORY.id, qty: 5, unit_price: 60 }],
    extras: [{ label: 'توصيل', amount: 30 }], discount: 20, charges: 0 });
  refresh(r.data); const o = D.orders.find(x => x.id === r.result.id); ORDER_ID = o.id;
  assert.strictEqual(o.status, 'draft'); assert.ok(o.estimated);
  const csCost = CS.cost.total, joCost = JORY.cost.total;
  near(o.items_revenue, 1100); near(o.revenue, 1080);
  near(o.product_cost, Math.round((10 * csCost + 5 * joCost) * 100) / 100);
  near(o.profit, Math.round((1080 - (10 * csCost + 5 * joCost) - 30) * 100) / 100, '', 0.011);
});
let SNAP;
t('confirm blocked when ready pieces are missing (nothing changes)', () => {
  const wax0 = WAX.stock;
  const r = api('confirmOrder', { id: ORDER_ID });
  assert.ok(!r.ok); assert.strictEqual(r.code, 'PRODUCT_SHORT');
  assert.ok(r.details.some(d => d.product_id === CS.id && d.short === 10) && r.details.some(d => d.product_id === JORY.id && d.short === 5));
  refresh(ok('bootstrap').data); near(WAX.stock, wax0); assert.strictEqual(D.orders.find(x => x.id === ORDER_ID).status, 'draft');
});
t('confirm + produce: missing pieces are produced, then leave the store', () => {
  const wax0 = WAX.stock, prod0 = D.production.length;
  refresh(ok('confirmOrder', { id: ORDER_ID, produce: true }).data);
  const o = D.orders.find(x => x.id === ORDER_ID); SNAP = JSON.parse(JSON.stringify(o));
  assert.strictEqual(o.status, 'confirmed'); assert.ok(!o.estimated);
  near(WAX.stock, wax0 - 650 - 500, 'materials used for 10 + 5 pieces');
  near(CS.stock, 0); near(JORY.stock, 0); assert.strictEqual(D.production.length, prod0 + 2);
  assert.ok(D.movements.some(m => m.type === 'SALE' && m.ref_id === ORDER_ID && m.item_id === CS.id && Number(m.qty) === -10));
});
t('later price change does not touch the confirmed order', () => {
  const before = CS.cost.total;
  refresh(ok('savePurchase', { material_id: WAX.id, qty: 1, unit: 'kg', total_price: 2000 }).data); // big price jump
  assert.ok(CS.cost.total > before, 'product cost follows new average');
  const o2 = D.orders.find(x => x.id === ORDER_ID);
  near(o2.profit, SNAP.profit); near(o2.product_cost, SNAP.product_cost); near(o2.lines[0].unit_cost, SNAP.lines[0].unit_cost);
});
t('deliver keeps stock; cancel returns pieces exactly once', () => {
  assert.ok(!api('saveOrder', { id: ORDER_ID, lines: [{ product_id: CS.id, qty: 1 }] }).ok, 'confirmed cannot be edited');
  refresh(ok('setOrderStatus', { id: ORDER_ID, status: 'delivered' }).data);
  near(CS.stock, 0); near(JORY.stock, 0);
  refresh(ok('setOrderStatus', { id: ORDER_ID, status: 'cancelled' }).data);
  near(CS.stock, 10); near(JORY.stock, 5);
  assert.ok(!api('setOrderStatus', { id: ORDER_ID, status: 'cancelled' }).ok, 'no double cancel');
  refresh(ok('setOrderStatus', { id: ORDER_ID, status: 'draft' }).data);
  near(CS.stock, 10, 'reopening a cancelled order does not return twice');
});
t('material shortage blocks auto-production and keeps the draft', () => {
  const wax0 = WAX.stock, cs0 = CS.stock, n0 = D.orders.length;
  const r = ok('saveOrder', { lines: [{ product_id: CS.id, qty: 1000, unit_price: 80 }], confirm: true, produce: true });
  assert.strictEqual(r.result.code, 'MATERIAL_SHORT'); assert.ok(r.result.details.some(d => d.material_id === WAX.id));
  refresh(r.data); assert.strictEqual(D.orders.length, n0 + 1);
  assert.strictEqual(D.orders.find(x => x.id === r.result.id).status, 'draft'); near(WAX.stock, wax0); near(CS.stock, cs0);
});
t('empty order and invalid values rejected', () => {
  assert.ok(!api('saveOrder', { lines: [] }).ok);
  assert.ok(!api('saveOrder', { lines: [{ product_id: CS.id, qty: 0 }] }).ok);
  assert.ok(!api('saveOrder', { lines: [{ product_id: CS.id, qty: 1.5 }] }).ok, 'whole pieces only');
  assert.ok(!api('saveOrder', { lines: [{ product_id: CS.id, qty: 1 }], discount: -5 }).ok);
  assert.ok(!api('saveOrder', { lines: [{ product_id: 'nope', qty: 1 }] }).ok);
});
t('zero-price gift order from stock (margin null)', () => {
  const r = ok('saveOrder', { lines: [{ product_id: CS.id, qty: 2, unit_price: 0 }], confirm: true });
  assert.ok(!r.result.confirmError); refresh(r.data);
  const o = D.orders.find(x => x.id === r.result.id);
  assert.strictEqual(o.status, 'confirmed'); assert.ok(o.margin === '' || o.margin === null); assert.ok(o.profit < 0);
  near(CS.stock, 8);
});
t('reopen confirmed → draft returns pieces and gives live estimate', () => {
  const r = ok('saveOrder', { lines: [{ product_id: CS.id, qty: 1, unit_price: 80 }], confirm: true });
  refresh(r.data); near(CS.stock, 7);
  refresh(ok('setOrderStatus', { id: r.result.id, status: 'draft' }).data);
  near(CS.stock, 8);
  const o = D.orders.find(x => x.id === r.result.id); assert.ok(o.estimated); near(o.product_cost, Math.round(CS.cost.total * 100) / 100);
});

console.log('\nProduction');
t('shortage blocks production and lists materials', () => {
  const r = api('recordProduction', { product_id: CS.id, qty: 1000 });
  assert.ok(!r.ok); assert.ok(r.details && r.details.some(d => d.material_id === WAX.id));
});
let BATCH;
t('production consumes exact materials once (tools not consumed)', () => {
  refresh(ok('savePurchase', { material_id: COLOR.id, qty: 100, unit: 'ml', total_price: 350 }).data);
  const wax0 = WAX.stock, wick0 = WICK.stock, col0 = COLOR.stock, box0 = BOX.stock, mold0 = MOLD.stock, cs0 = CS.stock, n0 = D.production.length;
  refresh(ok('recordProduction', { product_id: CS.id, qty: 10 }, 'prod-1').data);
  refresh(ok('recordProduction', { product_id: CS.id, qty: 10 }, 'prod-1').data); // double click
  near(WAX.stock, wax0 - 650); near(WICK.stock, wick0 - 250); near(COLOR.stock, col0 - 10); near(BOX.stock, box0 - 10);
  near(MOLD.stock, mold0, 'mold not consumed');
  assert.strictEqual(D.production.length, n0 + 1); near(CS.stock, cs0 + 10); BATCH = D.production[0];
});
t('reverse production restores stock', () => {
  const wax0 = WAX.stock, cs0 = CS.stock;
  refresh(ok('reverseProduction', { id: BATCH.id }).data);
  near(WAX.stock, wax0 + 650); near(CS.stock, cs0 - 10);
  assert.ok(!api('reverseProduction', { id: BATCH.id }).ok);
});
t('material photo saved and served', () => {
  refresh(ok('saveMaterial', { id: WAX.id, name: WAX.name, kind: 'raw', image: { mime: 'image/jpeg', data: Buffer.from('fakejpeg').toString('base64') } }).data);
  assert.ok(WAX.image_id && /lh3\.googleusercontent\.com\/d\//.test(WAX.image_url));
  refresh(ok('saveMaterial', { id: WAX.id, name: WAX.name, kind: 'raw', removeImage: true }).data);
  assert.ok(!WAX.image_id && !WAX.image_url);
});
t('migration marks old delivered orders as already out', () => {
  const sh = G._spreadsheets[G._props.DB_ID].getSheetByName('Orders');
  const head = sh.grid[0], col = head.indexOf('stock_out'), st = head.indexOf('status');
  const row = sh.grid.findIndex((r, i) => i > 0 && r[st] === 'confirmed');
  sh.grid[row][col] = ''; sh.grid[row][st] = 'delivered';
  G.setup();
  assert.strictEqual(sh.grid[row][col], true);
});

console.log('\nSafety');
t('wrong key is refused', () => {
  const r = JSON.parse(G.doPost({ postData: { contents: JSON.stringify({ k: 'nope', action: 'bootstrap' }) } }).getContent());
  assert.strictEqual(r.ok, false); assert.strictEqual(r.auth, false); assert.ok(!r.data);
  const r2 = JSON.parse(G.doPost({ postData: { contents: 'garbage' } }).getContent()); assert.strictEqual(r2.ok, false);
  assert.strictEqual(typeof G.apiCall, 'undefined', 'no public apiCall');
});
t('formula injection neutralised', () => {
  ok('saveProduct', { name: '=IMPORTXML("http://x")', selling_price: 1 });
  const sh = G._spreadsheets[G._props.DB_ID].getSheetByName('Products');
  assert.ok(sh.rawApostrophe >= 1);
});
t('unknown action and long text rejected', () => {
  assert.ok(!api('dropEverything', {}).ok);
  assert.ok(!api('saveProduct', { name: 'x'.repeat(200) }).ok);
});
t('archive keeps history & costing', () => {
  refresh(ok('setMaterialActive', { id: COLOR.id, active: false }).data);
  assert.strictEqual(COLOR.active, false); assert.ok(CS.cost.raw > 0);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
