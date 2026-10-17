/**
 * Noudella — Costing Engine (pure functions, no Google services).
 * All quantities are stored in BASE units: g (mass), ml (volume), cm (length), pcs (count).
 * Material avg_cost is always "EGP per ONE base unit".
 * Function names end with "_" so they can never be called from the browser.
 */

var UNITS = {
  mg:    { dim: 'mass',   f: 0.001, ar: 'مللي جرام' },
  g:     { dim: 'mass',   f: 1,     ar: 'جرام' },
  kg:    { dim: 'mass',   f: 1000,  ar: 'كيلو' },
  ml:    { dim: 'volume', f: 1,     ar: 'مللي' },
  l:     { dim: 'volume', f: 1000,  ar: 'لتر' },
  mm:    { dim: 'length', f: 0.1,   ar: 'مللي متر' },
  cm:    { dim: 'length', f: 1,     ar: 'سم' },
  m:     { dim: 'length', f: 100,   ar: 'متر' },
  pcs:   { dim: 'count',  f: 1,     ar: 'قطعة' },
  dozen: { dim: 'count',  f: 12,    ar: 'دستة' }
};
var BASE_UNITS = { g: 'mass', ml: 'volume', cm: 'length', pcs: 'count' };
var KINDS = { raw: 'خامات', packaging: 'تغليف', tool: 'أدوات وقوالب' };

function num_(v) {
  if (v === null || v === undefined || v === '') return 0;
  var n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : 0;
}
function r2_(n) { return Math.round((num_(n) + Number.EPSILON) * 100) / 100; }
function r4_(n) { return Math.round((num_(n) + Number.EPSILON) * 10000) / 10000; }
function r6_(n) { return Math.round((num_(n) + Number.EPSILON) * 1e6) / 1e6; }

/** Convert qty in "unit" to the material's base unit. Throws on incompatible units. */
function toBase_(qty, unit, baseUnit) {
  var u = UNITS[unit], b = UNITS[baseUnit];
  if (!u) throw new Error('وحدة غير معروفة');
  if (!b || !BASE_UNITS[baseUnit]) throw new Error('وحدة الخامة غير صحيحة');
  if (u.dim !== b.dim) throw new Error('الوحدة "' + u.ar + '" لا تناسب هذه الخامة (وحدتها ' + b.ar + ')');
  return r6_(num_(qty) * u.f / b.f);
}

/** Price "amount EGP for qty unit" -> EGP per base unit. */
function pricePerBase_(amount, qty, unit, baseUnit) {
  var q = toBase_(qty, unit, baseUnit);
  if (!(q > 0)) throw new Error('الكمية يجب أن تكون أكبر من صفر');
  if (num_(amount) < 0) throw new Error('السعر لا يمكن أن يكون سالبًا');
  return num_(amount) / q;
}

/** Weighted-average cost after a purchase. */
function weightedAvg_(oldQty, oldAvg, addQty, addTotalCost) {
  oldQty = num_(oldQty); oldAvg = num_(oldAvg); addQty = num_(addQty); addTotalCost = num_(addTotalCost);
  if (!(addQty > 0)) return oldAvg;
  if (oldQty <= 0) return addTotalCost / addQty;          // no valid old stock -> new price wins
  return (oldQty * oldAvg + addTotalCost) / (oldQty + addQty);
}

/**
 * Cost of ONE unit of a product.
 * recipeLines: [{id, material_id, qty_base, ...}]
 * materialsById: {id: {name, kind, base_unit, avg_cost, life_units, active}}
 * Tools (kind=tool) are allocated: avg_cost / life_units per use, never consumed from stock.
 */
