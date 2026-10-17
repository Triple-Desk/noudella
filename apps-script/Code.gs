/**
 * Noudella Business System — server (Google Apps Script).
 * Database: one dedicated Google Sheet created by setup() inside the Drive folder "Noudella Business System".
 *
 * SECURITY NOTE: the web app is public (no login, owner's explicit requirement).
 * Only doGet, doPost, setup and dailyBackup are callable from outside; the API needs the secret key; everything else ends with "_".
 * All input is validated here on the server; nothing is ever hard-deleted except recipe lines (logged).
 */

var APP = {
  FOLDER: 'Noudella Business System',
  DB_NAME: 'Noudella Database',
  TZ: 'Africa/Cairo',
  KEEP_BACKUPS: 30,
  MAX_WRITES_PER_MIN: 90,
  VERSION: '1.3.0'
};

var SCHEMA = {
  Settings:   ['key', 'value'],
  Materials:  ['id', 'name', 'category', 'kind', 'base_unit', 'stock', 'avg_cost', 'min_stock', 'life_units',
               'supplier', 'notes', 'active', 'created_at', 'updated_at', 'image_id'],
  Products:   ['id', 'name', 'category', 'selling_price', 'other_cost', 'other_cost_label', 'image_id', 'stock',
               'notes', 'active', 'created_at', 'updated_at'],
  Recipes:    ['id', 'product_id', 'material_id', 'qty_base', 'input_qty', 'input_unit', 'notes', 'created_at', 'updated_at'],
  Orders:     ['id', 'order_no', 'order_date', 'customer', 'status', 'discount', 'charges', 'extras_json', 'notes',
               'items_revenue', 'revenue', 'product_cost', 'extra_cost', 'profit', 'margin',
               'confirmed_at', 'delivered_at', 'created_at', 'updated_at', 'stock_out', 'customer_phone',
               'invoice_file_id', 'invoice_status'],
  OrderLines: ['id', 'order_id', 'product_id', 'product_name', 'qty', 'unit_price', 'unit_cost', 'raw_cost',
               'packaging_cost', 'tool_cost', 'other_cost', 'line_revenue', 'line_cost', 'created_at'],
  Purchases:  ['id', 'purchase_date', 'material_id', 'material_name', 'input_qty', 'input_unit', 'qty_base',
               'total_price', 'unit_cost', 'supplier', 'notes', 'avg_before', 'avg_after', 'stock_after', 'status', 'created_at'],
  Production: ['id', 'batch_no', 'prod_date', 'product_id', 'product_name', 'qty', 'unit_cost', 'total_cost',
               'materials_json', 'notes', 'status', 'created_at'],
  Movements:  ['id', 'mv_date', 'item_type', 'item_id', 'item_name', 'type', 'qty', 'unit_cost', 'value',
               'stock_after', 'ref_type', 'ref_id', 'notes', 'created_at'],
  Activity:   ['at', 'action', 'entity', 'entity_id', 'summary']
};

var NUMERIC_COLS = {
  stock: 1, avg_cost: 1, min_stock: 1, life_units: 1, selling_price: 1, other_cost: 1, qty_base: 1, input_qty: 1,
  discount: 1, charges: 1, items_revenue: 1, revenue: 1, product_cost: 1, extra_cost: 1, profit: 1, margin: 1,
  qty: 1, unit_price: 1, unit_cost: 1, raw_cost: 1, packaging_cost: 1, tool_cost: 1, line_revenue: 1, line_cost: 1,
  total_price: 1, avg_before: 1, avg_after: 1, stock_after: 1, total_cost: 1, value: 1
};

/* =========================== Web entry points =========================== */

/**
 * The app itself is hosted on GitHub Pages (works even when a phone/browser is signed into several
 * Google accounts). This exec URL only serves the JSON API below; opening it directly shows a short notice.
 */
function doGet() {
  return HtmlService.createHtmlOutput('<div dir="rtl" style="font-family:sans-serif;padding:40px;text-align:center;color:#6D1833">' +
    '<h2>نوديلا</h2><p>افتح السيستم من الرابط الخاص بيك.</p></div>').setTitle('نوديلا');
}

/** JSON API used by the web app: POST text/plain body {k, action, payload, requestId}. */
function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var key = PropertiesService.getScriptProperties().getProperty('API_KEY');
    if (!key || String(req.k || '') !== key) out = { ok: false, error: 'رابط غير صالح', auth: false };
    else out = apiCall_(req);
  } catch (err) {
    out = { ok: false, error: 'طلب غير صالح' };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Single API door for the browser. req = {action, payload, requestId} */
function apiCall_(req) {
  req = req || {};
  var action = String(req.action || '');
  try {
    if (action === 'bootstrap') return { ok: true, data: bootstrap_() };
    var handler = WRITE_ACTIONS_[action];
    if (!handler) throw new Error('عملية غير معروفة');
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) throw new Error('النظام مشغول، حاول مرة أخرى بعد ثوانٍ');
    try {
      var cache = CacheService.getScriptCache();
      var rid = String(req.requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      if (rid && cache.get('rq:' + rid)) {
        resetCache_();
        return { ok: true, duplicate: true, data: bootstrap_() };
      }
      rateLimit_(cache);
      var result = handler(req.payload || {});
      if (rid) cache.put('rq:' + rid, '1', 21600);
      SpreadsheetApp.flush();
      resetCache_();
      return { ok: true, result: result || null, data: bootstrap_() };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    console.error(action, e && e.stack || e);
    return { ok: false, error: (e && e.message) || String(e), details: e && e.details || null, code: e && e.code || '' };
  }
}

var WRITE_ACTIONS_ = {
  saveMaterial: function (p) { return saveMaterial_(p); },
  setMaterialActive: function (p) { return setActive_('Materials', p); },
  adjustStock: function (p) { return adjustStock_(p); },
  savePurchase: function (p) { return savePurchase_(p); },
  reversePurchase: function (p) { return reversePurchase_(p); },
  saveProduct: function (p) { return saveProduct_(p); },
  setProductActive: function (p) { return setActive_('Products', p); },
  duplicateProduct: function (p) { return duplicateProduct_(p); },
  saveRecipeLine: function (p) { return saveRecipeLine_(p); },
  deleteRecipeLine: function (p) { return deleteRecipeLine_(p); },
  saveOrder: function (p) { return saveOrder_(p); },
  confirmOrder: function (p) { return confirmOrder_(p.id, { produce: p.produce === true }); },
  setOrderStatus: function (p) { return setOrderStatus_(p); },
  recordProduction: function (p) { return recordProduction_(p); },
  reverseProduction: function (p) { return reverseProduction_(p); },
  saveSettings: function (p) { return saveSettings_(p); },
  backupNow: function () { return backupNow_(false); },
  saveInvoicePdf: function (p) { return saveInvoicePdf_(p); }
};

/* =========================== Setup & backups =========================== */

/** Run once from the editor. Safe to run again: never overwrites existing data. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_KEY')) props.setProperty('API_KEY', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8));
  console.log('NOUDELLA_KEY=' + props.getProperty('API_KEY'));
  var existing = props.getProperty('DB_ID');
  if (existing) {
    try { _DB = SpreadsheetApp.openById(existing); ensureSheets_(_DB); resetCache_(); migrate_(); installTrigger_();
          return 'Already set up: ' + existing; } catch (e) { /* fall through and recreate only if the file is gone */ }
  }
  var folder = getOrCreateFolder_(DriveApp.getRootFolder(), APP.FOLDER);
  var backups = getOrCreateFolder_(folder, 'Backups');
  var photos = getOrCreateFolder_(folder, 'Product Photos');
  getOrCreateFolder_(folder, 'Documentation');

  var ss = SpreadsheetApp.create(APP.DB_NAME);
  var file = DriveApp.getFileById(ss.getId());
  file.moveTo(folder);
  try { DriveApp.getFileById(ScriptApp.getScriptId()).moveTo(folder); } catch (e) { /* optional */ }
  ss.setSpreadsheetTimeZone(APP.TZ);
  ensureSheets_(ss);
  var first = ss.getSheetByName('Sheet1') || ss.getSheetByName('ورقة1');
  if (first && ss.getSheets().length > 1) ss.deleteSheet(first);

  props.setProperties({ DB_ID: ss.getId(), FOLDER_ID: folder.getId(), BACKUP_FOLDER_ID: backups.getId(),
                        PHOTO_FOLDER_ID: photos.getId() });
  _DB = ss;
  seed_();
  SpreadsheetApp.flush();
  installTrigger_();
  return 'Created database ' + ss.getUrl();
}

