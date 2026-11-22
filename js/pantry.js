/**
 * Pantry Snap: Pantry tab (works without an API key).
 * Search, category filter, sort, +/− quantity, edit, delete, expiry highlights,
 * JSON backup export/import and a "storage nearly full" warning.
 */
import { CONFIG, CATEGORIES } from './config.js';
import { Inventory, StorageFullError, bytesUsed } from './storage.js';
import { expiryInfo, daysUntil } from './dates.js';
import { exportBackup, readBackupFile, applyImport } from './backup.js';
import { findDuplicateGroups, mergeAllDuplicates, mergeInto, normUnit } from './merge.js';
import { $, esc, toast } from './ui.js';

/** View state kept while the app is open. */
const ui = {
  q: '', cat: 'All', sort: 'added', open: null, editing: null, pendingImport: null, reviewMerge: false,
  // Manual merge: null (off) | 'select' (pick items, yellow) | 'parent' (pick the one to keep, blue)
  mergeMode: null, selected: new Set(), parent: null,
};
let root = null;
let app = null;

export function renderPantry(el, appApi) {
  root = el;
  app = appApi;
  resetMerge(); // coming back to the tab always starts outside merge mode
  el.innerHTML = `
    <h1 class="view-title">Pantry</h1>
    <div id="storage-warn"></div>
    <div class="toolbar">
      <input id="pantry-search" type="search" placeholder="Search pantry" aria-label="Search pantry"
             value="${esc(ui.q)}" autocomplete="off">
      <select id="pantry-sort" aria-label="Sort">
        <option value="added">Newest first</option>
        <option value="expiry">Expiring soonest</option>
        <option value="name">Name A–Z</option>
      </select>
    </div>
    <div id="cat-chips" class="chips" role="group" aria-label="Filter by category"></div>
    <div class="summary-row">
      <p id="pantry-summary" class="summary"></p>
      <button class="btn small" id="merge-start">Merge items</button>
    </div>
    <div id="merge-head"></div>
    <div id="dup-box"></div>
    <div id="pantry-list"></div>
    <div id="merge-bar" class="action-bar" hidden></div>

    <section class="card backup">
      <h2>Backup</h2>
      <p class="muted">Save your pantry and recipes to a file, or restore from one. Your API key is never included.</p>
      <div class="btn-grid">
        <button class="btn" data-act="export">Export JSON</button>
        <label class="btn">Import JSON
          <input id="import-input" class="sr-only" type="file" accept="application/json,.json">
        </label>
      </div>
      <div id="import-prompt"></div>
    </section>`;

  $('#pantry-sort', el).value = ui.sort;
  $('#pantry-search', el).addEventListener('input', (e) => { ui.q = e.target.value; renderList(); });
  $('#pantry-sort', el).addEventListener('change', (e) => { ui.sort = e.target.value; renderList(); });
  $('#cat-chips', el).addEventListener('click', (e) => {
    const chip = e.target.closest('[data-cat]');
    if (chip) { ui.cat = chip.dataset.cat; renderList(); }
  });
  $('#pantry-list', el).addEventListener('click', onListClick);
  $('#dup-box', el).addEventListener('click', onDupClick);
  $('#merge-start', el).addEventListener('click', () => {
    ui.mergeMode = 'select';
    ui.open = ui.editing = null;
    renderList();
  });
  $('#merge-bar', el).addEventListener('click', onMergeBarClick);
  $('#pantry-list', el).addEventListener('submit', onEditSubmit);
  el.querySelector('.backup').addEventListener('click', onBackupClick);
  $('#import-input', el).addEventListener('change', onImportFile);

  renderList();
  renderImportPrompt();
}

/* ---------------- List ---------------- */

function sortItems(items) {
  const byAdded = (a, b) => (b.addedAt || '').localeCompare(a.addedAt || '');
  if (ui.sort === 'name') return items.sort((a, b) => a.name.localeCompare(b.name));
  if (ui.sort === 'expiry') {
    return items.sort((a, b) => {
      const da = daysUntil(a.expiry), db = daysUntil(b.expiry);
      if (da == null && db == null) return byAdded(a, b);
      if (da == null) return 1;   // no date goes last
      if (db == null) return -1;
      return da - db;
    });
  }
  return items.sort(byAdded);
}

