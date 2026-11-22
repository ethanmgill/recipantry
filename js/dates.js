/**
 * Pantry Snap: date helpers. All dates are local calendar dates written as YYYY-MM-DD.
 */
import { CONFIG } from './config.js';

/** Local date as YYYY-MM-DD (not UTC, so it's right late in the evening too). */
export function todayISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30). */
export function isValidISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00');
  return !isNaN(d) && todayISO(d) === s;
}

/** Whole days from today until `iso` (negative = in the past). null if no valid date. */
export function daysUntil(iso, now = new Date()) {
  if (!isValidISODate(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}

/**
 * How to show an expiry date.
 * level: 'past' (red) | 'soon' (amber, within EXPIRY_SOON_DAYS) | 'ok' | null (no date)
 */
export function expiryInfo(iso) {
  const d = daysUntil(iso);
  if (d == null) return { level: null, label: 'No expiry date', days: null };
  if (d < 0) return { level: 'past', label: d === -1 ? 'Expired yesterday' : `Expired ${-d} days ago`, days: d };
  if (d === 0) return { level: 'soon', label: 'Expires today', days: d };
  if (d === 1) return { level: 'soon', label: 'Expires tomorrow', days: d };
  if (d <= CONFIG.EXPIRY_SOON_DAYS) return { level: 'soon', label: `Expires in ${d} days`, days: d };
  const date = new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined });
  return { level: 'ok', label: `Expires ${date}`, days: d };
}