/** Time-driven daily backup (also safe if called from outside: at most one copy per 20 hours). */
function dailyBackup() { return backupNow_(true); }

function backupNow_(isDaily) {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty('LAST_BACKUP') || 0);
  var minGap = isDaily ? 20 * 3600 * 1000 : 10 * 60 * 1000;
  if (Date.now() - last < minGap) return { skipped: true, message: 'تم أخذ نسخة احتياطية منذ قليل' };
  var folder = DriveApp.getFolderById(props.getProperty('BACKUP_FOLDER_ID'));
  var name = 'Noudella Backup ' + Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd HH-mm');
  DriveApp.getFileById(props.getProperty('DB_ID')).makeCopy(name, folder);
  props.setProperty('LAST_BACKUP', String(Date.now()));
  var files = [], it = folder.getFiles();
  while (it.hasNext()) { var f = it.next(); if (f.getName().indexOf('Noudella Backup ') === 0) files.push(f); }
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(APP.KEEP_BACKUPS).forEach(function (f) { f.setTrashed(true); });
  if (!isDaily) log_('backup', 'System', '', 'نسخة احتياطية يدوية');
  return { skipped: false, message: 'تم حفظ نسخة احتياطية: ' + name };
}

function installTrigger_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dailyBackup'; });
  if (!has) ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(3).create();
}

/** Stores the customer invoice PDF (made in the browser) in Drive, shared view-by-link, one file per order. */
function saveInvoicePdf_(p) {
  var order = must_('Orders', p.order_id, 'الطلب');
  var data = String(p.data || '');
  if (!data || data.length > 4000000) throw new Error('ملف الفاتورة غير صالح');
  var bytes = Utilities.base64Decode(data);
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) throw new Error('ملف الفاتورة غير صالح');
  var props = PropertiesService.getScriptProperties();
  var folder = getOrCreateFolder_(DriveApp.getFolderById(props.getProperty('FOLDER_ID')), 'Invoices');
  if (order.invoice_file_id) { try { DriveApp.getFileById(order.invoice_file_id).setTrashed(true); } catch (e) { /* already gone */ } }
  var f = folder.createFile(Utilities.newBlob(bytes, 'application/pdf',
    'Noudella Invoice ' + order.order_no + ' (' + String(order.status).toUpperCase() + ').pdf'));
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  update_('Orders', order.id, { invoice_file_id: f.getId(), invoice_status: order.status });
  log_('invoice', 'Order', order.id, order.order_no + ' PDF');
  return { url: 'https://drive.google.com/file/d/' + f.getId() + '/view?usp=sharing' };
}

function getOrCreateFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function ensureSheets_(ss) {
  Object.keys(SCHEMA).forEach(function (name) {
    var cols = SCHEMA[name];
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, cols.length).setValues([cols])
        .setFontWeight('bold').setBackground('#6D1833').setFontColor('#FFFFFF');
      sh.setFrozenRows(1);
      cols.forEach(function (c, i) {
        if (!NUMERIC_COLS[c] && name !== 'Settings' && c !== 'active' && c !== 'stock_out') {
          sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
        }
      });
      if (sh.getMaxColumns() > cols.length) sh.deleteColumns(cols.length + 1, sh.getMaxColumns() - cols.length);
    } else {
      var head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
      cols.forEach(function (c) {           // add any missing columns at the end (forward-compatible upgrades)
        if (head.indexOf(c) === -1) {
          var next = sh.getLastColumn() + 1;
          if (next > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
          sh.getRange(1, next).setValue(c).setFontWeight('bold').setBackground('#6D1833').setFontColor('#FFFFFF');
          if (!NUMERIC_COLS[c] && c !== 'active' && c !== 'stock_out') sh.getRange(2, next, sh.getMaxRows() - 1, 1).setNumberFormat('@');
          head.push(c);
        }
      });
    }
  });
}

/* =========================== Database layer =========================== */

var _DB = null, _T = {};