function renderList() {
  if (!root?.isConnected) return;
  const all = Inventory.all();

  // Storage warning
  const used = bytesUsed();
  $('#storage-warn', root).innerHTML = used > CONFIG.STORAGE_WARN_BYTES ? `
    <div class="card warn-card" role="alert">
      <strong>Storage is nearly full</strong> (${(used / 1048576).toFixed(1)} MB of about ${(CONFIG.STORAGE_LIMIT_BYTES / 1048576).toFixed(0)} MB).
      Export a backup, then delete items you no longer have.
    </div>` : '';

  // Category chips: only categories you actually have, with counts.
  const counts = {};
  all.forEach(i => { counts[i.category] = (counts[i.category] || 0) + 1; });
  if (ui.cat !== 'All' && !counts[ui.cat]) ui.cat = 'All';
  const chips = ['All', ...CATEGORIES.filter(c => counts[c])];
  $('#cat-chips', root).innerHTML = all.length ? chips.map(c => `
    <button class="chip ${c === ui.cat ? 'active' : ''}" data-cat="${esc(c)}" aria-pressed="${c === ui.cat}">
      ${esc(c)} <span class="chip-count">${c === 'All' ? all.length : counts[c]}</span>
    </button>`).join('') : '';

  // Filter + sort. On the "pick the item to keep" step, only the selected items are listed.
  const q = ui.q.trim().toLowerCase();
  const shown = ui.mergeMode === 'parent'
    ? sortItems(all.filter(i => ui.selected.has(i.id)))
    : sortItems(all.filter(i =>
      (ui.cat === 'All' || i.category === ui.cat) &&
      (!q || i.name.toLowerCase().includes(q) || (i.brand || '').toLowerCase().includes(q))));

  // Drop selections for items that no longer exist.
  for (const id of ui.selected) if (!all.some(i => i.id === id)) ui.selected.delete(id);
  root.classList.toggle('merging', !!ui.mergeMode);
  root.classList.toggle('merging-parent', ui.mergeMode === 'parent');
  $('#merge-start', root).disabled = all.length < 2;
  renderMergeChrome();

  // Summary
  // Used-up items (quantity 0) don't count towards the expiry warnings.
  const inStock = all.filter(i => i.quantity > 0);
  const soon = inStock.filter(i => expiryInfo(i.expiry).level === 'soon').length;
  const past = inStock.filter(i => expiryInfo(i.expiry).level === 'past').length;
  const bits = [`${all.length} item${all.length === 1 ? '' : 's'}`];
  if (soon) bits.push(`<span class="soon-text">${soon} expiring soon</span>`);
  if (past) bits.push(`<span class="past-text">${past} expired</span>`);
  $('#pantry-summary', root).innerHTML = all.length ? bits.join(' · ') : '';
  renderDuplicates(all);

  const list = $('#pantry-list', root);
  if (!all.length) {
    list.innerHTML = `
      <div class="card empty">
        <div class="locked-icon" aria-hidden="true">🧺</div>
        <h2>Your pantry is empty</h2>
        <p class="muted">Scan your groceries to add them here.</p>
        <button class="btn primary" data-act="go-scan">Scan groceries</button>
      </div>`;
    return;
  }
  if (!shown.length) {
    list.innerHTML = `<div class="card empty"><p class="muted">No items match your search.</p></div>`;
    return;
  }
  list.innerHTML = shown.map(itemHTML).join('');
}

const fmtQty = (q) => String(Number((q ?? 0).toFixed(2)));

function itemHTML(it) {
  const exp = expiryInfo(it.expiry);
  const open = ui.open === it.id;
  const editing = ui.editing === it.id;
  const usedUp = it.quantity <= 0;
  const selected = ui.mergeMode && ui.selected.has(it.id);
  const isParent = ui.mergeMode === 'parent' && ui.parent === it.id;
  const classes = ['pantry-item', exp.level && !usedUp ? 'exp-' + exp.level : '', usedUp ? 'used-up' : '',
    open ? 'open' : '', selected && !isParent ? 'selected' : '', isParent ? 'parent' : ''].join(' ');
  const sub = [it.brand, it.category].filter(Boolean).map(esc).join(' · ');
  const pressed = ui.mergeMode === 'parent' ? isParent : selected;

  return `
    <article class="${classes}" data-id="${esc(it.id)}">
      <div class="pantry-row">
        <button class="item-main" data-act="toggle" ${ui.mergeMode ? `aria-pressed="${!!pressed}"` : `aria-expanded="${open}"`}>
          ${it.thumb ? `<img class="item-thumb" src="${esc(it.thumb)}" alt="">` : '<div class="item-thumb placeholder" aria-hidden="true">🥫</div>'}
          <span class="item-info">
            <span class="item-name">${esc(it.name)}</span>
            <span class="item-sub">${sub}</span>
            <span class="exp-badge ${usedUp ? 'none' : exp.level || 'none'}">${esc(usedUp ? 'Used up' : exp.label)}</span>
          </span>
        </button>
        <div class="stepper" aria-label="Quantity">
          <button class="step" data-act="dec" aria-label="Decrease ${esc(it.name)}" ${it.quantity <= 0 ? 'disabled' : ''}>−</button>
          <span class="qty"><strong>${esc(fmtQty(it.quantity))}</strong><small>${esc(it.unit)}</small></span>
          <button class="step" data-act="inc" aria-label="Increase ${esc(it.name)}">+</button>
        </div>
      </div>
      ${open && !editing ? detailsHTML(it) : ''}
      ${editing ? editFormHTML(it) : ''}
    </article>`;
}

