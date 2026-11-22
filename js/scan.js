/**
 * Pantry Snap: Scan tab.
 * Take or choose photos → Claude identifies the food → you review and edit → save to the pantry.
 *
 * Scan state lives in memory (module scope), so switching tabs mid-scan doesn't lose anything.
 * Cards are updated one at a time, so typing in a review card isn't interrupted
 * while other photos are still being identified.
 */
import { CONFIG, CATEGORIES } from './config.js';
import { Inventory, StorageFullError, newId } from './storage.js';
import { preparePhoto } from './image.js';
import { identifyPhoto } from './identify.js';
import { itemKey, mergeInto } from './merge.js';
import { $, esc, toast } from './ui.js';

const NUTRITION_FIELDS = [
  ['calories', 'Calories', 'kcal'],
  ['protein', 'Protein', 'g'],
  ['carbs', 'Carbs', 'g'],
  ['fat', 'Fat', 'g'],
  ['fibre', 'Fibre', 'g'],
  ['sugar', 'Sugar', 'g'],
  ['sodium', 'Sodium', 'mg'],
];

/**
 * photo: { id, base64, thumb, status, error, errorKind, items[] }
 * status: preparing | ready | queued | working | done | error
 */
const state = { photos: [], running: false, controller: null, savedCount: 0 };
let root = null;   // current view element
let app = null;    // { go(tab) }

/* ---------------- Rendering ---------------- */

export function renderScan(el, appApi) {
  root = el;
  app = appApi;
  el.innerHTML = `
    <h1 class="view-title">Scan</h1>
    <div class="capture-row">
      <label class="btn primary capture-btn">
        <span aria-hidden="true">📷</span> Take photo
        <input id="cam-input" class="sr-only" type="file" accept="image/*" capture="environment">
      </label>
      <label class="btn capture-btn">
        <span aria-hidden="true">🖼️</span> Choose photos
        <input id="lib-input" class="sr-only" type="file" accept="image/*" multiple>
      </label>
    </div>
    <p class="hint center">One shelf or a handful of items per photo works best. Make labels and dates readable if you can.</p>
    <div id="scan-saved"></div>
    <div id="scan-photos"></div>
    <div id="scan-footer" class="scan-footer"></div>`;

  for (const id of ['#cam-input', '#lib-input']) {
    $(id, el).addEventListener('change', (e) => {
      addFiles([...e.target.files]);
      e.target.value = ''; // allow picking the same file again
    });
  }

  const photosEl = $('#scan-photos', el);
  photosEl.addEventListener('input', onFieldInput);
  photosEl.addEventListener('change', onFieldInput);
  photosEl.addEventListener('click', onCardClick);
  $('#scan-footer', el).addEventListener('click', onFooterClick);
  $('#scan-saved', el).addEventListener('click', (e) => {
    if (e.target.closest('[data-act="view-pantry"]')) { state.savedCount = 0; app.go('pantry'); }
  });

  renderSaved();
  state.photos.forEach(p => photosEl.appendChild(cardFor(p)));
  refreshMatchNotes();
  updateFooter();
}

/* ---------------- Duplicate suggestions ---------------- */

/** All included draft items in display order, as { p, it }. */
function draftsInOrder() {
  const out = [];
  for (const p of state.photos) if (p.status === 'done') for (const it of p.items) out.push({ p, it });
  return out;
}

/**
 * What a draft would merge with on save: an existing pantry row first,
 * otherwise an earlier ticked item in this scan. null if nothing matches.
 */
function matchFor(target, pantry, drafts) {
  const key = itemKey(target);
  const existing = pantry.find(i => itemKey(i) === key);
  if (existing) return { type: 'pantry', item: existing };
  for (const { it } of drafts) {
    if (it === target) break;
    if (it.include && itemKey(it) === key) return { type: 'batch', item: it };
  }
  return null;
}

/** Fill the "Merge with…" line on every review card. Doesn't touch inputs, so typing isn't interrupted. */
function refreshMatchNotes() {
  if (!isMounted()) return;
  const pantry = Inventory.all();
  const drafts = draftsInOrder();
  root.querySelectorAll('.item-card').forEach(card => {
    const p = state.photos.find(x => x.id === card.dataset.photo);
    const it = p?.items[Number(card.dataset.idx)];
    const note = card.querySelector('.match-note');
    if (!it || !note) return;
    const m = it.include ? matchFor(it, pantry, drafts) : null;
    if (!m) { note.innerHTML = ''; return; }
    const where = m.type === 'pantry'
      ? `<strong>${esc(m.item.name)}</strong> already in your pantry (${esc(String(Number((m.item.quantity || 0).toFixed(2))))} ${esc(m.item.unit)})`
      : `<strong>${esc(m.item.name)}</strong> earlier in this scan`;
    note.innerHTML = `
      <label class="merge-toggle">
        <input type="checkbox" data-field="merge" ${it.merge !== false ? 'checked' : ''}>
        <span>Merge with ${where}</span>
      </label>`;
  });
}