function db_() {
  if (_DB) return _DB;
  var id = PropertiesService.getScriptProperties().getProperty('DB_ID');
  if (!id) throw new Error('النظام لم يتم تجهيزه بعد (setup)');
  _DB = SpreadsheetApp.openById(id);
  return _DB;
}
function resetCache_() { _T = {}; }
function sheet_(name) {
  var sh = db_().getSheetByName(name);
  if (!sh) throw new Error('جدول مفقود: ' + name);
  return sh;
}
function headers_(name) {
  if (!_T['__h_' + name]) {
    var sh = sheet_(name);
    _T['__h_' + name] = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  }
  return _T['__h_' + name];
}
function norm_(v) {
  if (v instanceof Date) {
    var hasTime = v.getHours() || v.getMinutes() || v.getSeconds();
    return Utilities.formatDate(v, APP.TZ, hasTime ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd');
  }
  return v;
}
function cell_(v, col, table) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v;
  if (NUMERIC_COLS[col] && table !== 'Settings') return v === '' ? '' : num_(v);
  var s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;          // block spreadsheet formula injection
  return s;
}
function rows_(name) {
  if (_T[name]) return _T[name];
  var sh = sheet_(name), head = headers_(name), last = sh.getLastRow(), out = [];
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, head.length).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (vals[i][0] === '' || vals[i][0] === null) continue;
      var o = { _row: i + 2 };
      for (var j = 0; j < head.length; j++) o[head[j]] = norm_(vals[i][j]);
      out.push(o);
    }
  }
  _T[name] = out;
  return out;
}
function find_(name, id) {
  var key = SCHEMA[name][0];
  var list = rows_(name);
  for (var i = 0; i < list.length; i++) if (String(list[i][key]) === String(id)) return list[i];
  return null;
}
function must_(name, id, label) {
  var r = id ? find_(name, id) : null;
  if (!r) throw new Error((label || 'السجل') + ' غير موجود');
  return r;
}
function rowValues_(name, o) {
  return headers_(name).map(function (c) { return cell_(o[c], c, name); });
}
function insert_(name, objs) {
  if (!objs.length) return;
  var sh = sheet_(name), head = headers_(name);
  var data = objs.map(function (o) { return rowValues_(name, o); });
  var start = sh.getLastRow() + 1;
  var need = start + data.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need + 200);
  sh.getRange(start, 1, data.length, head.length).setValues(data);
  if (_T[name]) objs.forEach(function (o, i) { o._row = start + i; _T[name].push(o); });
}
function update_(name, id, patch) {
  var r = must_(name, id);
  Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
  sheet_(name).getRange(r._row, 1, 1, headers_(name).length).setValues([rowValues_(name, r)]);
  return r;
}
function deleteRow_(name, id) {
  var r = must_(name, id);
  sheet_(name).deleteRow(r._row);
  delete _T[name];
}
function newId_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
}
function now_() { return Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd HH:mm:ss'); }
function today_() { return Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd'); }

function getSetting_(key, dflt) {
  var r = find_('Settings', key);
  return r ? r.value : dflt;
}
function setSetting_(key, value) {
  if (find_('Settings', key)) update_('Settings', key, { value: value });
  else insert_('Settings', [{ key: key, value: value }]);
}
function nextCounter_(key) {
  var n = num_(getSetting_(key, 1)) || 1;
  setSetting_(key, n + 1);
  return n;
}
function log_(action, entity, id, summary) {
  insert_('Activity', [{ at: now_(), action: action, entity: entity, entity_id: id, summary: String(summary).slice(0, 300) }]);
}
function rateLimit_(cache) {
  var key = 'rl:' + Math.floor(Date.now() / 60000);
  var n = Number(cache.get(key) || 0) + 1;
  if (n > APP.MAX_WRITES_PER_MIN) throw new Error('عدد كبير من العمليات في دقيقة واحدة، انتظر قليلًا');
  cache.put(key, String(n), 120);
}

/* =========================== Validation =========================== */

function vStr_(v, label, max, required) {
  var s = (v === undefined || v === null) ? '' : String(v).replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  if (required && !s) throw new Error('من فضلك اكتب ' + label);
  if (s.length > max) throw new Error(label + ': النص أطول من المسموح (' + max + ' حرف)');
  return s;
}
function vNum_(v, label, opt) {
  opt = opt || {};
  if (v === '' || v === null || v === undefined) {
    if (opt.required) throw new Error('من فضلك اكتب ' + label);
    return opt.dflt !== undefined ? opt.dflt : 0;
  }
  var n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  if (!isFinite(n)) throw new Error(label + ': رقم غير صحيح');
  if (opt.min !== undefined && n < opt.min) throw new Error(label + ': لا يمكن أن يكون أقل من ' + opt.min);
  if (opt.gt !== undefined && !(n > opt.gt)) throw new Error(label + ': يجب أن يكون أكبر من ' + opt.gt);
  if (opt.max !== undefined && n > opt.max) throw new Error(label + ': أكبر من الحد المسموح');
  if (opt.int && Math.floor(n) !== n) throw new Error(label + ': يجب أن يكون رقمًا صحيحًا');
  return n;
}
function vEnum_(v, allowed, label) {
  if (allowed.indexOf(v) === -1) throw new Error(label + ': اختيار غير صحيح');
  return v;
}
function vPhone_(v) {
  var s = vStr_(v, 'رقم التليفون', 25, false).replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); });
  if (s && !/^\+?[0-9\s\-()]{6,22}$/.test(s)) throw new Error('رقم التليفون غير صحيح');
  return s;
}
function vDate_(v) {
  if (!v) return today_();
  var s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('التاريخ غير صحيح');
  return s;
}
function vUnit_(unit, baseUnit, label) {
  if (!UNITS[unit]) throw new Error((label || 'الوحدة') + ': وحدة غير معروفة');
  if (UNITS[unit].dim !== UNITS[baseUnit].dim) throw new Error('الوحدة "' + UNITS[unit].ar + '" لا تناسب هذه الخامة');
  return unit;
}
function sameName_(list, name, exceptId) {
  var n = name.toLowerCase();
  return list.some(function (r) { return r.id !== exceptId && String(r.name).trim().toLowerCase() === n; });
}

/* =========================== Materials & stock =========================== */

function materialsById_() {
  var m = {};
  rows_('Materials').forEach(function (r) { m[r.id] = r; });
  return m;
}

function movement_(o) {
  insert_('Movements', [{
    id: newId_('MV'), mv_date: o.date || today_(), item_type: o.item_type || 'material', item_id: o.item_id,
    item_name: o.item_name, type: o.type, qty: r6_(o.qty), unit_cost: r6_(o.unit_cost || 0),
    value: r2_(num_(o.qty) * num_(o.unit_cost || 0)), stock_after: r6_(o.stock_after), ref_type: o.ref_type || '',
    ref_id: o.ref_id || '', notes: o.notes || '', created_at: now_()
  }]);
}