function detailsHTML(it) {
  const n = it.nutrition || {};
  const cell = (label, v, unit) => `<div><span>${label}</span><strong>${v == null ? '–' : esc(fmtQty(v)) + (unit ? ' ' + unit : '')}</strong></div>`;
  const added = it.addedAt ? new Date(it.addedAt).toLocaleDateString() : '–';
  return `
    <div class="item-details">
      <p class="muted small">Nutrition per serving${n.servingSize ? ` (${esc(n.servingSize)})` : ''} ·
        ${it.nutritionSource === 'label' ? 'from label' : 'estimated'}</p>
      <div class="nutri-grid">
        ${cell('Calories', n.calories, 'kcal')}${cell('Protein', n.protein, 'g')}
        ${cell('Carbs', n.carbs, 'g')}${cell('Fat', n.fat, 'g')}
        ${cell('Fibre', n.fibre, 'g')}${cell('Sugar', n.sugar, 'g')}
        ${cell('Sodium', n.sodium, 'mg')}
      </div>
      <p class="muted small">Added ${esc(added)}</p>
      <div class="btn-grid">
        <button class="btn small" data-act="edit">Edit</button>
        <button class="btn small danger-outline" data-act="delete">Delete</button>
      </div>
    </div>`;
}

function editFormHTML(it) {
  const id = (f) => `e-${it.id}-${f}`;
  return `
    <form class="item-details edit-form" data-id="${esc(it.id)}">
      <label for="${id('name')}">Name</label>
      <input id="${id('name')}" name="name" value="${esc(it.name)}" required>
      <div class="grid-2">
        <div><label for="${id('brand')}">Brand</label><input id="${id('brand')}" name="brand" value="${esc(it.brand || '')}"></div>
        <div><label for="${id('category')}">Category</label>
          <select id="${id('category')}" name="category">
            ${CATEGORIES.map(c => `<option ${c === it.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select></div>
      </div>
      <div class="grid-3">
        <div><label for="${id('quantity')}">Qty</label><input id="${id('quantity')}" name="quantity" type="number" inputmode="decimal" min="0" step="any" value="${esc(fmtQty(it.quantity))}"></div>
        <div><label for="${id('unit')}">Unit</label><input id="${id('unit')}" name="unit" value="${esc(it.unit)}"></div>
        <div><label for="${id('expiry')}">Expires</label><input id="${id('expiry')}" name="expiry" type="date" value="${esc(it.expiry || '')}"></div>
      </div>
      <div class="btn-grid">
        <button type="button" class="btn small" data-act="cancel-edit">Cancel</button>
        <button type="submit" class="btn small primary">Save</button>
      </div>
    </form>`;
}

/* ---------------- Actions ---------------- */

/** Apply a change to one item and save. Shows a message if storage is full. */
function updateItem(id, change) {
  const all = Inventory.all();
  const it = all.find(i => i.id === id);
  if (!it) return;
  change(it);
  try {
    Inventory.save(all);
  } catch (err) {
    toast(err instanceof StorageFullError ? err.message : "Couldn't save the change.", 'error', 6000);
  }
}

function onListClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'go-scan') { app.go('scan'); return; }

  const id = btn.closest('.pantry-item')?.dataset.id;
  if (!id) return;

  // In merge mode, tapping an item selects it instead of opening it.
  if (ui.mergeMode) {
    if (act !== 'toggle') return;
    if (ui.mergeMode === 'select') {
      ui.selected.has(id) ? ui.selected.delete(id) : ui.selected.add(id);
    } else {
      ui.parent = ui.parent === id ? null : id;
    }
    renderList();
    return;
  }

  switch (act) {
    case 'toggle':
      ui.open = ui.open === id ? null : id;
      if (ui.editing && ui.editing !== ui.open) ui.editing = null;
      break;
    case 'inc':
      updateItem(id, it => { it.quantity = (it.quantity || 0) + 1; });
      break;
    case 'dec':
      updateItem(id, it => { it.quantity = Math.max(0, (it.quantity || 0) - 1); });
      break;
    case 'edit':
      ui.editing = id;
      break;
    case 'cancel-edit':
      ui.editing = null;
      break;
    case 'delete': {
      const it = Inventory.all().find(i => i.id === id);
      if (!it || !confirm(`Delete "${it.name}" from your pantry?`)) return;
      try { Inventory.save(Inventory.all().filter(i => i.id !== id)); } catch { /* removing never grows storage */ }
      ui.open = ui.editing = null;
      toast('Item deleted');
      break;
    }
    default:
      return;
  }
  renderList();
}

function onEditSubmit(e) {
  e.preventDefault();
  const form = e.target.closest('.edit-form');
  if (!form) return;
  const f = new FormData(form);
  const name = String(f.get('name') || '').trim();
  if (!name) { toast('Name can\'t be empty.', 'error'); return; }
  const qty = parseFloat(f.get('quantity'));

  updateItem(form.dataset.id, it => {
    it.name = name;
    it.brand = String(f.get('brand') || '').trim() || null;
    it.category = CATEGORIES.includes(f.get('category')) ? f.get('category') : 'Other';
    it.quantity = Number.isFinite(qty) && qty >= 0 ? qty : it.quantity;
    it.unit = String(f.get('unit') || '').trim() || 'pcs';
    it.expiry = f.get('expiry') || null;
  });
  ui.editing = null;
  toast('Saved', 'success');
  renderList();
}

/* ---------------- Manual merge ---------------- */

function resetMerge() {
  ui.mergeMode = null;
  ui.selected = new Set();
  ui.parent = null;
}

/** Instruction line above the list and the Cancel / Next / ✓ bar above the tab bar. */
function renderMergeChrome() {
  const head = $('#merge-head', root);
  const bar = $('#merge-bar', root);
  if (!ui.mergeMode) {
    head.innerHTML = '';
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }

  const n = ui.selected.size;
  head.innerHTML = ui.mergeMode === 'select'
    ? `<div class="merge-head select"><strong>Select items to merge</strong><span>Tap two or more items.</span></div>`
    : `<div class="merge-head parent"><strong>Choose the item to keep</strong><span>It keeps its name, photo, expiry and nutrition. The others' quantities are added to it.</span></div>`;

  const right = ui.mergeMode === 'select'
    ? `<button class="btn primary bar-btn" data-act="merge-next" ${n < 2 ? 'disabled' : ''}>Next</button>`
    : `<button class="btn primary bar-btn confirm" data-act="merge-confirm" aria-label="Merge" ${ui.parent ? '' : 'disabled'}>✓</button>`;
  const middle = ui.mergeMode === 'select'
    ? `${n} selected`
    : (ui.parent ? 'Ready to merge' : 'Tap one item');

  bar.hidden = false;
  bar.innerHTML = `
    <button class="btn bar-btn" data-act="merge-cancel">Cancel</button>
    <span class="bar-status">${esc(middle)}</span>
    ${right}`;
}

function onMergeBarClick(e) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'merge-cancel') {
    resetMerge();
  } else if (act === 'merge-next' && ui.selected.size >= 2) {
    ui.mergeMode = 'parent';
    ui.parent = null;
  } else if (act === 'merge-confirm' && ui.parent) {
    if (!doManualMerge()) return;
  } else {
    return;
  }
  renderList();
  window.scrollTo(0, 0);
}

