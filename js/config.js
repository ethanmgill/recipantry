/**
 * Pantry Snap: configuration.
 *
 * Everything you might want to tweak lives here: the model list, effort
 * levels, limits and (from milestone 2) the prompts sent to Claude.
 * No API key is ever stored in this file. Each user adds their own key in the app.
 */

export const CONFIG = {
  APP_NAME: 'Pantry Snap',
  APP_VERSION: '0.1.0',

  /** Anthropic Messages API endpoint. The key is only ever sent here. */
  API_URL: 'https://api.anthropic.com/v1/messages',

  /** Value for the `anthropic-version` header. */
  ANTHROPIC_VERSION: '2023-06-01',

  /** Models offered in Settings. The first entry with `default: true` is used until the user picks another. */
  MODELS: [
    { id: 'claude-opus-5-5',   label: 'Claude Opus 5.5 (most accurate)', default: true },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (balanced)' },
    { id: 'claude-haiku-5-5',  label: 'Claude Haiku 5.5 (cheapest)' },
  ],

  /**
   * Effort per task (`output_config.effort`). These models always think;
   * effort controls how much. Low keeps scans fast and cheap.
   */
  EFFORT: {
    keyTest: 'low',
    scan: 'low',
    recipes: 'medium',
  },

  /**
   * Server-side refusal fallback. If Claude declines a request (rare for food photos),
   * the API retries it on a suitable model within the same call.
   * Only Opus 5.5 / Sonnet 5.5 support this. Haiku requests are sent without it.
   * If the API ever rejects the parameter, the app turns it off automatically for the session.
   */
  REFUSAL_FALLBACK: {
    enabled: true,
    beta: 'server-side-fallback-2026-07-01',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5'],
  },

  /** Items expiring within this many days are highlighted amber. Past expiry shows red. */
  EXPIRY_SOON_DAYS: 3,

  /** Image sent to Claude: long edge in px and JPEG quality (0–1). */
  IMAGE_MAX_EDGE: 1024,
  IMAGE_QUALITY: 0.85,

  /** Thumbnail stored with each pantry item: square, px and JPEG quality. ~5–8 KB each. */
  THUMB_SIZE: 160,
  THUMB_QUALITY: 0.7,

  /** Max tokens per reply. Includes Claude's thinking, so keep it generous. */
  MAX_TOKENS: { scan: 16000, recipes: 16000 },

  /** How many photos are identified at the same time. Higher is faster but hits rate limits sooner. */
  SCAN_CONCURRENCY: 2,

  /** Confidence below this gets a "check this" warning on the review card. */
  LOW_CONFIDENCE: 0.5,

  /**
   * Browsers give each site roughly 5 MB of localStorage. The Pantry tab warns
   * once Pantry Snap's data passes STORAGE_WARN_BYTES.
   */
  STORAGE_LIMIT_BYTES: 5 * 1024 * 1024,
  STORAGE_WARN_BYTES: 4 * 1024 * 1024,
};

/** Pantry categories. Claude must pick one of these; you can edit the list. */
export const CATEGORIES = [
  'Produce', 'Dairy', 'Meat & Fish', 'Bakery', 'Pantry staples',
  'Frozen', 'Drinks', 'Snacks', 'Condiments', 'Other',
];

/** Every localStorage key the app uses. All are prefixed so "clear all data" only removes ours. */
export const STORAGE_KEYS = {
  apiKey: 'pantrysnap.anthropicApiKey',
  settings: 'pantrysnap.settings',
  inventory: 'pantrysnap.inventory',
  favourites: 'pantrysnap.favouriteRecipes',
  usage: 'pantrysnap.apiUsage',
};