function saveMaterial_(p) {
  var isNew = !p.id;
  var cur = isNew ? null : must_('Materials', p.id, 'الخامة');
  var name = vStr_(p.name, 'اسم الخامة', 80, true);
  if (sameName_(rows_('Materials'), name, cur && cur.id)) throw new Error('يوجد خامة بنفس الاسم بالفعل');
  var kind = vEnum_(p.kind, ['raw', 'packaging', 'tool'], 'النوع');
  var baseUnit = isNew ? vEnum_(p.base_unit, Object.keys(BASE_UNITS), 'وحدة القياس') : cur.base_unit;
  if (!isNew && p.base_unit && p.base_unit !== cur.base_unit) throw new Error('لا يمكن تغيير وحدة القياس بعد إنشاء الخامة');
  var rec = {
    name: name,
    category: vStr_(p.category, 'التصنيف', 40, false),
    kind: kind,
    min_stock: 0,
    life_units: kind === 'tool' ? vNum_(p.life_units, 'عدد مرات الاستخدام', { min: 0, max: 1e6, int: true }) : '',
    supplier: vStr_(p.supplier, 'المورد', 60, false),
    notes: vStr_(p.notes, 'الملاحظات', 300, false),
    updated_at: now_()
  };
  if (p.min_stock && p.min_stock.qty !== '' && p.min_stock.qty !== undefined && p.min_stock.qty !== null) {
    var mq = vNum_(p.min_stock.qty, 'حد التنبيه', { min: 0, max: 1e9 });
    rec.min_stock = toBase_(mq, vUnit_(p.min_stock.unit || baseUnit, baseUnit), baseUnit);
  }
  var newAvg = null;
  if (p.price && p.price.amount !== '' && p.price.amount !== undefined && p.price.amount !== null) {
    var amount = vNum_(p.price.amount, 'السعر', { min: 0, max: 1e9 });
    var pq = vNum_(p.price.qty, 'كمية السعر', { gt: 0, max: 1e9 });
    newAvg = pricePerBase_(amount, pq, vUnit_(p.price.unit, baseUnit), baseUnit);
  }
  if (p.image && p.image.data) rec.image_id = saveImage_(p.image, 'MAT ' + name);
  if (p.removeImage) rec.image_id = '';
  if (isNew) {
    rec.id = newId_('MAT'); rec.base_unit = baseUnit; rec.active = true; rec.created_at = now_();
    rec.avg_cost = newAvg === null ? 0 : newAvg;
    rec.stock = 0;
    var open = p.opening && num_(p.opening.qty) > 0
      ? toBase_(vNum_(p.opening.qty, 'الرصيد الافتتاحي', { min: 0, max: 1e9 }), vUnit_(p.opening.unit || baseUnit, baseUnit), baseUnit) : 0;
    rec.stock = open;
    insert_('Materials', [rec]);
    if (open > 0) movement_({ item_id: rec.id, item_name: name, type: 'OPENING', qty: open, unit_cost: rec.avg_cost,
                               stock_after: open, ref_type: 'material', ref_id: rec.id, notes: 'رصيد افتتاحي' });
    log_('create', 'Material', rec.id, name);
    return { id: rec.id };
  }
  if (newAvg !== null && Math.abs(newAvg - num_(cur.avg_cost)) > 1e-9) {
    rec.avg_cost = newAvg;
    movement_({ item_id: cur.id, item_name: name, type: 'PRICE', qty: 0, unit_cost: newAvg, stock_after: cur.stock,
                ref_type: 'material', ref_id: cur.id, notes: 'تعديل السعر من ' + r4_(cur.avg_cost) + ' إلى ' + r4_(newAvg) + ' لكل ' + baseUnit });
  }
  update_('Materials', cur.id, rec);
  log_('update', 'Material', cur.id, name);
  return { id: cur.id };
}

function setActive_(table, p) {
  var r = must_(table, p.id);
  var active = p.active === true || p.active === 'true';
  update_(table, r.id, { active: active, updated_at: now_() });
  log_(active ? 'restore' : 'archive', table, r.id, r.name);
  return { id: r.id };
}

function adjustStock_(p) {
  var m = must_('Materials', p.material_id, 'الخامة');
  var mode = vEnum_(p.mode, ['count', 'waste', 'add'], 'نوع الحركة');
  var unit = vUnit_(p.unit || m.base_unit, m.base_unit);
  var q = toBase_(vNum_(p.qty, 'الكمية', { min: 0, max: 1e9, required: true }), unit, m.base_unit);
  var stock = num_(m.stock), delta, type, note = vStr_(p.notes, 'السبب', 200, false);
  if (mode === 'count') { delta = q - stock; type = 'COUNT'; }
  else if (mode === 'waste') {
    if (!(q > 0)) throw new Error('اكتب كمية الهالك');
    if (q > stock + 1e-9) throw new Error('كمية الهالك أكبر من الرصيد الحالي');
    delta = -q; type = 'WASTE';
  } else { if (!(q > 0)) throw new Error('اكتب الكمية'); delta = q; type = 'ADD'; }
  if (Math.abs(delta) < 1e-9) return { id: m.id, unchanged: true };
  var after = r6_(stock + delta);
  update_('Materials', m.id, { stock: after, updated_at: now_() });
  movement_({ date: vDate_(p.date), item_id: m.id, item_name: m.name, type: type, qty: delta, unit_cost: m.avg_cost,
              stock_after: after, ref_type: 'adjust', ref_id: '', notes: note });
  log_('stock', 'Material', m.id, type + ' ' + delta + ' ' + m.base_unit);
  return { id: m.id };
}

function savePurchase_(p) {
  var m = must_('Materials', p.material_id, 'الخامة');
  var unit = vUnit_(p.unit, m.base_unit);
  var inQty = vNum_(p.qty, 'الكمية', { gt: 0, max: 1e9, required: true });
  var qBase = toBase_(inQty, unit, m.base_unit);
  if (!(qBase > 0)) throw new Error('الكمية صغيرة جدًا');
  var total = vNum_(p.total_price, 'إجمالي السعر', { min: 0, max: 1e9, required: true });
  var stockBefore = num_(m.stock), avgBefore = num_(m.avg_cost);
  var avgAfter = weightedAvg_(stockBefore, avgBefore, qBase, total);
  var stockAfter = r6_(stockBefore + qBase);
  var rec = {
    id: newId_('PUR'), purchase_date: vDate_(p.date), material_id: m.id, material_name: m.name, input_qty: inQty,
    input_unit: unit, qty_base: qBase, total_price: r2_(total), unit_cost: r6_(total / qBase),
    supplier: vStr_(p.supplier, 'المورد', 60, false), notes: vStr_(p.notes, 'الملاحظات', 200, false),
    avg_before: r6_(avgBefore), avg_after: r6_(avgAfter), stock_after: stockAfter, status: 'active', created_at: now_()
  };
  insert_('Purchases', [rec]);
  update_('Materials', m.id, { stock: stockAfter, avg_cost: r6_(avgAfter), updated_at: now_(),
                               supplier: rec.supplier || m.supplier });
  movement_({ date: rec.purchase_date, item_id: m.id, item_name: m.name, type: 'PURCHASE', qty: qBase,
              unit_cost: rec.unit_cost, stock_after: stockAfter, ref_type: 'purchase', ref_id: rec.id, notes: rec.supplier });
  log_('create', 'Purchase', rec.id, m.name + ' ' + inQty + ' ' + unit + ' = ' + total);
  return { id: rec.id };
}

/** Undo a purchase — only if nothing else touched that material afterwards (keeps averages exact). */
function reversePurchase_(p) {
  var pur = must_('Purchases', p.id, 'عملية الشراء');
  if (pur.status === 'reversed') throw new Error('تم إلغاء هذه العملية من قبل');
  var m = must_('Materials', pur.material_id, 'الخامة');
  var mvs = rows_('Movements').filter(function (x) { return x.item_id === m.id; });
  var lastMv = mvs[mvs.length - 1];
  if (!lastMv || lastMv.ref_id !== pur.id) throw new Error('لا يمكن إلغاء هذه العملية لأن الخامة اتعمل عليها حركات بعدها. استخدم "تعديل الرصيد" بدلًا من ذلك.');
  var stockAfter = r6_(num_(m.stock) - num_(pur.qty_base));
  update_('Materials', m.id, { stock: stockAfter, avg_cost: num_(pur.avg_before) || num_(m.avg_cost), updated_at: now_() });
  update_('Purchases', pur.id, { status: 'reversed' });
  movement_({ item_id: m.id, item_name: m.name, type: 'PURCHASE_REVERSAL', qty: -num_(pur.qty_base),
              unit_cost: pur.unit_cost, stock_after: stockAfter, ref_type: 'purchase', ref_id: pur.id, notes: 'إلغاء شراء' });
  log_('reverse', 'Purchase', pur.id, m.name);
  return { id: pur.id };
}

