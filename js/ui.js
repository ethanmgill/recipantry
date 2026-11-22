/**
 * Pantry Snap: small UI helpers shared by every view.
 */

/** Escape text for safe insertion into HTML. Use for ALL user- or Claude-provided text. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Shorthand for querySelector within an optional root. */
export const $ = (sel, root = document) => root.querySelector(sel);

let toastTimer;
/** Show a short message at the bottom of the screen. type: 'info' | 'success' | 'error' */
export function toast(message, type = 'info', ms = 3500) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, ms);
}

/** Put a button into a loading state while `fn` runs. Returns fn's result. */
export async function withBusy(button, busyLabel, fn) {
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${esc(busyLabel)}`;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

/** Shown in place of Scan/Recipes until a working key is saved. */
export function lockedCard(featureName) {
  return `
    <div class="card locked">
      <div class="locked-icon" aria-hidden="true">🔒</div>
      <h2>${esc(featureName)} needs an API key</h2>
      <p class="muted">Add your own Anthropic API key to use ${esc(featureName.toLowerCase())}. It stays on this device.</p>
      <button class="btn primary" data-action="add-key">Add API key</button>
    </div>`;
}