/** Prompts sent to Claude. Edit freely. `{today}` is replaced with today's date (YYYY-MM-DD). */
export const PROMPTS = {
  /** Tiny prompt used to validate a key. Costs a fraction of a cent. */
  KEY_TEST: 'Reply with the single word OK.',

  /** System prompt for identifying food in a photo. */
  SCAN_SYSTEM: `You identify food items in photos for a home pantry app.
Return one entry per distinct food product you can see. Identical units go in one entry with a count (3 cans of the same beans -> quantity 3, unit "can").

- name: a short generic name you'd write on a shopping list ("Greek yogurt", "Spaghetti").
- brand: only if legible on the packaging, otherwise null. Don't guess.
- category: the closest match from the allowed list.
- quantity and unit: what is visible. Packaged goods use a package unit (can, bottle, jar, pack, box, bag, carton); loose produce uses pcs or an estimated weight in g or kg.
- expiry: only if a best-before or use-by date is legible, as YYYY-MM-DD. If only a month and year are shown, use the last day of that month. Otherwise null. Never invent a date.
- nutrition per serving: read it from the nutrition label if one is visible (nutritionSource "label"); otherwise give typical values for that product (nutritionSource "estimated"). Calories in kcal; protein, carbs, fat, fibre and sugar in grams; sodium in milligrams. Use null for anything you can't determine.
- confidence: 0 to 1, how sure you are of the item's identity.

Ignore non-food objects. If there is no food in the photo, return an empty items list.`,

  /** User message sent alongside each photo. */
  SCAN_USER: "Identify the food items in this photo. Today's date is {today}.",

  /** System prompt for "What can I make?". */
  RECIPES_SYSTEM: `You are a practical home cook helping someone use what's in their pantry. Suggest 3 to 5 recipes they can make mostly from the pantry list.

- Use ingredients that expire soonest first. If any item expires within 3 days, every recipe should use at least one of them, and list them in usesExpiringSoon.
- Assume salt, pepper, cooking oil and water are always available; never list them as missing.
- Keep missing ingredients few (ideally 0-3), common and cheap.
- Follow every filter strictly. If the pantry can't meet them, return fewer recipes rather than break a filter.
- ingredientsHave: only items from the pantry list, using the pantry's names, with the amount the recipe uses.
- Steps: short imperative sentences, in order.
- Times in minutes. Nutrition per serving is a rough estimate: calories in kcal; protein, carbs, fat, fibre and sugar in grams; sodium in milligrams.`,

  /** User message for recipes. {today}, {filters} and {pantry} are filled in by the app. */
  RECIPES_USER: "Today's date is {today}.\nFilters: {filters}\n\nMy pantry:\n{pantry}",
};

/** Recipe filter choices shown on the Recipes tab. */
export const RECIPE_FILTERS = {
  DIETARY: ['Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free', 'Low-carb', 'High-protein'],
  MAX_MINUTES: [0, 15, 30, 45, 60], // 0 = any
  MEAL_TYPES: ['Any', 'Breakfast', 'Lunch', 'Dinner', 'Snack', 'Dessert'],
};

/* ---------- JSON schemas Claude's replies must follow ---------- */

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });

const ingredientList = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['item', 'amount'],
    properties: { item: { type: 'string' }, amount: { type: 'string' } },
  },
};

export const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['recipes'],
  properties: {
    recipes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'description', 'mealType', 'prepMinutes', 'cookMinutes', 'servings',
          'usesExpiringSoon', 'ingredientsHave', 'ingredientsMissing', 'steps', 'nutritionPerServing'],
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          mealType: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack', 'dessert'] },
          prepMinutes: { type: 'number' },
          cookMinutes: { type: 'number' },
          servings: { type: 'number' },
          usesExpiringSoon: { type: 'array', items: { type: 'string' } },
          ingredientsHave: ingredientList,
          ingredientsMissing: ingredientList,
          steps: { type: 'array', items: { type: 'string' } },
          nutritionPerServing: {
            type: 'object',
            additionalProperties: false,
            required: ['calories', 'protein', 'carbs', 'fat', 'fibre', 'sugar', 'sodium'],
            properties: {
              calories: nullable({ type: 'number' }),
              protein: nullable({ type: 'number' }),
              carbs: nullable({ type: 'number' }),
              fat: nullable({ type: 'number' }),
              fibre: nullable({ type: 'number' }),
              sugar: nullable({ type: 'number' }),
              sodium: nullable({ type: 'number' }),
            },
          },
        },
      },
    },
  },
};

export const SCAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'brand', 'category', 'quantity', 'unit', 'expiry', 'nutrition', 'nutritionSource', 'confidence'],
        properties: {
          name: { type: 'string' },
          brand: nullable({ type: 'string' }),
          category: { type: 'string', enum: CATEGORIES },
          quantity: { type: 'number' },
          unit: { type: 'string' },
          expiry: nullable({ type: 'string', format: 'date' }),
          nutrition: {
            type: 'object',
            additionalProperties: false,
            required: ['servingSize', 'calories', 'protein', 'carbs', 'fat', 'fibre', 'sugar', 'sodium'],
            properties: {
              servingSize: nullable({ type: 'string' }),
              calories: nullable({ type: 'number' }),
              protein: nullable({ type: 'number' }),
              carbs: nullable({ type: 'number' }),
              fat: nullable({ type: 'number' }),
              fibre: nullable({ type: 'number' }),
              sugar: nullable({ type: 'number' }),
              sodium: nullable({ type: 'number' }),
            },
          },
          nutritionSource: { type: 'string', enum: ['label', 'estimated'] },
          confidence: { type: 'number' },
        },
      },
    },
  },
};