/* =========================== Products & recipes =========================== */

function saveProduct_(p) {
  var isNew = !p.id;
  var cur = isNew ? null : must_('Products', p.id, 'المنتج');
  var name = vStr_(p.name, 'اسم المنتج', 80, true);
  if (sameName_(rows_('Products'), name, cur && cur.id)) throw new Error('يوجد منتج بنفس الاسم بالفعل');
  var rec = {
    name: name,
    category: vStr_(p.category, 'التصنيف', 40, false),
    selling_price: vNum_(p.selling_price, 'سعر البيع', { min: 0, max: 1e8 }),
    other_cost: vNum_(p.other_cost, 'تكلفة إضافية', { min: 0, max: 1e8 }),
    other_cost_label: vStr_(p.other_cost_label, 'وصف التكلفة الإضافية', 40, false),
    notes: vStr_(p.notes, 'الملاحظات', 300, false),
    updated_at: now_()
  };
  if (p.image && p.image.data) rec.image_id = saveImage_(p.image, name);
  if (p.removeImage) rec.image_id = '';
  if (isNew) {
    rec.id = newId_('PRD'); rec.stock = 0; rec.active = true; rec.created_at = now_();
    insert_('Products', [rec]);
    log_('create', 'Product', rec.id, name);
    return { id: rec.id };
  }
  update_('Products', cur.id, rec);
  log_('update', 'Product', cur.id, name + ' السعر ' + rec.selling_price);
  return { id: cur.id };
}

function imageUrl_(id) {
  return id ? 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(id) + '=w800' : '';
}

function saveImage_(img, name) {
  var mime = vEnum_(String(img.mime || ''), ['image/jpeg', 'image/png', 'image/webp'], 'الصورة');
  var data = String(img.data);
  if (data.length > 1600000) throw new Error('الصورة كبيرة جدًا');
  var bytes = Utilities.base64Decode(data);
  var folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('PHOTO_FOLDER_ID'));
  var f = folder.createFile(Utilities.newBlob(bytes, mime, name.slice(0, 40) + ' ' + Date.now()));
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return f.getId();
}

function duplicateProduct_(p) {
  var src = must_('Products', p.id, 'المنتج');
  var name = vStr_(p.name, 'اسم المنتج الجديد', 80, true);
  if (sameName_(rows_('Products'), name, null)) throw new Error('يوجد منتج بنفس الاسم بالفعل');
  var id = newId_('PRD'), t = now_();
  insert_('Products', [{ id: id, name: name, category: src.category, selling_price: src.selling_price,
    other_cost: src.other_cost, other_cost_label: src.other_cost_label, image_id: '', stock: 0, notes: src.notes,
    active: true, created_at: t, updated_at: t }]);
  var lines = rows_('Recipes').filter(function (r) { return r.product_id === src.id; }).map(function (r) {
    return { id: newId_('RCP'), product_id: id, material_id: r.material_id, qty_base: r.qty_base, input_qty: r.input_qty,
             input_unit: r.input_unit, notes: r.notes, created_at: t, updated_at: t };
  });
  insert_('Recipes', lines);
  log_('duplicate', 'Product', id, src.name + ' → ' + name);
  return { id: id };
}

function saveRecipeLine_(p) {
  var prod = must_('Products', p.product_id, 'المنتج');
  var m = must_('Materials', p.material_id, 'الخامة');
  var unit = vUnit_(p.unit || m.base_unit, m.base_unit);
  var inQty = vNum_(p.qty, 'الكمية', { gt: 0, max: 1e7, required: true });
  var qBase = toBase_(inQty, unit, m.base_unit);
  if (!(qBase > 0)) throw new Error('الكمية صغيرة جدًا');
  var rec = { product_id: prod.id, material_id: m.id, qty_base: qBase, input_qty: inQty, input_unit: unit,
              notes: vStr_(p.notes, 'الملاحظات', 120, false), updated_at: now_() };
  if (p.id) {
    var cur = must_('Recipes', p.id, 'سطر الوصفة');
    if (cur.product_id !== prod.id) throw new Error('سطر الوصفة لا يخص هذا المنتج');
    update_('Recipes', cur.id, rec);
    log_('update', 'Recipe', cur.id, prod.name + ': ' + m.name + ' ' + inQty + ' ' + unit);
    return { id: cur.id };
  }
  var dup = rows_('Recipes').some(function (r) { return r.product_id === prod.id && r.material_id === m.id; });
  if (dup) throw new Error('"' + m.name + '" موجودة بالفعل في الوصفة — عدّل الكمية بدل الإضافة');
  rec.id = newId_('RCP'); rec.created_at = now_();
  insert_('Recipes', [rec]);
  update_('Products', prod.id, { updated_at: now_() });
  log_('create', 'Recipe', rec.id, prod.name + ': ' + m.name + ' ' + inQty + ' ' + unit);
  return { id: rec.id };
}

function deleteRecipeLine_(p) {
  var r = must_('Recipes', p.id, 'سطر الوصفة');
  log_('delete', 'Recipe', r.id, JSON.stringify({ product_id: r.product_id, material_id: r.material_id, qty_base: r.qty_base }));
  deleteRow_('Recipes', r.id);
  return { id: r.id };
}

function costContext_() {
  var mById = materialsById_();
  var byProd = {};
  rows_('Recipes').forEach(function (r) { (byProd[r.product_id] = byProd[r.product_id] || []).push(r); });
  return { mById: mById, byProd: byProd };
}
function costOf_(productRow, ctx) {
  return productCost_(productRow, ctx.byProd[productRow.id] || [], ctx.mById);
}

/* =========================== Orders =========================== */

var ORDER_FLOW_ = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['delivered', 'cancelled', 'draft'],
  delivered: ['cancelled'],
  cancelled: ['draft']
};

