// Minimal in-memory mock of the Google Apps Script services used by Noudella (for local testing only).
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function makeEnv() {
  const files = {}; let fileSeq = 0;
  const spreadsheets = {};

  function chain(obj) { ['setFontWeight', 'setBackground', 'setFontColor', 'setNumberFormat'].forEach(k => obj[k] = () => obj); return obj; }

  function Sheet(name) {
    this.name = name; this.grid = []; this.maxRows = 1000; this.maxCols = 26;
  }
  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.getMaxRows = function () { return this.maxRows; };
  Sheet.prototype.getMaxColumns = function () { return this.maxCols; };
  Sheet.prototype.getLastRow = function () {
    for (let r = this.grid.length - 1; r >= 0; r--) if ((this.grid[r] || []).some(v => v !== '' && v !== undefined)) return r + 1;
    return 0;
  };
  Sheet.prototype.getLastColumn = function () {
    let m = 0; this.grid.forEach(row => (row || []).forEach((v, i) => { if (v !== '' && v !== undefined) m = Math.max(m, i + 1); })); return m;
  };
  Sheet.prototype.insertRowsAfter = function (after, n) { this.maxRows += n; };
  Sheet.prototype.insertColumnsAfter = function (after, n) { this.maxCols += n; };
  Sheet.prototype.deleteColumns = function (start, n) { this.maxCols -= n; };
  Sheet.prototype.setFrozenRows = function () {};
  Sheet.prototype.deleteRow = function (r) { this.grid.splice(r - 1, 1); };
  Sheet.prototype.getRange = function (row, col, nr = 1, nc = 1) {
    const sh = this;
    if (row < 1 || col < 1) throw new Error('bad range');
    if (row + nr - 1 > sh.maxRows) throw new Error('Range outside sheet rows');
    if (col + nc - 1 > sh.maxCols) throw new Error('Range outside sheet cols');
    return chain({
      getValues() {
        const out = [];
        for (let r = 0; r < nr; r++) { const line = []; for (let c = 0; c < nc; c++) { const v = (sh.grid[row - 1 + r] || [])[col - 1 + c]; line.push(v === undefined ? '' : v); } out.push(line); }
        return out;
      },
      setValues(vals) {
        if (vals.length !== nr || vals.some(v => v.length !== nc)) throw new Error('setValues dimension mismatch');
        for (let r = 0; r < nr; r++) {
          sh.grid[row - 1 + r] = sh.grid[row - 1 + r] || [];
          for (let c = 0; c < nc; c++) {
            let v = vals[r][c];
            if (typeof v === 'string' && v.startsWith('=')) throw new Error('FORMULA WRITTEN: ' + v);
            if (typeof v === 'string' && v.startsWith("'")) { sh.rawApostrophe = (sh.rawApostrophe || 0) + 1; v = v.slice(1); }
            sh.grid[row - 1 + r][col - 1 + c] = v;
          }
        }
        return this;
      },
      setValue(v) { return this.setValues([[v]]); }
    });
  };

  function Spreadsheet(name) {
    this.id = 'SS' + (++fileSeq); this.name = name; this.sheets = [new Sheet('Sheet1')];
    spreadsheets[this.id] = this; files[this.id] = { id: this.id, name };
  }
  Spreadsheet.prototype.getId = function () { return this.id; };
  Spreadsheet.prototype.getUrl = function () { return 'https://docs.google.com/spreadsheets/d/' + this.id; };
  Spreadsheet.prototype.getSheetByName = function (n) { return this.sheets.find(s => s.name === n) || null; };
  Spreadsheet.prototype.insertSheet = function (n) { const s = new Sheet(n); this.sheets.push(s); return s; };
  Spreadsheet.prototype.getSheets = function () { return this.sheets.slice(); };
  Spreadsheet.prototype.deleteSheet = function (s) { this.sheets = this.sheets.filter(x => x !== s); };
  Spreadsheet.prototype.setSpreadsheetTimeZone = function () {};

  function Folder(name) { this.id = 'F' + (++fileSeq); this.name = name; this.children = []; this.files = []; files[this.id] = this; }
  Folder.prototype.getId = function () { return this.id; };
  Folder.prototype.getFoldersByName = function (n) { const l = this.children.filter(f => f.name === n); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; };
  Folder.prototype.createFolder = function (n) { const f = new Folder(n); this.children.push(f); return f; };
  Folder.prototype.getFiles = function () { const l = this.files; let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; };
  Folder.prototype.createFile = function (blob) { const f = fileObj('IMG' + (++fileSeq), blob.name); this.files.push(f); return f; };
  const root = new Folder('root');

  function fileObj(id, name) {
    return { id, name, created: new Date(), getId: () => id, getName: () => name, getDateCreated() { return this.created; },
      moveTo(folder) { folder.files.push(this); }, setTrashed() { this.trashed = true; }, setSharing() { this.shared = true; },
      makeCopy(n, folder) { const c = fileObj('COPY' + (++fileSeq), n); folder.files.push(c); return c; } };
  }

  const props = {}; const cache = {};
  const ctx = {
    console, JSON, Math, Date, Number, String, Array, Object, isFinite, Error, encodeURIComponent,
    SpreadsheetApp: {
      create: n => new Spreadsheet(n),
      openById: id => { if (!spreadsheets[id]) throw new Error('not found'); return spreadsheets[id]; },
      flush: () => {}
    },
    DriveApp: {
      getRootFolder: () => root,
      getFileById: id => fileObj(id, (files[id] || {}).name || id),
      getFolderById: id => files[id],
      Access: { ANYONE_WITH_LINK: 'A' }, Permission: { VIEW: 'V' }
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); },
      setProperties: o => Object.assign(props, o) }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, fmt) => {
        const p = n => String(n).padStart(2, '0');
        return fmt.replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1)).replace('dd', p(d.getDate()))
          .replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes())).replace('ss', p(d.getSeconds()));
      },
      base64Decode: s => Buffer.from(s, 'base64'),
      newBlob: (b, m, n) => ({ bytes: b, mime: m, name: n })
    },
    ScriptApp: { getScriptId: () => 'SCRIPT', getProjectTriggers: () => [],
      newTrigger: () => ({ timeBased() { return this; }, everyDays() { return this; }, atHour() { return this; }, create() {} }) },
    HtmlService: { createHtmlOutputFromFile: () => ({}), createHtmlOutput: () => ({ setTitle() { return this; } }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ text: t, setMimeType() { return this; }, getContent() { return t; } }) },
    _spreadsheets: spreadsheets, _props: props
  };
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..');
  ['Engine.gs', 'Code.gs'].forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
  return ctx;
}

module.exports = { makeEnv };
