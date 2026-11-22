/**
 * Pantry Snap: localStorage helpers.
 *
 * All persistent data lives in this browser's localStorage, under the keys
 * in STORAGE_KEYS. Nothing is sent to any server except the Anthropic API calls in api.js.
 */
import { CONFIG, STORAGE_KEYS } from './config.js';

/** Thrown when localStorage refuses a write because it is full. */
export class StorageFullError extends Error {
  constructor() {
    super('Storage on this device is full. Delete some items or export a backup and clear old data.');
    this.name = 'StorageFullError';
  }
}

export function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    if (isQuotaError(e)) throw new StorageFullError();
    throw e;
  }
}

function isQuotaError(e) {
  return e instanceof DOMException &&
    (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);
}

/* ---------- API key ---------- */

export const ApiKey = {
  get() {
    try { return localStorage.getItem(STORAGE_KEYS.apiKey) || ''; } catch { return ''; }
  },
  set(key) {
    localStorage.setItem(STORAGE_KEYS.apiKey, key);
    Settings.update({ keyRejected: false });
  },
  clear() {
    localStorage.removeItem(STORAGE_KEYS.apiKey);
    Settings.update({ keyRejected: false });
  },
  /** "sk-ant-…abcd". Safe to show on screen. */
  mask(key) {
    if (!key) return '';
    if (key.length <= 12) return '…' + key.slice(-4);
    return key.slice(0, 7) + '…' + key.slice(-4);
  },
  /** True when a key is saved and the API hasn't rejected it since. */
  isUsable() {
    return !!this.get() && !Settings.get().keyRejected;
  },
};

/* ---------- Settings ---------- */

function defaultModel() {
  return (CONFIG.MODELS.find(m => m.default) || CONFIG.MODELS[0]).id;
}

export const Settings = {
  get() {
    const saved = readJSON(STORAGE_KEYS.settings, {});
    const s = { model: defaultModel(), keyRejected: false, ...saved };
    // If a model was removed from CONFIG, fall back to the default.
    if (!CONFIG.MODELS.some(m => m.id === s.model)) s.model = defaultModel();
    return s;
  },
  update(patch) {
    const next = { ...this.get(), ...patch };
    writeJSON(STORAGE_KEYS.settings, next);
    return next;
  },
};

/* ---------- API usage counter (rough, per device) ---------- */

export const Usage = {
  get() {
    return readJSON(STORAGE_KEYS.usage, null) || { calls: 0, since: new Date().toISOString() };
  },
  increment() {
    const u = this.get();
    u.calls += 1;
    try { writeJSON(STORAGE_KEYS.usage, u); } catch { /* counter is best-effort */ }
  },
  reset() {
    writeJSON(STORAGE_KEYS.usage, { calls: 0, since: new Date().toISOString() });
  },
};

/* ---------- Inventory ---------- */

/** Unique id. crypto.randomUUID needs HTTPS or localhost, so fall back on plain-HTTP LAN testing. */
export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export const Inventory = {
  all() {
    const list = readJSON(STORAGE_KEYS.inventory, []);
    return Array.isArray(list) ? list : [];
  },
  /** Replace the whole list. Throws StorageFullError if it doesn't fit. */
  save(list) {
    writeJSON(STORAGE_KEYS.inventory, list);
  },
  /** Add reviewed items. Each gets an id and addedAt. Returns the saved items. */
  addMany(items) {
    const now = new Date().toISOString();
    const added = items.map(it => ({ ...it, id: newId(), addedAt: now }));
    this.save([...this.all(), ...added]);
    return added;
  },
};

/* ---------- Favourite recipes ---------- */

export const Favourites = {
  all() {
    const list = readJSON(STORAGE_KEYS.favourites, []);
    return Array.isArray(list) ? list : [];
  },
  has(id) {
    return this.all().some(r => r.id === id);
  },
  /** Save a recipe (it must have an id). Throws StorageFullError if it doesn't fit. */
  add(recipe) {
    if (this.has(recipe.id)) return;
    writeJSON(STORAGE_KEYS.favourites, [{ ...recipe, savedAt: new Date().toISOString() }, ...this.all()]);
  },
  remove(id) {
    writeJSON(STORAGE_KEYS.favourites, this.all().filter(r => r.id !== id));
  },
};

/* ---------- Housekeeping ---------- */

/** Removes every Pantry Snap key (including the API key). Leaves other sites' data alone. */
export function clearAllData() {
  Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
}

/**
 * Approximate bytes used by Pantry Snap data, counted as UTF-16 (2 bytes per char).
 * Browsers measure their quota differently; this is the conservative reading,
 * which matches the strictest case (Safari). A real write failure is still caught as StorageFullError.
 */
export function bytesUsed() {
  let chars = 0;
  for (const k of Object.values(STORAGE_KEYS)) {
    const v = localStorage.getItem(k);
    if (v) chars += k.length + v.length;
  }
  return chars * 2;
}
