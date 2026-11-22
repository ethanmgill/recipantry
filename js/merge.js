/**
 * Pantry Snap: duplicate matching and merging.
 *
 * Rules:
 *  - Two items are "the same" when their names match and their units match.
 *    Case, punctuation, extra spaces and simple plurals are ignored ("Canned Tuna" = "canned tunas").
 *    Brand is ignored.
 *  - Units must match (2 cans + 400 g can't be added). "tin" counts as "can", "pieces" as "pcs", etc.
 *  - Merging adds quantities and keeps the EARLIEST expiry date.
 *    The existing row keeps its id, photo, nutrition and date added.
 */

/** Very small singulariser, good enough for grocery words. Applied identically to both sides. */
function singular(word) {
  if (word.length <= 3) return word;
  if (/ies$/.test(word)) return word.slice(0, -3) + 'y';               // berries -> berry
  if (/(ches|shes|xes|sses|oes)$/.test(word)) return word.slice(0, -2); // tomatoes -> tomato
  if (/[^s]s$/.test(word)) return word.slice(0, -1);                    // cans -> can
  return word;
}

export function normName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/).filter(Boolean)
    .map(singular)
    .join(' ');
}

const UNIT_ALIASES = {
  pc: 'pc', pcs: 'pc', piece: 'pc', pieces: 'pc', item: 'pc', items: 'pc', each: 'pc', x: 'pc', '': 'pc',
  can: 'can', cans: 'can', tin: 'can', tins: 'can',
  g: 'g', gram: 'g', grams: 'g', gr: 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  ml: 'ml', millilitre: 'ml', milliliter: 'ml',
  l: 'l', litre: 'l', liter: 'l', litres: 'l', liters: 'l', ltr: 'l',
  pack: 'pack', packs: 'pack', packet: 'pack', packets: 'pack', pkg: 'pack',
};

export function normUnit(unit) {
  const u = String(unit || '').toLowerCase().trim().replace(/\.$/, '');
  return UNIT_ALIASES[u] ?? singular(u);
}

/** Matching key: same key = same item. */
export function itemKey(item) {
  return normName(item.name) + '|' + normUnit(item.unit);
}

/** Earliest of two YYYY-MM-DD dates (null-safe). */
function earliest(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a < b ? a : b; // ISO dates compare correctly as strings
}

/** Merge `source` into `target` in place. Returns target. */
export function mergeInto(target, source) {
  const q = (target.quantity || 0) + (source.quantity || 0);
  target.quantity = Number(q.toFixed(3));
  target.expiry = earliest(target.expiry, source.expiry);
  if (!target.brand && source.brand) target.brand = source.brand;
  if (!target.thumb && source.thumb) target.thumb = source.thumb;
  return target;
}

/**
 * Groups of duplicate rows in a list (only groups with 2+ rows).
 * Each group is ordered oldest-added first; the first row is the one kept.
 */
export function findDuplicateGroups(items) {
  const byKey = new Map();
  for (const it of items) {
    const k = itemKey(it);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(it);
  }
  return [...byKey.values()]
    .filter(g => g.length > 1)
    .map(g => g.sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || '')));
}

/** Merge every duplicate group. Returns { items: newList, removed: number }. Doesn't save. */
export function mergeAllDuplicates(items) {
  const list = items.map(i => ({ ...i }));
  const groups = findDuplicateGroups(list);
  const drop = new Set();
  for (const [keep, ...rest] of groups) {
    for (const r of rest) { mergeInto(keep, r); drop.add(r.id); }
  }
  return { items: list.filter(i => !drop.has(i.id)), removed: drop.size };
}