function parseOrderInput_(p) {
  var lines = Array.isArray(p.lines) ? p.lines : [];
  if (!lines.length) throw new Error('أضف منتجًا واحدًا على الأقل للطلب');
  if (lines.length > 60) throw new Error('عدد المنتجات في الطلب كبير جدًا');
  var parsed = lines.map(function (l, i) {
    var prod = must_('Products', l.product_id, 'المنتج في السطر ' + (i + 1));
    return { product: prod,
             qty: vNum_(l.qty, 'الكمية في السطر ' + (i + 1), { gt: 0, max: 1e6, int: true, required: true }),
             unit_price: vNum_(l.unit_price, 'السعر في السطر ' + (i + 1), { min: 0, max: 1e8, dflt: num_(prod.selling_price) }) };
  });
  var extras = (Array.isArray(p.extras) ? p.extras : []).slice(0, 15).map(function (e, i) {
    return { label: vStr_(e.label, 'وصف التكلفة الإضافية', 40, false) || 'تكلفة إضافية',
             amount: vNum_(e.amount, 'قيمة التكلفة الإضافية', { min: 0, max: 1e8 }) };
  }).filter(function (e) { return e.amount > 0; });
  return {
    lines: parsed, extras: extras,
    order_date: vDate_(p.order_date),
    customer: vStr_(p.customer, 'اسم العميل', 60, false),
    customer_phone: vPhone_(p.customer_phone),
    discount: vNum_(p.discount, 'الخصم', { min: 0, max: 1e8 }),
    charges: vNum_(p.charges, 'رسوم على العميل', { min: 0, max: 1e8 }),
    notes: vStr_(p.notes, 'الملاحظات', 300, false)
  };
}

function buildLines_(orderId, parsed, ctx, snapshot) {
  var t = now_();
  return parsed.lines.map(function (l) {
    var c = costOf_(l.product, ctx);
    return {
      id: newId_('OL'), order_id: orderId, product_id: l.product.id, product_name: l.product.name, qty: l.qty,
      unit_price: r2_(l.unit_price),
      unit_cost: snapshot ? r4_(c.total) : '', raw_cost: snapshot ? r4_(c.raw) : '',
      packaging_cost: snapshot ? r4_(c.packaging) : '', tool_cost: snapshot ? r4_(c.tool) : '',
      other_cost: snapshot ? r4_(c.other) : '',
      line_revenue: r2_(l.qty * l.unit_price), line_cost: snapshot ? r2_(l.qty * c.total) : '',
      created_at: t, _est: c.total
    };
  });
}

function saveOrder_(p) {
  var parsed = parseOrderInput_(p);
  var ctx = costContext_();
  var isNew = !p.id, order;
  if (!isNew) {
    order = must_('Orders', p.id, 'الطلب');
    if (order.status !== 'draft') throw new Error('الطلب المؤكد لا يمكن تعديله. أرجِعه لمسودة أولًا.');
  }
  var id = isNew ? newId_('ORD') : order.id;
  var lines = buildLines_(id, parsed, ctx, false);
  var tot = orderTotals_(lines.map(function (l) { return { qty: l.qty, unit_price: l.unit_price, unit_cost: l._est }; }),
                         parsed.extras, parsed.charges, parsed.discount);
  var rec = {
    order_date: parsed.order_date, customer: parsed.customer, customer_phone: parsed.customer_phone, discount: tot.discount, charges: tot.charges,
    extras_json: JSON.stringify(parsed.extras), notes: parsed.notes, items_revenue: tot.items_revenue,
    revenue: tot.revenue, product_cost: tot.product_cost, extra_cost: tot.extra_cost, profit: tot.profit,
    margin: tot.margin === null ? '' : tot.margin, updated_at: now_()
  };
  if (isNew) {
    rec.id = id; rec.order_no = 'N-' + ('0000' + nextCounter_('next_order_no')).slice(-4); rec.status = 'draft';
    rec.created_at = now_(); rec.confirmed_at = ''; rec.delivered_at = '';
    insert_('Orders', [rec]);
  } else {
    deleteOrderLines_(id);
    update_('Orders', id, rec);
  }
  insert_('OrderLines', lines);
  log_(isNew ? 'create' : 'update', 'Order', id, (rec.order_no || order.order_no) + ' ' + tot.revenue);
  if (p.confirm) {
    try { confirmOrder_(id, { produce: p.produce === true }); }
    catch (e) { return { id: id, confirmError: e.message, code: e.code || '', details: e.details || null }; }
  }
  return { id: id };
}

function deleteOrderLines_(orderId) {
  var sh = sheet_('OrderLines');
  var rowsToDelete = rows_('OrderLines').filter(function (l) { return l.order_id === orderId; })
    .map(function (l) { return l._row; }).sort(function (a, b) { return b - a; });
  rowsToDelete.forEach(function (r) { sh.deleteRow(r); });
  delete _T['OrderLines'];
}

/** Quantity of each product in an order: [{product, qty}] */
function orderProductQty_(orderId) {
  var acc = {}, order = [];
  rows_('OrderLines').filter(function (l) { return l.order_id === orderId; }).forEach(function (l) {
    if (!acc[l.product_id]) { acc[l.product_id] = { product_id: l.product_id, name: l.product_name, qty: 0 }; order.push(acc[l.product_id]); }
    acc[l.product_id].qty += num_(l.qty);
  });
  return order;
}

/** Ready products missing for an order: [{product_id, name, need, stock, short}] */
function productShortage_(orderId) {
  return orderProductQty_(orderId).map(function (x) {
    var prod = find_('Products', x.product_id);
    var stock = prod ? num_(prod.stock) : 0;
    return { product_id: x.product_id, name: prod ? prod.name : x.name, need: x.qty, stock: stock,
             short: Math.max(0, x.qty - Math.max(0, stock)) };
  }).filter(function (x) { return x.short > 0; });
}

/** Ready products leave (sign = -1) or come back to (sign = +1) the products store for an order. */
function moveOrderStock_(order, sign, type) {
  orderProductQty_(order.id).forEach(function (x) {
    var prod = find_('Products', x.product_id);
    if (!prod) return;
    var after = num_(prod.stock) + sign * x.qty;
    update_('Products', prod.id, { stock: after, updated_at: now_() });
    movement_({ item_type: 'product', item_id: prod.id, item_name: prod.name, type: type, qty: sign * x.qty,
                unit_cost: costOf_(prod, costContext_()).total, stock_after: after, ref_type: 'order', ref_id: order.id,
                notes: order.order_no });
  });
  update_('Orders', order.id, { stock_out: sign < 0 });
}

/**
 * Confirm = the sale happens: prices & costs are frozen (later price changes never touch it) and the
 * sold pieces leave the products store. If pieces are missing, nothing changes unless opts.produce is
 * true — then the missing pieces are produced first (materials are checked for ALL of them before
 * anything is written).
 */
