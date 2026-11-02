// Drives the public catalogue page (catalog/index.html, jsdom) against the real server code (mocked Google services).
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { makeEnv } = require('./gas-mock');

const G = makeEnv();
G.setup();
let n = 0;
const gapi = (action, payload) => {
  const r = JSON.parse(G.doPost({ postData: { contents: JSON.stringify({ k: G._props.API_KEY, action, payload, requestId: 'c' + (++n) }) } }).getContent());
  if (!r.ok) throw new Error(action + ': ' + r.error);
  return r;
};
const prods = gapi('bootstrap').data.products;
const CS = prods.find(p => p.name === 'شمعة الشمعدان'), SH = prods.find(p => p.name === 'شمعة الخروف'), JO = prods.find(p => p.name === 'شمعة جوري');
gapi('saveProduct', { id: CS.id, name: CS.name, selling_price: 85, weight_g: 70, width_cm: 2, length_cm: 25, catalog: { show: true, collection: 'الكلاسيك والشمعدانات', badge: 'best', desc: 'شمعة طويلة كلاسيك' } });
gapi('saveProduct', { id: SH.id, name: SH.name, selling_price: 0, catalog: { show: true, collection: 'الأطفال والسبوع' } });
gapi('saveProduct', { id: JO.id, name: JO.name, selling_price: 60, catalog: { show: false, collection: 'الرومانسي والأفراح' } });
const settings = show => gapi('saveCatalogSettings', { show_prices: show, whatsapp: '01141151032', instagram: 'noudella.creative', facebook: 'https://www.facebook.com/people/Noudella/100083123892315/',
  intro: 'أهلاً بيكم في نوديلا', price_note: 'السعر للقطعة', terms: 'اختار\nابعت\nاستلم', collections: [{ name: 'الأطفال والسبوع', desc: 'للسبوع' }, { name: 'الكلاسيك والشمعدانات', desc: '' }] });
settings(true);

