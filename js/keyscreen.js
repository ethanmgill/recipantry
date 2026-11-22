/**
 * Pantry Snap: API key screen.
 *
 * Used for first-launch onboarding, replacing a key from Settings, and
 * coming back after Anthropic rejects a saved key (401).
 */
import { ApiKey } from './storage.js';
import { testKey } from './api.js';
import { $, esc, withBusy } from './ui.js';

const INTRO = {
  welcome: {
    title: 'Welcome to Pantry Snap',
    lead: 'Snap your groceries, keep track of what you have, and get recipe ideas from Claude.',
  },
  add: {
    title: 'Add your API key',
    lead: 'Paste your Anthropic API key to unlock scanning and recipes.',
  },
  replace: {
    title: 'Replace API key',
    lead: 'Paste a new Anthropic API key. It is tested before it replaces your current one.',
  },
  rejected: {
    title: 'Your API key needs attention',
    lead: 'Anthropic rejected the saved key. It may have been revoked or expired. Paste a working key to continue.',
  },
};

/**
 * Show the key screen.
 * @param {'welcome'|'add'|'replace'|'rejected'} mode
 * @param {object} handlers { onSaved(), onDismiss() }
 */
export function showKeyScreen(mode, { onSaved, onDismiss } = {}) {
  const root = $('#keyscreen');
  const intro = INTRO[mode] || INTRO.welcome;
  const dismissLabel = (mode === 'replace' || mode === 'add') ? 'Cancel' : 'Skip for now (view pantry only)';

  root.innerHTML = `
    <div class="keyscreen-inner">
      <div class="brand-mark" aria-hidden="true">🥫</div>
      <h1 id="keyscreen-title">${esc(intro.title)}</h1>
      <p class="lead">${esc(intro.lead)}</p>

      <form id="key-form" class="card" novalidate>
        <label for="key-input">Anthropic API key</label>
        <div class="input-row">
          <input id="key-input" type="password" inputmode="text" autocomplete="off" autocapitalize="off"
                 autocorrect="off" spellcheck="false" placeholder="sk-ant-..." required>
          <button type="button" class="btn ghost small" id="key-toggle" aria-pressed="false">Show</button>
        </div>
        <p class="hint">
          Don't have one? Create a key at
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com</a>.
          Your key is stored only on this device and is sent only to Anthropic (api.anthropic.com).
        </p>
        <div id="key-status" class="status" role="status" aria-live="polite"></div>
        <button type="submit" class="btn primary block" id="key-save">Test &amp; save key</button>
      </form>

      <button type="button" class="btn link" id="key-dismiss">${esc(dismissLabel)}</button>
    </div>`;

  root.hidden = false;
  document.body.classList.add('modal-open');

  const input = $('#key-input', root);
  const status = $('#key-status', root);
  const toggle = $('#key-toggle', root);

  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Hide' : 'Show';
    toggle.setAttribute('aria-pressed', String(show));
  });

  $('#key-form', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = input.value.trim();
    if (!key) return setStatus(status, 'error', 'Paste your API key first.');
    if (!key.startsWith('sk-ant-')) {
      return setStatus(status, 'error', 'That doesn\'t look like an Anthropic API key. They start with "sk-ant-".');
    }
    setStatus(status, 'info', 'Checking your key with Anthropic…');
    await withBusy($('#key-save', root), 'Testing…', async () => {
      try {
        await testKey(key);
        ApiKey.set(key);
        input.value = '';
        setStatus(status, 'success', 'Key works. Saved on this device.');
        setTimeout(() => { hideKeyScreen(); onSaved?.(); }, 700);
      } catch (err) {
        setStatus(status, 'error', keyErrorMessage(err));
      }
    });
  });

  $('#key-dismiss', root).addEventListener('click', () => { hideKeyScreen(); onDismiss?.(); });
  setTimeout(() => input.focus(), 50);
}

export function hideKeyScreen() {
  const root = $('#keyscreen');
  root.hidden = true;
  root.innerHTML = ''; // drop the input (and anything typed) from the DOM
  document.body.classList.remove('modal-open');
}

/** Friendlier wording for the errors you can hit while testing a key. */
export function keyErrorMessage(err) {
  switch (err?.kind) {
    case 'auth': return 'Invalid API key. Check you copied the whole key, or create a new one in the Anthropic Console.';
    case 'credit': return 'This key works, but the account has no credit. Add credit under Billing at console.anthropic.com.';
    case 'permission': return 'This key isn\'t allowed to use the API. Check its workspace permissions in the Console.';
    case 'model': return 'Key accepted, but the selected model isn\'t available to it. Pick another model in Settings.';
    case 'offline':
    case 'network': return err.message;
    default: return err?.message || 'Something went wrong. Please try again.';
  }
}

function setStatus(el, type, text) {
  el.className = `status ${type}`;
  el.textContent = text;
}
