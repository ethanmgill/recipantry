/**
 * Pantry Snap: send one photo to Claude and turn the reply into clean item drafts.
 */
import { CONFIG, CATEGORIES, PROMPTS, SCAN_SCHEMA } from './config.js';
import { callClaude, responseText, ApiError } from './api.js';
import { Settings } from './storage.js';
import { todayISO, isValidISODate } from './dates.js';

/**
 * Identify food in one prepared photo.
 * @param {string} base64  JPEG data without the "data:" prefix
 * @returns {Promise<object[]>} normalised item drafts (may be empty)
 */
export async function identifyPhoto(base64, { signal } = {}) {
  const data = await callClaude({
    model: Settings.get().model,
    max_tokens: CONFIG.MAX_TOKENS.scan,
    system: PROMPTS.SCAN_SYSTEM,
    output_config: {
      effort: CONFIG.EFFORT.scan,
      format: { type: 'json_schema', schema: SCAN_SCHEMA },
    },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
        { type: 'text', text: PROMPTS.SCAN_USER.replace('{today}', todayISO()) },
      ],
    }],
  }, { signal });

  if (data.stop_reason === 'max_tokens') {
    throw new ApiError('parse', 'Claude\'s answer was cut off. Try a photo with fewer items.');
  }
  return parseScanReply(responseText(data));
}

/**
 * Defensive parse. The schema should guarantee valid JSON, but we still
 * strip code fences, pull out the outermost object, and sanity-check every field.
 */
export function parseScanReply(text) {
  let obj = tryParse(text);
  if (!obj) {
    const cleaned = String(text).replace(/```(?:json)?/gi, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) obj = tryParse(cleaned.slice(start, end + 1));
  }
  const list = Array.isArray(obj) ? obj : obj?.items;
  if (!Array.isArray(list)) {
    throw new ApiError('parse', "Couldn't read Claude's answer for this photo. Please try again.");
  }
  return list.filter(x => x && typeof x === 'object').map(normaliseItem);
}

function tryParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
};
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Coerce one raw item into the app's item shape. Never throws. */
export function normaliseItem(raw) {
  const n = raw.nutrition && typeof raw.nutrition === 'object' ? raw.nutrition : {};
  const qty = num(raw.quantity);
  const conf = num(raw.confidence);
  return {
    name: str(raw.name) || 'Unknown item',
    brand: str(raw.brand),
    category: CATEGORIES.includes(raw.category) ? raw.category : 'Other',
    quantity: qty && qty > 0 ? qty : 1,
    unit: str(raw.unit) || 'pcs',
    expiry: isValidISODate(raw.expiry) ? raw.expiry : null,
    nutrition: {
      servingSize: str(n.servingSize),
      calories: num(n.calories),
      protein: num(n.protein),
      carbs: num(n.carbs),
      fat: num(n.fat),
      fibre: num(n.fibre),
      sugar: num(n.sugar),
      sodium: num(n.sodium),
    },
    nutritionSource: raw.nutritionSource === 'label' ? 'label' : 'estimated',
    confidence: conf == null ? null : Math.min(1, Math.max(0, conf)),
  };
}