/** Add the selected items' quantities to the parent and remove them. Returns true if merged. */
function doManualMerge() {
  const all = Inventory.all();
  const parent = all.find(i => i.id === ui.parent);
  const others = all.filter(i => ui.selected.has(i.id) && i.id !== ui.parent);
  if (!parent || !others.length) { resetMerge(); return true; }

  // Different units can't really be added; let the user decide.
  const units = [...new Set([parent, ...others].map(i => normUnit(i.unit)))];
  if (units.length > 1 && !confirm(
    `These items use different units (${[parent, ...others].map(i => i.unit).filter((u, k, a) => a.indexOf(u) === k).join(', ')}).\n\n` +
    `Their quantities will simply be added together and shown in "${parent.unit}". Merge anyway?`)) {
    return false;
  }

  const total = others.reduce((sum, i) => sum + (i.quantity || 0), parent.quantity || 0);
  parent.quantity = Number(total.toFixed(3));
  const removeIds = new Set(others.map(i => i.id));
  try {
    Inventory.save(all.filter(i => !removeIds.has(i.id)));
  } catch {
    toast("Couldn't save the merge.", 'error');
    return false;
  }
  toast(`Merged ${others.length + 1} items into "${parent.name}"`, 'success');
  resetMerge();
  return true;
}