function productCost_(product, recipeLines, materialsById) {
  var res = { raw: 0, packaging: 0, tool: 0, other: r4_(num_(product.other_cost)), total: 0,
              lines: [], warnings: [], price: num_(product.selling_price), profit: 0, margin: null };
  (recipeLines || []).forEach(function (ln) {
    var m = materialsById[ln.material_id];
    var line = { id: ln.id, material_id: ln.material_id, qty_base: num_(ln.qty_base),
                 input_qty: ln.input_qty, input_unit: ln.input_unit, notes: ln.notes || '' };
    if (!m) {
      line.name = '(خامة محذوفة)'; line.kind = 'raw'; line.unit_cost = 0; line.cost = 0;
      res.warnings.push('خامة غير موجودة في الوصفة');
      res.lines.push(line); return;
    }
    line.name = m.name; line.kind = KINDS[m.kind] ? m.kind : 'raw'; line.base_unit = m.base_unit;
    var unitCost = num_(m.avg_cost);
    if (line.kind === 'tool') {
      var life = num_(m.life_units);
      if (life > 0) unitCost = unitCost / life;
      else { unitCost = 0; res.warnings.push('حدد عدد مرات استخدام "' + m.name + '" لحساب نصيب القطعة'); }
    }
    if (!(num_(m.avg_cost) > 0)) res.warnings.push('سعر "' + m.name + '" غير مسجل');
    line.unit_cost = unitCost;
    line.cost = r4_(unitCost * line.qty_base);
    res[line.kind] += line.cost;
    res.lines.push(line);
  });
  if (!res.lines.length) res.warnings.push('لا توجد وصفة لهذا المنتج');
  res.raw = r4_(res.raw); res.packaging = r4_(res.packaging); res.tool = r4_(res.tool);
  res.total = r4_(res.raw + res.packaging + res.tool + res.other);
  res.profit = r4_(res.price - res.total);
  res.margin = res.price > 0 ? r4_(res.profit / res.price) : null;
  return res;
}

/**
 * Materials needed to make "qty" units (tools excluded: they are not consumed).
 * Returns [{material_id, name, base_unit, need, stock, short}]
 */
function requiredMaterials_(items, recipesByProduct, materialsById) {
  var acc = {};
  (items || []).forEach(function (it) {
    var q = num_(it.qty);
    (recipesByProduct[it.product_id] || []).forEach(function (ln) {
      var m = materialsById[ln.material_id];
      if (!m || m.kind === 'tool') return;
      if (!acc[m.id]) acc[m.id] = { material_id: m.id, name: m.name, base_unit: m.base_unit, need: 0,
                                    stock: num_(m.stock), avg_cost: num_(m.avg_cost) };
      acc[m.id].need += num_(ln.qty_base) * q;
    });
  });
  return Object.keys(acc).map(function (k) {
    var a = acc[k]; a.need = r6_(a.need); a.short = r6_(Math.max(0, a.need - a.stock));
    a.value = r2_(a.need * a.avg_cost); return a;
  });
}

/**
 * Order totals.
 * lines: [{qty, unit_price, unit_cost}] ; extras: [{label, amount}] costs paid by the business;
 * charges: amount collected from customer on top (e.g. delivery fee); discount: amount off.
 */
function orderTotals_(lines, extras, charges, discount) {
  var t = { items_revenue: 0, product_cost: 0, extra_cost: 0, charges: r2_(Math.max(0, num_(charges))),
            discount: r2_(Math.max(0, num_(discount))), revenue: 0, profit: 0, margin: null, qty: 0 };
  (lines || []).forEach(function (l) {
    var q = num_(l.qty);
    t.qty += q;
    t.items_revenue += q * num_(l.unit_price);
    t.product_cost += q * num_(l.unit_cost);
  });
  (extras || []).forEach(function (e) { t.extra_cost += Math.max(0, num_(e.amount)); });
  t.items_revenue = r2_(t.items_revenue);
  t.product_cost = r2_(t.product_cost);
  t.extra_cost = r2_(t.extra_cost);
  t.revenue = r2_(t.items_revenue + t.charges - t.discount);
  t.profit = r2_(t.revenue - t.product_cost - t.extra_cost);
  t.margin = t.revenue > 0 ? r4_(t.profit / t.revenue) : null;
  return t;
}

if (typeof module !== 'undefined') {
  module.exports = { UNITS: UNITS, BASE_UNITS: BASE_UNITS, KINDS: KINDS, num_: num_, r2_: r2_, r4_: r4_,
    toBase_: toBase_, pricePerBase_: pricePerBase_, weightedAvg_: weightedAvg_, productCost_: productCost_,
    requiredMaterials_: requiredMaterials_, orderTotals_: orderTotals_ };
}