function isMounted() {
  return root && root.isConnected && !root.hidden;
}

function renderSaved() {
  if (!isMounted()) return;
  $('#scan-saved', root).innerHTML = state.savedCount ? `
    <div class="card success-card">
      <p><strong>Saved ${state.savedCount} item${state.savedCount === 1 ? '' : 's'} to your pantry.</strong></p>
      <button class="btn small" data-act="view-pantry">View pantry</button>
    </div>` : '';
}

/** Build the DOM node for one photo card. */
function cardFor(p) {
  const div = document.createElement('article');
  div.className = 'card photo-card';
  div.id = 'photo-' + p.id;
  div.dataset.photo = p.id;
  div.innerHTML = photoCardHTML(p);
  return div;
}

/** Replace a single photo card in place (keeps focus elsewhere intact). */
function updateCard(p) {
  if (!isMounted()) return;
  const existing = document.getElementById('photo-' + p.id);
  if (existing) existing.replaceWith(cardFor(p));
  else $('#scan-photos', root).appendChild(cardFor(p));
  refreshMatchNotes();
}

function removeCard(id) {
  document.getElementById('photo-' + id)?.remove();
}

function photoCardHTML(p) {
  const statusLine = {
    preparing: '<span class="spinner small"></span> Preparing photo…',
    ready: 'Ready to identify',
    queued: 'Waiting…',
    working: '<span class="spinner small"></span> Identifying with Claude…',
    done: p.items.length ? `${p.items.length} item${p.items.length === 1 ? '' : 's'} found. Check and edit below.` : 'No food found in this photo.',
    error: '<span class="error-text">Couldn\'t identify this photo</span>',
  }[p.status] || '';

  const canRemove = p.status !== 'working';
  let body = '';
  if (p.status === 'error') {
    body = `<p class="status error">${esc(p.error)}</p>
            <button class="btn small" data-act="retry">Try again</button>`;
  } else if (p.status === 'done') {
    body = p.items.map((it, i) => itemCardHTML(p, it, i)).join('');
  }

  return `
    <div class="photo-head">
      ${p.thumb ? `<img class="photo-thumb" src="${esc(p.thumb)}" alt="Photo preview">` : '<div class="photo-thumb"></div>'}
      <div class="photo-status">${statusLine}</div>
      ${canRemove ? '<button class="icon-btn" data-act="remove-photo" aria-label="Remove photo">✕</button>' : ''}
    </div>
    ${body}`;
}

function confidenceBadge(c) {
  if (c == null) return '';
  const pct = Math.round(c * 100);
  if (c >= 0.8) return `<span class="badge ok">Sure ${pct}%</span>`;
  if (c >= CONFIG.LOW_CONFIDENCE) return `<span class="badge neutral">Likely ${pct}%</span>`;
  return `<span class="badge warn">Check this · ${pct}%</span>`;
}

const val = (v) => (v == null ? '' : esc(v));