/* ---------------- Duplicates ---------------- */

/** Banner when rows look like the same item, with a preview before merging. */
function renderDuplicates(all) {
  const box = $('#dup-box', root);
  const groups = findDuplicateGroups(all);
  if (!groups.length) { ui.reviewMerge = false; box.innerHTML = ''; return; }

  const extra = groups.reduce((n, g) => n + g.length - 1, 0);
  if (!ui.reviewMerge) {
    box.innerHTML = `
      <div class="card dup-card">
        <span>${groups.length} item${groups.length === 1 ? ' has' : 's have'} duplicate rows.</span>
        <button class="btn small" data-act="dup-review">Merge duplicates</button>
      </div>`;
    return;
  }

  // Preview what each merged row will look like.
  const rows = groups.map(g => {
    const preview = g.slice(1).reduce((acc, r) => mergeInto(acc, r), { ...g[0] });
    const label = preview.expiry ? expiryInfo(preview.expiry).label : '';
    const exp = label ? ` · ${esc(label[0].toLowerCase() + label.slice(1))}` : '';
    return `<li><strong>${esc(g[0].name)}</strong>: ${g.length} rows → 1
            (${esc(fmtQty(preview.quantity))} ${esc(preview.unit)}${exp})</li>`;
  }).join('');

  box.innerHTML = `
    <div class="card dup-card open">
      <p><strong>Merge ${extra} duplicate row${extra === 1 ? '' : 's'}?</strong></p>
      <ul class="dup-list">${rows}</ul>
      <p class="hint">Quantities are added together and the earliest expiry date is kept.</p>
      <div class="btn-grid">
        <button class="btn small" data-act="dup-cancel">Cancel</button>
        <button class="btn small primary" data-act="dup-merge">Merge all</button>
      </div>
    </div>`;
}

function onDupClick(e) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'dup-review') ui.reviewMerge = true;
  if (act === 'dup-cancel') ui.reviewMerge = false;
  if (act === 'dup-merge') {
    const { items, removed } = mergeAllDuplicates(Inventory.all());
    try { Inventory.save(items); } catch { /* merging only shrinks the data */ }
    ui.reviewMerge = false;
    ui.open = ui.editing = null;
    toast(`Merged ${removed} duplicate row${removed === 1 ? '' : 's'}`, 'success');
  }
  if (act) renderList();
}

/* ---------------- Backup ---------------- */

function onBackupClick(e) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'export') {
    const n = exportBackup();
    toast(`Exported ${n} item${n === 1 ? '' : 's'}`, 'success');
    return;
  }
  if (act === 'import-cancel') { ui.pendingImport = null; renderImportPrompt(); return; }
  if (act === 'import-merge' || act === 'import-replace') {
    const mode = act === 'import-merge' ? 'merge' : 'replace';
    if (mode === 'replace' && !confirm('Replace your whole pantry and saved recipes with the backup? Anything not in the backup will be lost.')) return;
    try {
      const { added, skipped } = applyImport(ui.pendingImport, mode);
      toast(mode === 'replace' ? `Restored ${added} items` : `Added ${added} item${added === 1 ? '' : 's'}${skipped ? `, ${skipped} already here` : ''}`, 'success', 5000);
    } catch (err) {
      toast(err instanceof StorageFullError ? 'Not enough storage for this backup. Delete some items first.' : "Couldn't import: " + err.message, 'error', 6000);
      return;
    }
    ui.pendingImport = null;
    ui.cat = 'All';
    renderImportPrompt();
    renderList();
  }
}

async function onImportFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    ui.pendingImport = await readBackupFile(file);
    renderImportPrompt();
  } catch (err) {
    toast(err.message, 'error', 6000);
  }
}

function renderImportPrompt() {
  const el = root && $('#import-prompt', root);
  if (!el) return;
  const p = ui.pendingImport;
  if (!p) { el.innerHTML = ''; return; }
  const favs = p.favourites.length ? ` and ${p.favourites.length} saved recipe${p.favourites.length === 1 ? '' : 's'}` : '';
  el.innerHTML = `
    <div class="import-box">
      <p><strong>Backup found:</strong> ${p.items.length} item${p.items.length === 1 ? '' : 's'}${favs}.</p>
      <div class="btn-grid">
        <button class="btn small primary" data-act="import-merge">Merge</button>
        <button class="btn small danger-outline" data-act="import-replace">Replace all</button>
      </div>
      <p class="hint">Merge adds anything not already in your pantry. Replace swaps everything for the backup.</p>
      <button class="btn link small" data-act="import-cancel">Cancel</button>
    </div>`;
}
