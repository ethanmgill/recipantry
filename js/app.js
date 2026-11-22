/**
 * Pantry Snap: app entry point.
 * Tab routing, key gating and the first-launch key screen.
 */
import { ApiKey } from './storage.js';
import { AUTH_FAILED_EVENT } from './api.js';
import { renderPantry } from './pantry.js';
import { renderRecipes } from './recipes.js';
import { showKeyScreen } from './keyscreen.js';
import { renderSettings } from './settings.js';
import { renderScan, hasUnsavedScan } from './scan.js';
import { $, esc, lockedCard, toast } from './ui.js';

const TABS = ['scan', 'pantry', 'recipes', 'settings'];
const NEEDS_KEY = new Set(['scan', 'recipes']);

let current = null;

/* ---------- Views (Scan, Pantry and Recipes are filled in by later milestones) ---------- */

const RENDERERS = {
  scan: (el) => renderScan(el, appApi),
  pantry: (el) => renderPantry(el, appApi),
  recipes: (el) => renderRecipes(el, appApi),
  settings: (el) => renderSettings(el, appApi),
};

/* ---------- Routing ---------- */

function show(tab) {
  if (!TABS.includes(tab)) tab = ApiKey.isUsable() ? 'scan' : 'pantry';
  current = tab;
  if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);

  for (const t of TABS) {
    const view = $('#view-' + t);
    view.hidden = t !== tab;
    const btn = $(`.tabbar [data-tab="${t}"]`);
    btn.classList.toggle('active', t === tab);
    btn.setAttribute('aria-current', t === tab ? 'page' : 'false');
    btn.classList.toggle('is-locked', NEEDS_KEY.has(t) && !ApiKey.isUsable());
  }

  const el = $('#view-' + tab);
  if (NEEDS_KEY.has(tab) && !ApiKey.isUsable()) {
    el.innerHTML = `<h1 class="view-title">${esc(tab[0].toUpperCase() + tab.slice(1))}</h1>` +
      lockedCard(tab === 'scan' ? 'Scanning' : 'Recipes');
  } else {
    RENDERERS[tab](el);
  }
  window.scrollTo(0, 0);
}

/** What views can call back into. */
const appApi = {
  refresh: () => show(current),
  go: (tab) => show(tab),
  openKeyScreen(mode) {
    const fromSettings = mode === 'replace' || mode === 'add';
    showKeyScreen(mode, {
      onSaved: () => show(fromSettings ? current : 'scan'),
      onDismiss: () => show(fromSettings ? current : 'pantry'),
    });
  },
};

/* ---------- Boot ---------- */

function init() {
  document.querySelectorAll('.tabbar [data-tab]').forEach(btn =>
    btn.addEventListener('click', () => show(btn.dataset.tab)));

  window.addEventListener('hashchange', () => show(location.hash.slice(1)));

  // "Add API key" buttons inside locked cards.
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="add-key"]')) appApi.openKeyScreen(ApiKey.get() ? 'rejected' : 'welcome');
  });

  // Any 401 from a real call sends the user back to the key screen.
  window.addEventListener(AUTH_FAILED_EVENT, () => {
    show(current === 'settings' ? 'settings' : 'pantry');
    appApi.openKeyScreen('rejected');
  });

  // Warn before closing the page with scan results that haven't been saved.
  window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedScan()) { e.preventDefault(); e.returnValue = ''; }
  });

  // Let people know when Scan and Recipes can't work.
  window.addEventListener('offline', () => toast("You're offline. Your pantry still works; scanning and recipes need a connection.", 'info', 5000));
  window.addEventListener('online', () => toast('Back online', 'success'));

  registerServiceWorker();

  show(location.hash.slice(1));
  if (!ApiKey.get()) appApi.openKeyScreen('welcome');
}

/**
 * Offline support. Service workers only run on HTTPS (or localhost), so on
 * http://<your-PC-IP> testing the app simply works online-only.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline mode unavailable; app still works */ });
  });
}

init();