function confirmOrder_(id, opts) {
  opts = opts || {};
  var order = must_('Orders', id, 'الطلب');
  if (order.status !== 'draft') throw new Error('الطلب ليس مسودة');
  var lines = rows_('OrderLines').filter(function (l) { return l.order_id === id; });
  if (!lines.length) throw new Error('الطلب فارغ');

  var short = productShortage_(id);
  if (short.length && !opts.produce) {
    var e1 = new Error('المنتجات الجاهزة في المخزن مش كفاية للطلب');
    e1.code = 'PRODUCT_SHORT'; e1.details = short; throw e1;
  }
  if (short.length) {
    var ctx0 = costContext_();
    short.forEach(function (x) {
      if (!(ctx0.byProd[x.product_id] || []).length) throw new Error('"' + x.name + '" ملوش وصفة، مينفعش يتنتج تلقائي');
    });
    var needM = requiredMaterials_(short.map(function (x) { return { product_id: x.product_id, qty: x.short }; }), ctx0.byProd, ctx0.mById)
      .filter(function (n) { return n.short > 1e-9; });
    if (needM.length) {
      var e2 = new Error('الخامات مش كفاية لإنتاج القطع الناقصة');
      e2.code = 'MATERIAL_SHORT'; e2.details = needM; throw e2;
    }
    short.forEach(function (x) {
      recordProduction_({ product_id: x.product_id, qty: x.short, notes: 'إنتاج لطلب ' + order.order_no });
    });
  }

  var ctx = costContext_();
  var forTotals = [];
  lines.forEach(function (l) {
    var prod = find_('Products', l.product_id);
    var c = prod ? costOf_(prod, ctx) : { total: 0, raw: 0, packaging: 0, tool: 0, other: 0 };
    update_('OrderLines', l.id, { unit_cost: r4_(c.total), raw_cost: r4_(c.raw), packaging_cost: r4_(c.packaging),
      tool_cost: r4_(c.tool), other_cost: r4_(c.other), line_cost: r2_(num_(l.qty) * c.total),
      product_name: prod ? prod.name : l.product_name });
    forTotals.push({ qty: l.qty, unit_price: l.unit_price, unit_cost: r4_(c.total) });
  });
  var extras = safeJson_(order.extras_json, []);
  var tot = orderTotals_(forTotals, extras, order.charges, order.discount);
  update_('Orders', id, { status: 'confirmed', confirmed_at: now_(), items_revenue: tot.items_revenue,
    revenue: tot.revenue, product_cost: tot.product_cost, extra_cost: tot.extra_cost, profit: tot.profit,
    margin: tot.margin === null ? '' : tot.margin, updated_at: now_() });
  moveOrderStock_(order, -1, 'SALE');
  log_('confirm', 'Order', id, order.order_no + ' ربح ' + tot.profit);
  return { id: id, produced: short };
}

function isTrue_(v) { return v === true || v === 'TRUE' || v === 'true'; }

function setOrderStatus_(p) {
  var order = must_('Orders', p.id, 'الطلب');
  var to = String(p.status || '');
  if ((ORDER_FLOW_[order.status] || []).indexOf(to) === -1) throw new Error('لا يمكن تغيير حالة الطلب بهذا الشكل');
  if (to === 'confirmed') return confirmOrder_(order.id, { produce: p.produce === true });
  // Cancelled or re-opened: pieces that left the store come back (only once, guarded by stock_out).
  if ((to === 'cancelled' || to === 'draft') && isTrue_(order.stock_out)) moveOrderStock_(order, +1, 'SALE_RETURN');
  var patch = { status: to, updated_at: now_() };
  if (to === 'draft') {                        // re-open: snapshot is cleared, costs become live estimates again
    patch.confirmed_at = '';
    patch.delivered_at = '';
    rows_('OrderLines').filter(function (l) { return l.order_id === order.id; }).forEach(function (l) {
      update_('OrderLines', l.id, { unit_cost: '', raw_cost: '', packaging_cost: '', tool_cost: '', other_cost: '', line_cost: '' });
    });
  }
  if (to === 'delivered') patch.delivered_at = now_();
  update_('Orders', order.id, patch);
  log_('status', 'Order', order.id, order.order_no + ' → ' + to);
  return { id: order.id };
}

/** One-time data fixes after upgrades (safe to run many times). */
function migrate_() {
  // v1.2.0: before this version stock left the store at delivery; mark those orders as already out.
  rows_('Orders').forEach(function (o) {
    if (o.stock_out === '' || o.stock_out === null || o.stock_out === undefined) {
      update_('Orders', o.id, { stock_out: o.status === 'delivered' });
    }
  });
}

function safeJson_(s, dflt) { try { return s ? JSON.parse(s) : dflt; } catch (e) { return dflt; } }

/* =========================== Production =========================== */

function recordProduction_(p) {
  var prod = must_('Products', p.product_id, 'المنتج');
  var qty = vNum_(p.qty, 'عدد القطع', { gt: 0, max: 1e6, int: true, required: true });
  var ctx = costContext_();
  var lines = ctx.byProd[prod.id] || [];
  if (!lines.length) throw new Error('المنتج ليس له وصفة. أضف الوصفة أولًا.');
  var need = requiredMaterials_([{ product_id: prod.id, qty: qty }], ctx.byProd, ctx.mById);
  var short = need.filter(function (n) { return n.short > 1e-9; });
  if (short.length) {
    var err = new Error('الخامات غير كافية لإنتاج ' + qty + ' قطعة');
    err.details = short;
    throw err;
  }
  var cost = costOf_(prod, ctx);
  var date = vDate_(p.date);
  var id = newId_('BAT');
  var batchNo = 'B-' + ('0000' + nextCounter_('next_batch_no')).slice(-4);
  need.forEach(function (n) {
    var m = ctx.mById[n.material_id];
    var after = r6_(num_(m.stock) - n.need);
    update_('Materials', m.id, { stock: after, updated_at: now_() });
    movement_({ date: date, item_id: m.id, item_name: m.name, type: 'CONSUME', qty: -n.need, unit_cost: m.avg_cost,
                stock_after: after, ref_type: 'production', ref_id: id, notes: batchNo });
  });
  var pAfter = num_(prod.stock) + qty;
  update_('Products', prod.id, { stock: pAfter, updated_at: now_() });
  movement_({ date: date, item_type: 'product', item_id: prod.id, item_name: prod.name, type: 'PRODUCE', qty: qty,
              unit_cost: cost.total, stock_after: pAfter, ref_type: 'production', ref_id: id, notes: batchNo });
  insert_('Production', [{ id: id, batch_no: batchNo, prod_date: date, product_id: prod.id, product_name: prod.name, qty: qty,
    unit_cost: r4_(cost.total), total_cost: r2_(cost.total * qty),
    materials_json: JSON.stringify(need.map(function (n) { return { id: n.material_id, name: n.name, qty: n.need, unit: n.base_unit,
      unit_cost: r6_(ctx.mById[n.material_id].avg_cost) }; })),
    notes: vStr_(p.notes, 'الملاحظات', 200, false), status: 'active', created_at: now_() }]);
  log_('create', 'Production', id, batchNo + ' ' + prod.name + ' × ' + qty);
  return { id: id };
}