function itemCardHTML(p, it, i) {
  const fid = (f) => `f-${p.id}-${i}-${f}`;
  return `
    <div class="item-card ${it.include ? '' : 'excluded'}" data-photo="${esc(p.id)}" data-idx="${i}">
      <div class="item-top">
        <label class="include-toggle">
          <input type="checkbox" data-field="include" ${it.include ? 'checked' : ''}> Add
        </label>
        <div class="badges">
          ${confidenceBadge(it.confidence)}
          <span class="badge neutral" title="Where the nutrition came from">${it.nutritionSource === 'label' ? 'From label' : 'Estimated'}</span>
        </div>
        <button class="icon-btn" data-act="remove-item" aria-label="Remove item">✕</button>
      </div>
      <div class="match-note"></div>

      <label for="${fid('name')}">Name</label>
      <input id="${fid('name')}" data-field="name" value="${val(it.name)}" autocomplete="off">

      <div class="grid-2">
        <div>
          <label for="${fid('brand')}">Brand</label>
          <input id="${fid('brand')}" data-field="brand" value="${val(it.brand)}" placeholder="Optional" autocomplete="off">
        </div>
        <div>
          <label for="${fid('category')}">Category</label>
          <select id="${fid('category')}" data-field="category">
            ${CATEGORIES.map(c => `<option ${c === it.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="grid-3">
        <div>
          <label for="${fid('quantity')}">Qty</label>
          <input id="${fid('quantity')}" data-field="quantity" type="number" inputmode="decimal" min="0" step="any" value="${val(it.quantity)}">
        </div>
        <div>
          <label for="${fid('unit')}">Unit</label>
          <input id="${fid('unit')}" data-field="unit" value="${val(it.unit)}" autocomplete="off">
        </div>
        <div>
          <label for="${fid('expiry')}">Expires</label>
          <input id="${fid('expiry')}" data-field="expiry" type="date" value="${val(it.expiry)}">
        </div>
      </div>

      <details class="nutrition">
        <summary>Nutrition per serving${it.nutrition.calories != null ? ` · ${esc(Math.round(it.nutrition.calories))} kcal` : ''}</summary>
        <label for="${fid('servingSize')}">Serving size</label>
        <input id="${fid('servingSize')}" data-field="n.servingSize" value="${val(it.nutrition.servingSize)}" placeholder="e.g. 30 g">
        <div class="grid-nutrition">
          ${NUTRITION_FIELDS.map(([k, label, unit]) => `
            <div>
              <label for="${fid(k)}">${label} <span class="unit">${unit}</span></label>
              <input id="${fid(k)}" data-field="n.${k}" type="number" inputmode="decimal" min="0" step="any" value="${val(it.nutrition[k])}">
            </div>`).join('')}
        </div>
      </details>
    </div>`;
}

function updateFooter() {
  if (!isMounted()) return;
  const ready = state.photos.filter(p => p.status === 'ready').length;
  const preparing = state.photos.some(p => p.status === 'preparing');
  const toAdd = includedItems().length;
  const anyDone = state.photos.some(p => p.status === 'done');

  let html = '';
  if (state.running) {
    html += `<button class="btn block" data-act="cancel"><span class="spinner"></span> Identifying… tap to cancel</button>`;
  } else if (ready) {
    html += `<button class="btn primary block" data-act="identify" ${preparing ? 'disabled' : ''}>
               Identify ${ready} photo${ready === 1 ? '' : 's'}</button>`;
  }
  if (toAdd) {
    html += `<button class="btn primary block" data-act="save">Add ${toAdd} item${toAdd === 1 ? '' : 's'} to pantry</button>`;
  }
  if (anyDone && !state.running) {
    html += `<button class="btn link block" data-act="discard">Discard results</button>`;
  }
  $('#scan-footer', root).innerHTML = html;
}

/* ---------------- Adding photos ---------------- */

async function addFiles(files) {
  const images = files.filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
  if (images.length < files.length) toast('Some files were skipped because they aren\'t images.', 'error');
  state.savedCount = 0;
  renderSaved();

  for (const file of images) {
    const p = { id: newId(), base64: null, thumb: null, status: 'preparing', error: null, errorKind: null, items: [] };
    state.photos.push(p);
    updateCard(p);
    updateFooter();
    try {
      const { base64, thumb } = await preparePhoto(file);
      Object.assign(p, { base64, thumb, status: 'ready' });
    } catch (err) {
      Object.assign(p, { status: 'error', error: err.message, errorKind: 'image' });
    }
    if (state.photos.includes(p)) updateCard(p);
    updateFooter();
  }
}

/* ---------------- Identifying ---------------- */

async function identifyQueued() {
  const queue = state.photos.filter(p => p.status === 'ready');
  if (!queue.length || state.running) return;

  state.running = true;
  state.controller = new AbortController();
  const { signal } = state.controller;
  queue.forEach(p => { p.status = 'queued'; updateCard(p); });
  updateFooter();

  let next = 0;
  const worker = async () => {
    while (next < queue.length && !signal.aborted) {
      const p = queue[next++];
      if (!state.photos.includes(p)) continue; // removed while waiting
      await identifyOne(p, signal);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONFIG.SCAN_CONCURRENCY, queue.length) }, worker));

  // Anything still queued (after cancel or a fatal error) goes back to "ready".
  queue.forEach(p => { if (p.status === 'queued') { p.status = 'ready'; updateCard(p); } });
  state.running = false;
  state.controller = null;
  updateFooter();
}

/** Errors where carrying on with the other photos would just fail again. */
const STOP_ALL = new Set(['auth', 'credit', 'permission', 'model', 'rate', 'offline', 'no_key']);

async function identifyOne(p, signal) {
  p.status = 'working';
  updateCard(p);
  try {
    const items = await identifyPhoto(p.base64, { signal });
    p.items = items.map(it => ({ ...it, include: true, merge: true }));
    p.status = 'done';
    p.base64 = null; // full-size image no longer needed; free the memory
  } catch (err) {
    if (err.kind === 'aborted') {
      p.status = 'ready';
    } else {
      p.status = 'error';
      p.error = err.message;
      p.errorKind = err.kind;
      if (STOP_ALL.has(err.kind)) state.controller?.abort();
    }
  }
  if (state.photos.includes(p)) updateCard(p);
  updateFooter();
}

/* ---------------- Editing ---------------- */

function findItem(target) {
  const card = target.closest('.item-card');
  if (!card) return {};
  const p = state.photos.find(x => x.id === card.dataset.photo);
  const idx = Number(card.dataset.idx);
  return { card, p, idx, item: p?.items[idx] };
}

function onFieldInput(e) {
  const field = e.target.dataset.field;
  if (!field) return;
  const { card, item } = findItem(e.target);
  if (!item) return;

  if (field === 'include') {
    item.include = e.target.checked;
    card.classList.toggle('excluded', !item.include);
    refreshMatchNotes();
    updateFooter();
    return;
  }
  if (field === 'merge') {
    item.merge = e.target.checked;
    return;
  }

  const raw = e.target.value;
  const isNumber = e.target.type === 'number';
  const value = isNumber ? (raw === '' ? null : parseFloat(raw)) : (raw.trim() === '' ? null : raw);

  if (field.startsWith('n.')) item.nutrition[field.slice(2)] = Number.isFinite(value) || !isNumber ? value : null;
  else item[field] = Number.isFinite(value) || !isNumber ? value : null;

  // Name/unit decide what an item merges with.
  if (field === 'name' || field === 'unit') refreshMatchNotes();
}

function onCardClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const photoEl = btn.closest('.photo-card');
  const p = state.photos.find(x => x.id === photoEl?.dataset.photo);
  if (!p) return;

  switch (btn.dataset.act) {
    case 'remove-photo':
      state.photos = state.photos.filter(x => x !== p);
      removeCard(p.id);
      break;
    case 'remove-item': {
      const { idx } = findItem(btn);
      p.items.splice(idx, 1);
      updateCard(p);
      break;
    }
    case 'retry':
      if (p.errorKind === 'image') { toast('That file can\'t be read. Remove it and pick another photo.', 'error'); return; }
      p.status = 'ready';
      p.error = null;
      updateCard(p);
      identifyQueued();
      break;
  }
  updateFooter();
}

/* ---------------- Footer actions ---------------- */

function includedItems() {
  const out = [];
  for (const p of state.photos) {
    if (p.status !== 'done') continue;
    for (const it of p.items) if (it.include) out.push({ p, it });
  }
  return out;
}

function onFooterClick(e) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'identify') identifyQueued();
  if (act === 'cancel') state.controller?.abort();
  if (act === 'save') saveIncluded();
  if (act === 'discard' && confirm('Discard the identified items without saving them?')) {
    state.photos = state.photos.filter(p => p.status !== 'done');
    renderScan(root, app);
  }
}

function saveIncluded() {
  const chosen = includedItems();
  const missingName = chosen.find(({ it }) => !it.name);
  if (missingName) { toast('Every item needs a name before saving.', 'error'); return; }

  // Work on a copy of the pantry; matches merge into existing rows (or into rows
  // added earlier in this same save), everything else becomes a new row.
  const list = Inventory.all();
  const now = new Date().toISOString();
  let added = 0, merged = 0;

  for (const { p, it } of chosen) {
    const { include, merge, ...rest } = it;
    const item = {
      ...rest,
      quantity: Number.isFinite(rest.quantity) && rest.quantity > 0 ? rest.quantity : 1,
      unit: rest.unit || 'pcs',
      thumb: p.thumb,
    };
    const target = merge !== false ? list.find(i => itemKey(i) === itemKey(item)) : null;
    if (target) {
      mergeInto(target, item);
      merged++;
    } else {
      list.push({ ...item, id: newId(), addedAt: now });
      added++;
    }
  }

  try {
    Inventory.save(list);
  } catch (err) {
    if (err instanceof StorageFullError) toast(err.message, 'error', 6000);
    else toast('Couldn\'t save. ' + err.message, 'error');
    return;
  }

  // Done photos are finished with (including any items you unticked).
  state.photos = state.photos.filter(p => p.status !== 'done');
  state.savedCount = added + merged;
  renderScan(root, app);
  const parts = [];
  if (added) parts.push(`Added ${added} new`);
  if (merged) parts.push(`merged ${merged} into existing`);
  toast(parts.join(', ').replace(/^m/, 'M'), 'success');
}

/** True if there are identified items that haven't been saved. Used to warn before leaving. */
export function hasUnsavedScan() {
  return state.running || state.photos.some(p => p.status === 'done' && p.items.length);
}
