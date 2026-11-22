/**
 * Pantry Snap: Recipes tab.
 * "What can I make?" with optional filters, recipe cards, and saved favourites.
 * Suggestions stay in memory while the app is open; favourites are saved to localStorage.
 */
import { RECIPE_FILTERS } from './config.js';
import { Settings, Favourites, StorageFullError } from './storage.js';
import { suggestRecipes, usableItems } from './suggest.js';
import { expiryInfo } from './dates.js';
import { $, esc, toast } from './ui.js';

const DEFAULT_FILTERS = { dietary: [], other: '', maxMinutes: 0, mealType: 'Any' };

/** View state kept while the app is open. */
const state = { tab: 'ideas', results: [], loading: false, error: null, controller: null, open: new Set() };
let root = null;
let app = null;

function getFilters() {
  return { ...DEFAULT_FILTERS, ...(Settings.get().recipeFilters || {}) };
}
function saveFilters(f) {
  try { Settings.update({ recipeFilters: f }); } catch { /* remembering filters is optional */ }
}

export function renderRecipes(el, appApi) {
  root = el;
  app = appApi;
  const favCount = Favourites.all().length;
  el.innerHTML = `
    <h1 class="view-title">Recipes</h1>
    <div class="segmented" role="tablist">
      <button role="tab" data-tab="ideas" aria-selected="${state.tab === 'ideas'}">Ideas</button>
      <button role="tab" data-tab="saved" aria-selected="${state.tab === 'saved'}">Saved${favCount ? ` (${favCount})` : ''}</button>
    </div>
    <div id="recipes-body"></div>`;

  el.querySelector('.segmented').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]')?.dataset.tab;
    if (t && t !== state.tab) { state.tab = t; renderRecipes(root, app); }
  });
  const body = $('#recipes-body', el);
  body.addEventListener('click', onBodyClick);
  body.addEventListener('change', onFilterChange);
  body.addEventListener('input', onFilterChange);

  state.tab === 'ideas' ? renderIdeas() : renderSaved();
}

function isMounted() { return root?.isConnected && !root.hidden; }

/* ---------------- Ideas ---------------- */

function renderIdeas() {
  if (!isMounted()) return;
  const f = getFilters();
  const items = usableItems();
  const soon = items.filter(i => expiryInfo(i.expiry).level === 'soon').length;

  const filtersOn = f.dietary.length + (f.other.trim() ? 1 : 0) + (f.maxMinutes ? 1 : 0) + (f.mealType !== 'Any' ? 1 : 0);
  const body = $('#recipes-body', root);
  body.innerHTML = `
    <details class="card filters" ${filtersOn ? 'open' : ''}>
      <summary>Filters${filtersOn ? ` <span class="badge neutral">${filtersOn} on</span>` : ' <span class="muted small">(optional)</span>'}</summary>
      <p class="filter-label">Dietary</p>
      <div class="chips wrap">
        ${RECIPE_FILTERS.DIETARY.map(d => `
          <button class="chip ${f.dietary.includes(d) ? 'active' : ''}" data-diet="${esc(d)}" aria-pressed="${f.dietary.includes(d)}">${esc(d)}</button>`).join('')}
      </div>
      <label for="diet-other" class="filter-label">Anything else?</label>
      <input id="diet-other" data-filter="other" value="${esc(f.other)}" placeholder="e.g. no mushrooms, nut allergy" maxlength="120" autocomplete="off">
      <div class="grid-2">
        <div>
          <label for="max-time" class="filter-label">Max time</label>
          <select id="max-time" data-filter="maxMinutes">
            ${RECIPE_FILTERS.MAX_MINUTES.map(m => `<option value="${m}" ${m === f.maxMinutes ? 'selected' : ''}>${m ? `${m} min` : 'Any'}</option>`).join('')}
          </select>
        </div>
        <div>
          <label for="meal-type" class="filter-label">Meal</label>
          <select id="meal-type" data-filter="mealType">
            ${RECIPE_FILTERS.MEAL_TYPES.map(m => `<option ${m === f.mealType ? 'selected' : ''}>${esc(m)}</option>`).join('')}
          </select>
        </div>
      </div>
      ${filtersOn ? '<button class="btn link small" data-act="clear-filters">Clear filters</button>' : ''}
    </details>

    ${state.loading ? `
      <div class="card loading-card" role="status">
        <span class="spinner"></span>
        <div><strong>Thinking up recipes…</strong><p class="muted small">This can take up to a minute.</p></div>
      </div>
      <button class="btn block" data-act="cancel">Cancel</button>` : `
      <button class="btn primary block big" data-act="suggest" ${items.length ? '' : 'disabled'}>What can I make?</button>
      <p class="hint center">${items.length
        ? `Uses ${items.length} item${items.length === 1 ? '' : 's'} from your pantry${soon ? `, ${soon} expiring soon` : ''}. Sends names, quantities and expiry dates only.`
        : 'Your pantry has no in-date items yet. Scan some groceries first.'}</p>`}

    ${state.error ? `<div class="card error-card" role="alert"><p>${esc(state.error)}</p>
      <button class="btn small" data-act="suggest">Try again</button></div>` : ''}

    <div id="recipe-list">${state.results.map(recipeCardHTML).join('')}</div>`;
}