const html = fs.readFileSync(path.join(__dirname, '..', 'catalog', 'index.html'), 'utf8');
let pass = 0, fail = 0;
async function step(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n     ' + e.message); } }
const assert = (c, m) => { if (!c) throw new Error(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function open(opts = {}) {
  const errors = [], calls = [];
  const vc = new VirtualConsole();
  // jsdom cannot parse @page margin boxes; they live alone in the print stylesheet, so only that sheet is skipped here.
  vc.on('jsdomError', e => { if (!/Could not parse CSS stylesheet/.test(e.message)) errors.push('jsdomError: ' + (e.stack || e.message)); });
  vc.on('error', e => errors.push('console.error: ' + e));
  const dom = new JSDOM(html, {
    url: 'https://triple-desk.github.io/noudella/catalog/' + (opts.hash || ''), runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.scrollTo = () => {};
      win.HTMLElement.prototype.scrollIntoView = function () {};
      win.fetch = (url, o) => {
        calls.push({ url, o });
        if (opts.offline) return Promise.reject(new TypeError('offline'));
        return new Promise(res => setTimeout(() => {
          const body = (o && o.method === 'POST') ? 'should be GET' : G.doGet({ parameter: { a: new win.URL(url).searchParams.get('a') } }).getContent();
          res({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(body)) });
        }, 1));
      };
      win.opened = []; win.open = u => { win.opened.push(u); return {}; };
      win.addEventListener('error', e => errors.push('window error: ' + e.message));
    }
  });
  dom.errors = errors; dom.calls = calls;
  return dom;
}

(async () => {
  let dom = open(), w = dom.window, doc = w.document;
  const $ = s => doc.querySelector(s), $$ = s => [...doc.querySelectorAll(s)];
  const click = el => { el = typeof el === 'string' ? $(el) : el; if (!el) throw new Error('missing element'); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
  await sleep(40);
  await step('loads the public view with GET ?a=catalog and no key', () => {
    assert(dom.calls.length === 1 && /\/exec\?a=catalog$/.test(dom.calls[0].url) && !dom.calls[0].url.includes('k='), 'call ' + JSON.stringify(dom.calls[0]));
    const t = $('#main').textContent;
    assert(t.includes('الأطفال والسبوع') && t.includes('الكلاسيك والشمعدانات') && t.includes('شمعة الشمعدان') && t.includes('شمعة الخروف'), 'sections ' + t.slice(0, 200));
    assert($$('.col h2').map(h => h.textContent).join('|') === 'الأطفال والسبوع|الكلاسيك والشمعدانات', 'collection order');
    assert(!t.includes('شمعة جوري'), 'hidden product shown');
    assert($('#intro').textContent === 'أهلاً بيكم في نوديلا' && $$('#steps li').length === 3, 'intro & steps');
  });
  await step('prices on: price, ask label for unpriced, badge, specs', () => {
    const card = $('#p-' + CS.id), sh = $('#p-' + SH.id);
    assert(card.textContent.includes('85') && card.textContent.includes('الأكثر طلبًا') && card.textContent.includes('2×25'), 'card ' + card.textContent);
    assert(sh.textContent.includes('اسأل عن السعر'), 'unpriced ' + sh.textContent);
  });
  await step('order: add, step up, bag total, WhatsApp message to the shop number', async () => {
    click(`[data-add="${CS.id}"]`); click(`[data-inc="${CS.id}"]`); click(`[data-add="${SH.id}"]`);
    assert($('#bag').classList.contains('show') && $('#bagCount').textContent.includes('3'), 'bag bar ' + $('#bagCount').textContent);
    assert($('#bagSum').textContent.includes('170'), 'sum ' + $('#bagSum').textContent);
    click('[data-act=bag]');
    assert($('.sheet[data-kind=bag]') && $('.tot').textContent.includes('170'), 'bag sheet');
    $('#bgName').value = 'سارة'; $('#bgNotes').value = 'لون أبيض';
    click('[data-act=send]');
    const u = w.opened.pop(); const msg = decodeURIComponent(u.split('text=')[1]);
    assert(u.startsWith('https://wa.me/201141151032?text='), 'number ' + u);
    assert(msg.includes('شمعة الشمعدان × 2 = 170') && msg.includes('شمعة الخروف × 1') && msg.includes('الإجمالي التقريبي: 170') && msg.includes('الاسم: سارة') && msg.includes('ملاحظات: لون أبيض'), msg);
    assert(JSON.parse(w.localStorage.getItem('noudella_bag'))[CS.id] === 2, 'bag remembered');
  });
  await step('decrease to zero removes the line; clear empties the order', () => {
    click(`.sheet [data-dec="${SH.id}"]`);
    assert(!$('.sheet').textContent.includes('شمعة الخروف'), 'line removed');
    click('[data-act=clear]');
    assert(!$('.sheet') && !$('#bag').classList.contains('show'), 'cleared');
  });
  await step('product sheet + deep link + ask on WhatsApp', () => {
    click(`[data-open="${CS.id}"]`);
    assert($('.sheet[data-kind=product]').textContent.includes('شمعة طويلة كلاسيك') && w.location.hash === '#p=' + CS.id, 'sheet & hash');
    click(`[data-ask="${CS.id}"]`);
    assert(decodeURIComponent(w.opened.pop()).includes('«شمعة الشمعدان»'), 'ask message');
    click('[data-act=close]');
    assert(!$('.sheet') && w.location.hash === '', 'closed');
  });
  await step('favours form builds a WhatsApp brief; quantity required', () => {
    click('[data-act=favor]');
    const f = $('#spForm');
    f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    assert(!w.opened.length, 'sent without quantity');
    $('#sf_occasion').value = 'سبوع'; $('#sf_qty').value = '150'; $('#sf_date').value = '2026-12-20'; $('#sf_names').value = 'آدم';
    f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    const msg = decodeURIComponent(w.opened.pop().split('text=')[1]);
    assert(msg.startsWith('أهلاً نوديلا، ده طلب توزيعات:') && msg.includes('المناسبة: سبوع') && msg.includes('العدد المطلوب: 150') && msg.includes('20/12/2026') && msg.includes('آدم'), msg);
    click('[data-act=close]');
  });
  await step('price list view and footer contacts', () => {
    click('[data-act=view]');
    assert(doc.body.classList.contains('list') && !$('#shotBtn').hidden, 'list mode');
    const c = $('#contacts').textContent;
    assert(c.includes('01141151032') && c.includes('@noudella.creative') && c.includes('فيسبوك'), 'contacts ' + c);
  });
  await step('nothing private on the page', () => {
    const all = doc.body.textContent + doc.body.innerHTML;
    ['avg_cost', 'تكلفة', 'الربح', 'المخزن', G._props.API_KEY].forEach(x => assert(!all.includes(x), 'leaked ' + x));
  });
  await step('no runtime errors (prices on); main stylesheet parsed', () => {
    assert(!dom.errors.length, dom.errors.join('\n'));
    assert(doc.styleSheets[0].cssRules.length > 80, 'main css rules ' + doc.styleSheets[0].cssRules.length);
  });

  settings(false);
  dom = open({ hash: '#p=' + CS.id }); w = dom.window; await sleep(40);
  await step('prices hidden: no prices, full-width add, deep link opens the product', () => {
    const t = w.document.querySelector('#main').textContent;
    assert(!t.includes('85') && !t.includes('اسأل عن السعر'), 'no price text ' + t);
    assert(w.document.querySelector('#p-' + CS.id + ' .c-foot').classList.contains('full'), 'full add button');
    assert(w.document.querySelector('#viewBtn').hidden, 'no price list');
    assert(w.document.querySelector('.sheet[data-kind=product]'), 'deep link sheet');
    assert(!dom.errors.length, dom.errors.join('\n'));
  });

  dom = open({ offline: true }); w = dom.window; await sleep(40);
  await step('offline first visit: clear message and WhatsApp fallback', () => {
    const t = w.document.querySelector('#main').textContent;
    assert(t.includes('الكتالوج مش بيحمّل') && w.document.querySelector('#main a[href^="https://wa.me/201141151032"]'), t);
  });

  console.log(`\nCatalogue page: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
