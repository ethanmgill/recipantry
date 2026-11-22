/**
 * Pantry Snap: JSON backup export/import.
 * Backups contain your pantry and saved recipes. They NEVER contain your API key or settings.
 */
import { CONFIG, STORAGE_KEYS } from './config.js';
import { Inventory, readJSON, writeJSON, newId } from './storage.js';
import { normaliseItem } from './identify.js';
import { todayISO } from './dates.js';

const FORMAT = 'pantry-snap-backup';
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** Download a backup file. */
export function exportBackup() {
  const data = {
    format: FORMAT,
    version: 1,
    app: CONFIG.APP_NAME,
    exportedAt: new Date().toISOString(),
    inventory: Inventory.all(),
    favourites: readJSON(STORAGE_KEYS.favourites, []),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pantry-snap-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return data.inventory.length;
}

/**
 * Read and validate a backup file. Doesn't change anything yet.
 * Accepts our backup format or a bare array of items.
 * @returns {Promise<{ items: object[], favourites: object[] }>}
 */
export async function readBackupFile(file) {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('That file is too large to be a Pantry Snap backup.');
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't valid JSON. Choose a backup exported from Pantry Snap.");
  }
  const rawItems = Array.isArray(data) ? data : data?.inventory;
  if (!Array.isArray(rawItems)) throw new Error("That file doesn't look like a Pantry Snap backup.");

  const items = rawItems.filter(x => x && typeof x === 'object').map(sanitiseStoredItem);
  const favourites = Array.isArray(data?.favourites)
    ? data.favourites.filter(f => f && typeof f === 'object' && typeof f.title === 'string')
    : [];
  return { items, favourites };
}

/** Clean an item from a file: same rules as scan results, plus id/addedAt/thumb. */
function sanitiseStoredItem(raw) {
  const thumbOk = typeof raw.thumb === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(raw.thumb) && raw.thumb.length < 100000;
  const added = typeof raw.addedAt === 'string' && !isNaN(new Date(raw.addedAt)) ? raw.addedAt : new Date().toISOString();
  const item = normaliseItem(raw);
  // Quantity 0 ("used up") is allowed in the pantry, unlike in scan results.
  if (raw.quantity === 0) item.quantity = 0;
  return {
    ...item,
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    addedAt: added,
    thumb: thumbOk ? raw.thumb : null,
  };
}

/**
 * Apply an import.
 * mode 'merge': add items/recipes whose id isn't already here. 'replace': swap everything.
 * Throws StorageFullError if it doesn't fit (nothing is changed in that case).
 * @returns {{ added: number, skipped: number }}
 */
export function applyImport({ items, favourites }, mode) {
  const currentItems = Inventory.all();
  const currentFavs = readJSON(STORAGE_KEYS.favourites, []);

  let nextItems, nextFavs, added, skipped;
  if (mode === 'replace') {
    nextItems = items;
    nextFavs = favourites;
    added = items.length;
    skipped = 0;
  } else {
    const ids = new Set(currentItems.map(i => i.id));
    const fresh = items.filter(i => !ids.has(i.id));
    nextItems = [...currentItems, ...fresh];
    const favIds = new Set(currentFavs.map(f => f.id));
    nextFavs = [...currentFavs, ...favourites.filter(f => !favIds.has(f.id))];
    added = fresh.length;
    skipped = items.length - fresh.length;
  }

  // Write items first; if favourites then fail, roll items back so nothing is half-applied.
  Inventory.save(nextItems);
  try {
    writeJSON(STORAGE_KEYS.favourites, nextFavs);
  } catch (e) {
    Inventory.save(currentItems);
    throw e;
  }
  return { added, skipped };
}
