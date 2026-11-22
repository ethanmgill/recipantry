/**
 * Pantry Snap: Settings tab.
 * API key management, model choice, usage counter and "clear all data".
 */
import { CONFIG } from './config.js';
import { ApiKey, Settings, Usage, clearAllData, bytesUsed } from './storage.js';
import { testKey } from './api.js';
import { keyErrorMessage } from './keyscreen.js';
import { $, esc, toast, withBusy } from './ui.js';

/**
 * @param {HTMLElement} el  view container
 * @param {object} app      { openKeyScreen(mode), refresh() }
 */
export function renderSettings(el, app) {
  const key = ApiKey.get();
  const s = Settings.get();
  const usage = Usage.get();
  const since = new Date(usage.since).toLocaleDateString();
  const kb = Math.round(bytesUsed() / 1024);

  const keyBlock = key ? `
      <div class="key-display">
        <code id="key-value" data-shown="false">${esc(ApiKey.mask(key))}</code>
        <span class="badge ${s.keyRejected ? 'warn' : 'ok'}">${s.keyRejected ? 'Rejected' : 'Saved'}</span>
      </div>
      <div class="btn-grid">
        <button class="btn" data-act="show">Show</button>
        <button class="btn" data-act="retest">Re-test</button>
        <button class="btn" data-act="replace">Replace</button>
        <button class="btn danger-outline" data-act="remove">Remove</button>
      </div>
      <div id="retest-status" class="status" role="status" aria-live="polite"></div>`
    : `
      <p class="muted">No key saved. Scan and Recipes are locked until you add one.</p>
      <button class="btn primary block" data-act="replace">Add API key</button>`;

  el.innerHTML = `
    <h1 class="view-title">Settings</h1>

    <section class="card">
      <h2>Anthropic API key</h2>
      ${keyBlock}
      <p class="hint">Your key is stored only in this browser and is sent only to api.anthropic.com.</p>
    </section>

    <section class="card">
      <h2><label for="model-select">Claude model</label></h2>
      <select id="model-select">
        ${CONFIG.MODELS.map(m => `<option value="${esc(m.id)}" ${m.id === s.model ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
      </select>
      <p class="hint">Used for scans and recipes. Cheaper models cost less per call but may misread labels.</p>
    </section>

    <section class="card">
      <h2>Usage on this device</h2>
      <p><strong>${usage.calls}</strong> API call${usage.calls === 1 ? '' : 's'} since ${esc(since)}.</p>
      <p class="hint">A rough count. See exact usage and cost at
        <a href="https://console.anthropic.com/usage" target="_blank" rel="noopener noreferrer">console.anthropic.com/usage</a>.</p>
      <button class="btn small" data-act="reset-usage">Reset counter</button>
    </section>

    <section class="card">
      <h2>Data</h2>
      <p class="muted">Pantry Snap is using about ${kb} KB of this browser's storage.</p>
      <button class="btn danger block" data-act="clear-all">Clear all data</button>
      <p class="hint">Deletes your pantry, saved recipes, settings and API key from this device. This can't be undone.</p>
    </section>

    <p class="footer-note">${esc(CONFIG.APP_NAME)} v${esc(CONFIG.APP_VERSION)}</p>`;

  $('#model-select', el).addEventListener('change', (e) => {
    Settings.update({ model: e.target.value });
    toast('Model updated', 'success');
  });

  el.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => handle(btn.dataset.act, btn)));

  async function handle(act, btn) {
    switch (act) {
      case 'show': {
        const code = $('#key-value', el);
        const shown = code.dataset.shown === 'true';
        code.textContent = shown ? ApiKey.mask(ApiKey.get()) : ApiKey.get();
        code.dataset.shown = String(!shown);
        btn.textContent = shown ? 'Show' : 'Hide';
        break;
      }
      case 'retest': {
        await withBusy(btn, 'Testing…', async () => {
          try {
            await testKey(ApiKey.get());
            Settings.update({ keyRejected: false });
            app.refresh();
            toast('Key works', 'success');
          } catch (err) {
            if (err.kind === 'auth') Settings.update({ keyRejected: true });
            // Re-render so the badge, tab locks and usage count update, then show the reason.
            app.refresh();
            const fresh = $('#retest-status', el);
            if (fresh) {
              fresh.className = 'status error';
              fresh.textContent = keyErrorMessage(err);
            }
          }
        });
        break;
      }
      case 'replace':
        app.openKeyScreen(ApiKey.get() ? 'replace' : 'add');
        break;
      case 'remove':
        if (confirm('Remove the API key from this device? Scan and Recipes will be locked until you add one again.')) {
          ApiKey.clear();
          toast('API key removed');
          app.refresh();
        }
        break;
      case 'reset-usage':
        Usage.reset();
        app.refresh();
        break;
      case 'clear-all':
        if (confirm('Delete ALL Pantry Snap data on this device: pantry items, saved recipes, settings and your API key?\n\nThis can\'t be undone. Export a backup from the Pantry tab first if you want one.')) {
          clearAllData();
          toast('All data cleared');
          app.refresh();
          app.openKeyScreen('welcome');
        }
        break;
    }
  }
}