async function runSuggest() {
  if (state.loading) return;
  state.loading = true;
  state.error = null;
  state.controller = new AbortController();
  renderIdeas();
  try {
    state.results = await suggestRecipes(getFilters(), { signal: state.controller.signal });
    state.open = new Set();
  } catch (err) {
    if (err.kind !== 'aborted') state.error = err.message;
  } finally {
    state.loading = false;
    state.controller = null;
    if (state.tab === 'ideas') renderIdeas();
  }
}

function onFilterChange(e) {
  const key = e.target.dataset.filter;
  if (!key) return;
  const f = getFilters();
  f[key] = key === 'maxMinutes' ? Number(e.target.value) : e.target.value;
  saveFilters(f);
  // Re-render only on select changes so typing in the text box isn't interrupted.
  if (e.type === 'change' && e.target.tagName === 'SELECT') renderIdeas();
}

/* ---------------- Saved ---------------- */

function renderSaved() {
  if (!isMounted()) return;
  const favs = Favourites.all();
  $('#recipes-body', root).innerHTML = favs.length
    ? `<div id="recipe-list">${favs.map(recipeCardHTML).join('')}</div>`
    : `<div class="card empty">
         <div class="locked-icon" aria-hidden="true">⭐</div>
         <h2>No saved recipes yet</h2>
         <p class="muted">Tap the star on a recipe idea to keep it here.</p>
       </div>`;
}

/* ---------------- Recipe card ---------------- */

function recipeCardHTML(r) {
  const saved = Favourites.has(r.id);
  const open = state.open.has(r.id);
  const total = (r.prepMinutes || 0) + (r.cookMinutes || 0);
  const n = r.nutritionPerServing || {};
  const meta = [
    total ? `⏱ ${total} min` : '',
    r.servings ? `🍽 Serves ${Number(r.servings)}` : '',
    r.mealType ? r.mealType[0].toUpperCase() + r.mealType.slice(1) : '',
  ].filter(Boolean);
  const nut = [
    n.calories != null ? `${Math.round(n.calories)} kcal` : '',
    n.protein != null ? `${Math.round(n.protein)} g protein` : '',
    n.carbs != null ? `${Math.round(n.carbs)} g carbs` : '',
    n.fat != null ? `${Math.round(n.fat)} g fat` : '',
  ].filter(Boolean);
  const ing = (list) => list.map(i => `<li>${esc(i.item)}${i.amount ? ` <span class="muted">· ${esc(i.amount)}</span>` : ''}</li>`).join('');

  return `
    <article class="card recipe-card" data-id="${esc(r.id)}">
      <div class="recipe-head">
        <h2>${esc(r.title)}</h2>
        <button class="icon-btn star ${saved ? 'on' : ''}" data-act="star" aria-pressed="${saved}"
                aria-label="${saved ? 'Remove from saved' : 'Save recipe'}">${saved ? '★' : '☆'}</button>
      </div>
      ${r.description ? `<p class="muted">${esc(r.description)}</p>` : ''}
      <p class="recipe-meta">${meta.map(esc).join(' · ')}${r.prepMinutes != null && r.cookMinutes != null && total ? ` <span class="muted small">(prep ${Number(r.prepMinutes)}, cook ${Number(r.cookMinutes)})</span>` : ''}</p>
      ${r.usesExpiringSoon.length ? `<p class="uses-soon">Uses soon-to-expire: ${r.usesExpiringSoon.map(esc).join(', ')}</p>` : ''}

      <div class="ing-cols">
        <div>
          <h3>You have</h3>
          <ul class="ing have">${ing(r.ingredientsHave) || '<li class="muted">–</li>'}</ul>
        </div>
        <div>
          <h3>Missing</h3>
          <ul class="ing missing">${ing(r.ingredientsMissing) || '<li class="muted">Nothing 🎉</li>'}</ul>
        </div>
      </div>

      <button class="btn small block" data-act="steps" aria-expanded="${open}">${open ? 'Hide steps' : `Show ${r.steps.length} steps`}</button>
      ${open ? `<ol class="steps">${r.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
      ${nut.length ? `<p class="nutri-line">Per serving (rough): ${nut.map(esc).join(' · ')}</p>` : ''}
    </article>`;
}

function findRecipe(id) {
  return state.results.find(r => r.id === id) || Favourites.all().find(r => r.id === id);
}

function rerender() { state.tab === 'ideas' ? renderIdeas() : renderSaved(); }

function onBodyClick(e) {
  const diet = e.target.closest('[data-diet]');
  if (diet) {
    const f = getFilters();
    const d = diet.dataset.diet;
    f.dietary = f.dietary.includes(d) ? f.dietary.filter(x => x !== d) : [...f.dietary, d];
    saveFilters(f);
    renderIdeas();
    return;
  }

  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('.recipe-card')?.dataset.id;

  switch (btn.dataset.act) {
    case 'suggest': runSuggest(); break;
    case 'cancel': state.controller?.abort(); break;
    case 'clear-filters': saveFilters({ ...DEFAULT_FILTERS }); renderIdeas(); break;
    case 'steps':
      state.open.has(id) ? state.open.delete(id) : state.open.add(id);
      rerender();
      break;
    case 'star': {
      const r = findRecipe(id);
      if (!r) return;
      if (Favourites.has(id)) {
        Favourites.remove(id);
        toast('Removed from saved');
      } else {
        try { Favourites.add(r); toast('Saved', 'success'); }
        catch (err) { toast(err instanceof StorageFullError ? err.message : "Couldn't save the recipe.", 'error'); return; }
      }
      // Update the "Saved (N)" count and the card.
      renderRecipes(root, app);
      break;
    }
  }
}