function reverseProduction_(p) {
  var b = must_('Production', p.id, 'دفعة الإنتاج');
  if (b.status === 'reversed') throw new Error('تم إلغاء هذه الدفعة من قبل');
  var mats = safeJson_(b.materials_json, []);
  mats.forEach(function (x) {
    var m = find_('Materials', x.id);
    if (!m) return;
    var avg = weightedAvg_(m.stock, m.avg_cost, x.qty, x.qty * x.unit_cost);
    var after = r6_(num_(m.stock) + num_(x.qty));
    update_('Materials', m.id, { stock: after, avg_cost: r6_(avg), updated_at: now_() });
    movement_({ item_id: m.id, item_name: m.name, type: 'CONSUME_REVERSAL', qty: x.qty, unit_cost: x.unit_cost,
                stock_after: after, ref_type: 'production', ref_id: b.id, notes: 'إلغاء ' + b.batch_no });
  });
  var prod = find_('Products', b.product_id);
  if (prod) {
    var pAfter = num_(prod.stock) - num_(b.qty);
    update_('Products', prod.id, { stock: pAfter, updated_at: now_() });
    movement_({ item_type: 'product', item_id: prod.id, item_name: prod.name, type: 'PRODUCE_REVERSAL', qty: -num_(b.qty),
                unit_cost: b.unit_cost, stock_after: pAfter, ref_type: 'production', ref_id: b.id, notes: 'إلغاء ' + b.batch_no });
  }
  update_('Production', b.id, { status: 'reversed' });
  log_('reverse', 'Production', b.id, b.batch_no);
  return { id: b.id };
}

/* =========================== Settings =========================== */

function saveSettings_(p) {
  setSetting_('business_name', vStr_(p.business_name, 'اسم المشروع', 40, true));
  setSetting_('target_margin', vNum_(p.target_margin, 'هامش الربح المستهدف', { min: 0, max: 95 }));
  log_('update', 'Settings', '', 'settings');
  return {};
}

/* =========================== Read model for the app =========================== */

function pub_(r) {
  var o = {};
  Object.keys(r).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = r[k]; });
  return o;
}

function bootstrap_() {
  var ctx = costContext_();
  var materials = rows_('Materials').map(function (r) { var o = pub_(r); o.image_url = imageUrl_(r.image_id); return o; });
  var recipes = rows_('Recipes').map(pub_);
  var prodCost = {};
  var products = rows_('Products').map(function (r) {
    var o = pub_(r);
    o.cost = costOf_(r, ctx);
    prodCost[r.id] = o.cost;
    o.image_url = imageUrl_(r.image_id);
    return o;
  });
  var linesByOrder = {};
  rows_('OrderLines').forEach(function (l) { (linesByOrder[l.order_id] = linesByOrder[l.order_id] || []).push(pub_(l)); });
  var orders = rows_('Orders').slice().reverse().slice(0, 400).map(function (r) {
    var o = pub_(r);
    o.lines = linesByOrder[r.id] || [];
    o.extras = safeJson_(r.extras_json, []);
    o.invoice_url = r.invoice_file_id ? 'https://drive.google.com/file/d/' + r.invoice_file_id + '/view?usp=sharing' : '';
    delete o.extras_json;
    if (o.status === 'draft') {                                   // live estimate with today's costs
      o.lines.forEach(function (l) {
        var c = prodCost[l.product_id];
        l.unit_cost = c ? c.total : 0; l.line_cost = r2_(num_(l.qty) * l.unit_cost); l.estimated = true;
      });
      var t = orderTotals_(o.lines, o.extras, o.charges, o.discount);
      o.items_revenue = t.items_revenue; o.revenue = t.revenue; o.product_cost = t.product_cost;
      o.extra_cost = t.extra_cost; o.profit = t.profit; o.margin = t.margin; o.estimated = true;
    }
    return o;
  });
  var settings = {};
  rows_('Settings').forEach(function (s) { settings[s.key] = s.value; });
  return {
    version: APP.VERSION,
    today: today_(),
    settings: settings,
    materials: materials,
    products: products,
    recipes: recipes,
    orders: orders,
    purchases: rows_('Purchases').slice().reverse().slice(0, 300).map(pub_),
    production: rows_('Production').slice().reverse().slice(0, 300).map(function (r) {
      var o = pub_(r); o.materials = safeJson_(r.materials_json, []); delete o.materials_json; return o; }),
    movements: rows_('Movements').slice().reverse().slice(0, 500).map(pub_),
    units: UNITS, kinds: KINDS
  };
}

/* =========================== Seed data =========================== */

function seed_() {
  var t = now_();
  insert_('Settings', [
    { key: 'business_name', value: 'نوديلا' },
    { key: 'target_margin', value: 50 },
    { key: 'next_order_no', value: 1 },
    { key: 'next_batch_no', value: 1 },
    { key: 'currency', value: 'ج.م' }
  ]);
  // Known historical sample prices from the owner (editable at any time).
  var mats = [
    { name: 'شمع عسل', category: 'شمع', kind: 'raw', base_unit: 'g', price: [300, 1, 'kg'] },
    { name: 'فتيل قطن', category: 'فتايل', kind: 'raw', base_unit: 'cm', price: [300, 60, 'm'] },
    { name: 'لون سائل', category: 'ألوان', kind: 'raw', base_unit: 'ml', price: [35, 10, 'ml'] },
    { name: 'قالب شمعة الشمعدان', category: 'قوالب', kind: 'tool', base_unit: 'pcs', price: [200, 1, 'pcs'], life: 100, stock: 1 }
  ];
  var ids = {};
  mats.forEach(function (m) {
    var id = newId_('MAT');
    ids[m.name] = id;
    var avg = pricePerBase_(m.price[0], m.price[1], m.price[2], m.base_unit);
    insert_('Materials', [{ id: id, name: m.name, category: m.category, kind: m.kind, base_unit: m.base_unit,
      stock: m.stock || 0, avg_cost: avg, min_stock: 0, life_units: m.life || '', supplier: '',
      notes: 'سعر تاريخي مبدئي — عدّله حسب آخر شراء', active: true, created_at: t, updated_at: t }]);
  });
  var prods = ['شمعة الشمعدان', 'شمعة جوري', 'شمعة الخروف', 'شمعة الكابلز'];
  prods.forEach(function (n, i) {
    var id = newId_('PRD');
    insert_('Products', [{ id: id, name: n, category: 'شموع', selling_price: 0, other_cost: 0, other_cost_label: '',
      image_id: '', stock: 0, notes: '', active: true, created_at: t, updated_at: t }]);
    if (i === 0) {
      insert_('Recipes', [
        { id: newId_('RCP'), product_id: id, material_id: ids['شمع عسل'], qty_base: 65, input_qty: 65, input_unit: 'g', notes: '', created_at: t, updated_at: t },
        { id: newId_('RCP'), product_id: id, material_id: ids['فتيل قطن'], qty_base: 25, input_qty: 25, input_unit: 'cm', notes: '', created_at: t, updated_at: t }
      ]);
    }
  });
  log_('setup', 'System', '', 'تجهيز النظام لأول مرة');
}
