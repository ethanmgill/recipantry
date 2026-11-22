/**
 * Pantry Snap: ask Claude for recipe ideas from the pantry.
 * Only item names, quantities, units and expiry dates are sent. No photos, brands or nutrition.
 */
import { CONFIG, PROMPTS, RECIPE_SCHEMA } from './config.js';
import { callClaude, responseText, ApiError } from './api.js';
import { Inventory, Settings, newId } from './storage.js';
import { todayISO, daysUntil } from './dates.js';

/** Pantry items that can be cooked with: in stock and not past their expiry date. Soonest first. */
export function usableItems() {
  return Inventory.all()
    .filter(i => i.quantity > 0 && !(daysUntil(i.expiry) < 0))
    .sort((a, b) => (daysUntil(a.expiry) ?? 99999) - (daysUntil(b.expiry) ?? 99999));
}

/** The pantry list exactly as it is sent to Claude. */
export function pantryText(items) {
  return items.map(i => {
    const qty = Number((i.quantity || 0).toFixed(2));
    const exp = i.expiry ? `expires ${i.expiry}` : 'no expiry date';
    return `- ${oneLine(i.name)}: ${qty} ${oneLine(i.unit)}, ${exp}`;
  }).join('\n');
}

/** Filters as a sentence, e.g. "dietary: vegetarian, gluten-free; max total time: 30 min; meal type: dinner". */
export function filtersText(f) {
  const parts = [];
  const diet = [...(f.dietary || []), (f.other || '').trim()].filter(Boolean).map(s => oneLine(s).toLowerCase());
  if (diet.length) parts.push(`dietary: ${diet.join(', ')}`);
  if (f.maxMinutes) parts.push(`max total time: ${f.maxMinutes} min`);
  if (f.mealType && f.mealType !== 'Any') parts.push(`meal type: ${f.mealType.toLowerCase()}`);
  return parts.length ? parts.join('; ') : 'none';
}

/** Keep user text on one line so it can't break the prompt's layout. */
function oneLine(s) {
  return String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
}

/** Request recipes. Resolves to normalised recipe objects (each with a fresh id). */
export async function suggestRecipes(filters, { signal } = {}) {
  const items = usableItems();
  if (!items.length) throw new ApiError('bad_request', 'Add some in-date items to your pantry first.');

  const user = PROMPTS.RECIPES_USER
    .replace('{today}', todayISO())
    .replace('{filters}', filtersText(filters))
    .replace('{pantry}', pantryText(items));

  const data = await callClaude({
    model: Settings.get().model,
    max_tokens: CONFIG.MAX_TOKENS.recipes,
    system: PROMPTS.RECIPES_SYSTEM,
    output_config: {
      effort: CONFIG.EFFORT.recipes,
      format: { type: 'json_schema', schema: RECIPE_SCHEMA },
    },
    messages: [{ role: 'user', content: user }],
  }, { signal });

  if (data.stop_reason === 'max_tokens') {
    throw new ApiError('parse', "Claude's answer was cut off. Please try again.");
  }
  return parseRecipes(responseText(data));
}

/* ---------- Defensive parsing ---------- */

export function parseRecipes(text) {
  let obj = tryParse(text);
  if (!obj) {
    const cleaned = String(text).replace(/```(?:json)?/gi, '');
    const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
    if (s !== -1 && e > s) obj = tryParse(cleaned.slice(s, e + 1));
  }
  const list = Array.isArray(obj) ? obj : obj?.recipes;
  if (!Array.isArray(list)) throw new ApiError('parse', "Couldn't read Claude's recipes. Please try again.");
  const recipes = list.filter(r => r && typeof r === 'object').map(normaliseRecipe).filter(r => r.title);
  if (!recipes.length) {
    throw new ApiError('parse', "Claude couldn't find recipes that fit these filters. Try loosening them.");
  }
  return recipes;
}

function tryParse(s) { try { return JSON.parse(s); } catch { return null; } }

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const num = (v) => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) && n >= 0 ? n : null; };
const strList = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const ingList = (v) => (Array.isArray(v) ? v
  .map(x => (typeof x === 'string' ? { item: x.trim(), amount: '' } : { item: str(x?.item), amount: str(x?.amount) }))
  .filter(x => x.item) : []);

export function normaliseRecipe(r) {
  const n = r.nutritionPerServing && typeof r.nutritionPerServing === 'object' ? r.nutritionPerServing : {};
  const meal = str(r.mealType).toLowerCase();
  return {
    id: typeof r.id === 'string' && r.id ? r.id : newId(),
    title: str(r.title),
    description: str(r.description),
    mealType: ['breakfast', 'lunch', 'dinner', 'snack', 'dessert'].includes(meal) ? meal : null,
    prepMinutes: num(r.prepMinutes),
    cookMinutes: num(r.cookMinutes),
    servings: num(r.servings),
    usesExpiringSoon: strList(r.usesExpiringSoon),
    ingredientsHave: ingList(r.ingredientsHave),
    ingredientsMissing: ingList(r.ingredientsMissing),
    steps: strList(r.steps),
    nutritionPerServing: {
      calories: num(n.calories), protein: num(n.protein), carbs: num(n.carbs), fat: num(n.fat),
      fibre: num(n.fibre), sugar: num(n.sugar), sodium: num(n.sodium),
    },
  };
}
