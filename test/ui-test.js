// Drives the real Index.html (jsdom) against the real server code (mocked Google services).
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { makeEnv } = require('./gas-mock');

const G = makeEnv();
G.setup();
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
const KEY = G._props.API_KEY;
const gapi = (action, payload, requestId) => JSON.parse(G.doPost({ postData: { contents: JSON.stringify({ k: KEY, action, payload, requestId }) } }).getContent());
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.stack || e.message)));
vc.on('error', e => errors.push('console.error: ' + e));
const dom = new JSDOM(html, {
  url: 'https://triple-desk.github.io/noudella/#d=AKfycbTESTdeploymentIdXXXXXXXX&k=' + KEY, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(win) {
    win.scrollTo = () => {};
    win.fetch = (url, opts) => new Promise(res => setTimeout(() => {
      const out = G.doPost({ postData: { contents: opts.body } }).getContent();
      res({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(out)) });
    }, 1));
    win.addEventListener('error', e => errors.push('window error: ' + e.message));
  }
});
const w = dom.window, doc = w.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = s => doc.querySelector(s);
const $$ = s => [...doc.querySelectorAll(s)];
function click(sel) { const el = typeof sel === 'string' ? $(sel) : sel; if (!el) throw new Error('missing ' + sel); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }
function setv(sel, v, ev = 'input') { const el = $(sel); if (!el) throw new Error('missing ' + sel); el.value = v; el.dispatchEvent(new w.Event(ev, { bubbles: true })); }
function text() { return $('#view').textContent.replace(/\s+/g, ' '); }
let pass = 0, fail = 0;
async function step(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n     ' + e.message); } }
const assert = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  await sleep(50);
  await step('boots to dashboard', () => { assert(!$('#splash'), 'splash still visible'); assert(text().includes('ربح الشهر'), 'no KPI'); });
  for (const v of ['products', 'materials', 'orders', 'purchases', 'production', 'settings', 'dashboard']) {
    await step('view ' + v, () => { click(`[data-act=nav][data-v=${v}]`); assert($('#view').innerHTML.length > 100, 'empty view'); });
  }
  await step('open product with recipe shows cost 20.75', () => {
    click('[data-act=nav][data-v=products]');
    const card = $$('.pcard').find(c => c.textContent.includes('الشمعدان')); click(card);
    assert(text().includes('20.75'), 'cost not shown: ' + text().slice(0, 300));
  });
  await step('add packaging material from recipe form, then add to recipe', async () => {
    click('[data-act=addLine]'); await sleep(5);
    click('[data-act=newMaterialFromRecipe]');
    setv('#mf_name', 'علبة كرتون'); click('[data-act=mfKind][data-v=packaging]'); click('[data-act=mfBase][data-v=pcs]');
    setv('#mf_amount', '250'); setv('#mf_pqty', '100'); setv('#mf_open', '40');
    assert($('#mf_prev').textContent.includes('2.5'), 'preview ' + $('#mf_prev').textContent);
    click('[data-act=saveMaterial]'); await sleep(30);
    assert($('#rl_mat') && $('#rl_mat').value, 'recipe form did not reopen with new material');
    setv('#rl_qty', '1'); click('[data-act=saveLine]'); await sleep(30);
    assert(text().includes('23.25'), 'new cost should be 23.25: ' + text().slice(0, 400));
  });
  await step('edit product price → margin', async () => {
    click('[data-act=editProduct]'); setv('#pf_price', '80'); click('[data-act=saveProduct]'); await sleep(30);
    assert(text().includes('56.75'), 'profit 56.75 missing');
  });
  await step('editing material without touching price keeps avg exact', async () => {
    const before = gapi('bootstrap').data.materials.find(m => m.name === 'لون سائل').avg_cost;
    click('[data-act=nav][data-v=materials]');
    click($$('.li').find(l => l.textContent.includes('لون سائل')));
    click('[data-act=editMaterial]'); setv('#mf_notes', 'تجربة'); click('[data-act=saveMaterial]'); await sleep(30);
    const after = gapi('bootstrap').data.materials.find(m => m.name === 'لون سائل');
    assert(after.avg_cost === before && after.notes === 'تجربة', 'avg changed ' + before + ' → ' + after.avg_cost);
  });
  await step('purchase with live preview', async () => {
    click('[data-act=nav][data-v=purchases]');
    const wax = gapi('bootstrap').data.materials.find(m => m.name === 'شمع عسل');
    setv('#pu_mat', wax.id, 'change'); setv('#pu_qty', '2'); setv('#pu_unit', 'kg', 'change'); setv('#pu_total', '700');
    assert($('#pu_prev').textContent.includes('0.35'), 'preview avg ' + $('#pu_prev').textContent);
    click('[data-act=savePurchase]'); await sleep(30); click('[data-act=savePurchase]'); await sleep(30);
    const d = gapi('bootstrap').data;
    assert(d.purchases.length === 1, 'double submit created ' + d.purchases.length);
  });
  let ORD;
  await step('order editor: live totals, shortage modal, save draft → invoice', async () => {
    click('[data-act=nav][data-v=orders]'); click('[data-act=newOrder]');
    click('[data-act=odAddLine]');
    const cs = gapi('bootstrap').data.products.find(p => p.name === 'شمعة الشمعدان');
    setv('select[data-od-line="0"]', cs.id, 'change');
    assert($('input[data-od-line="0"][data-f="unit_price"]').value === '80', 'price autofill');
    setv('input[data-od-line="0"][data-f="qty"]', '10');
    click('[data-act=odAddExtra]'); setv('input[data-od-extra="0"][data-f="label"]', 'توصيل'); setv('input[data-od-extra="0"][data-f="amount"]', '30');
    assert($('#od_sum').textContent.includes('800'), 'revenue missing');
    assert($('#odcalc0').textContent.includes('هيتنتج الناقص'), 'ready-stock warning missing');
    click('[data-act=odConfirm]'); await sleep(5);
    assert($('.sheet h3').textContent.includes('القطع الجاهزة مش كفاية'), 'shortage modal missing');
    assert(!$('#cfProduce'), 'wick is short, produce must not be offered');
    click('[data-act=closeModal]'); click('[data-act=odSave]'); await sleep(40);
    assert($('#invoice'), 'invoice not shown after save');
    assert($('#invoice .stamp').textContent.includes('DRAFT'), 'draft stamp');
    assert(!$('#invoice').textContent.includes('تكلفة'), 'invoice must not show costs');
    ORD = gapi('bootstrap').data.orders[0];
  });
  await step('confirm with auto-production → CONFIRMED stamp, pieces leave store', async () => {
    const d = gapi('bootstrap').data;
    const wick = d.materials.find(m => m.name === 'فتيل قطن');
    gapi('savePurchase', { material_id: wick.id, qty: 60, unit: 'm', total_price: 300 }, 'x1');
    await w.api('bootstrap');
    click('[data-act=nav][data-v=orders]'); click($$('.li').find(l => l.getAttribute('data-p') === ORD.id));
    click('[data-act=ordConfirm]'); await sleep(5);
    assert($('#cfProduce'), 'produce option expected'); click('#cfProduce'); await sleep(40);
    assert($('#invoice .stamp').textContent.includes('CONFIRMED'), 'confirmed stamp: ' + ($('#invoice .stamp') || {}).textContent);
    const d2 = gapi('bootstrap').data, cs = d2.products.find(p => p.name === 'شمعة الشمعدان');
    assert(Number(cs.stock) === 0 && d2.production.length === 1, 'stock ' + cs.stock + ' batches ' + d2.production.length);
  });
  await step('cancel returns pieces and invoice gets CANCELLED stamp', async () => {
    click('[data-act=nav][data-v=orders]'); click($$('.li').find(l => l.getAttribute('data-p') === ORD.id));
    click('[data-act=ordStatus2][data-s=cancelled]'); await sleep(5); click('[data-act=cfYes]'); await sleep(40);
    assert($('#invoice .stamp').textContent.includes('CANCELLED'), 'cancelled stamp');
    const cs = gapi('bootstrap').data.products.find(p => p.name === 'شمعة الشمعدان');
    assert(Number(cs.stock) === 10, 'stock back to 10, got ' + cs.stock);
  });
  await step('product card shows ready stock; material form has photo field', async () => {
    click('[data-act=nav][data-v=products]');
    assert(text().includes('في المخزن'), 'stock line missing');
    click('[data-act=nav][data-v=materials]'); click('[data-act=newMaterial]');
    assert($('#mf_img') && $('#mf_prev'), 'material photo field missing'); click('[data-act=closeModal]');
  });
  await step('product stock shown on card and big in details', async () => {
    click('[data-act=nav][data-v=products]');
    const card = $$('.pcard').find(c => c.textContent.includes('الشمعدان'));
    assert(card.querySelector('.stock-pill') && card.querySelector('.stock-pill').textContent.includes('10'), 'stock pill');
    click(card); assert($('.stockbox .big').textContent.trim() === '10', 'big stock number');
  });
  await step('order with customer phone → WhatsApp opens customer chat with PDF link', async () => {
    click('[data-act=nav][data-v=orders]'); click('[data-act=newOrder]');
    click('[data-act=odAddLine]');
    const cs = gapi('bootstrap').data.products.find(p => p.name === 'شمعة الشمعدان');
    setv('select[data-od-line="0"]', cs.id, 'change'); setv('input[data-od-line="0"][data-f="qty"]', '2');
    setv('#od_customer', 'سارة'); setv('#od_phone', '01012345678');
    click('[data-act=odConfirm]'); await sleep(5); click('[data-act=cfYes]'); await sleep(40);
    assert($('#invoice').textContent.includes('01012345678'), 'phone on invoice');
    w.LOADED[w.H2C] = Promise.resolve(); w.LOADED[w.JSPDF] = Promise.resolve();
    w.html2canvas = () => Promise.resolve({ width: 400, height: 600, toDataURL: () => 'data:image/jpeg;base64,AAAA' });
    w.jspdf = { jsPDF: function () { return { addImage() {}, output(t) { return t === 'blob' ? new w.Blob(['%PDF']) : 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 x').toString('base64'); } }; } };
    let opened = null; w.open = u => { opened = u; return {}; };
    click('[data-act=invWhatsApp]'); await sleep(60);
    assert(opened && opened.startsWith('https://wa.me/201012345678?text='), 'wa link: ' + opened);
    assert(decodeURIComponent(opened).includes('drive.google.com/file/d/'), 'pdf link in message');
    opened = null; click('[data-act=invWhatsApp]'); await sleep(5);
    assert(opened, 'second time opens instantly (cached PDF)');
  });
  await step('config remembered on device', () => { assert(JSON.parse(w.localStorage.getItem('noudella_cfg')).k === KEY, 'not saved'); });
  await step('no runtime errors', () => { assert(!errors.length, errors.join('\n')); });
  console.log(`\nUI: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
