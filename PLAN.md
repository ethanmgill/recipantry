# Pantry Snap: project plan

Status as of 2026-11-22: **paused at a stopping point.** All five milestones are built and tested
locally and on a phone (over the local network). Not yet deployed to Vercel.

## Milestones

| # | Milestone | Status |
|---|-----------|--------|
| 1 | Shell, API key onboarding, Settings, tab bar | Done |
| 2 | Scan: photo → Claude → review cards → save | Done, tested on phone with a real key |
| 3 | Pantry: search, filter, sort, ± buttons, expiry highlights, export/import, storage warning | Done |
| 3b | Duplicate merging: review-card suggestions, "Merge duplicates", manual "Merge items" | Done |
| 4 | Recipes: "What can I make?", filters, favourites | Done, tested on phone with a real key |
| 5 | PWA (manifest + offline service worker), README, Vercel deploy steps | Built and tested offline locally; waiting for first deploy |

Confidence scores given at each check-in: M1 ~90%, M2 ~80%, M3 ~90%, merging ~90%, M4 ~82%,
M5 ~88%. Overall ~90%.

## Next steps when we pick this back up

1. **Deploy to Vercel**: GitHub + Vercel (auto-deploy on push) or the Vercel CLI. Steps are in
   README.md, section 3. The user hasn't picked one yet.
2. Check on the real `https://` URL: install to the home screen (iPhone and Android), offline
   reload, the camera, and the key flow.
3. Move the test pantry from `http://10.0.0.213:3000` to the Vercel URL with Export / Import JSON
   (each origin has its own storage).
4. Then go through the future features below.

## Decisions made

**Stack and hosting**
- Plain HTML/CSS/vanilla JS ES modules, no build step, no framework, no serverless functions.
  Static hosting on the Vercel Hobby tier. No `vercel.json`; `.vercelignore` excludes `.claude`
  and `PLAN.md`.
- Hash routing (`#scan`, `#pantry`, `#recipes`, `#settings`).
- CSP meta tag: `connect-src 'self' https://api.anthropic.com`.

**API key (bring your own key)**
- No key in the code or in Vercel env vars, ever. The key is stored in localStorage at
  `pantrysnap.anthropicApiKey`. It is never logged, never exported, and sent only to
  `api.anthropic.com`.
- Welcome screen on first launch, with a "Skip for now (view pantry only)" option. Requires the
  `sk-ant-` prefix and is checked with a tiny test call before saving.
- Scan and Recipes are locked without a usable key; Pantry works without one.
- A 401 marks the key as rejected and reopens the key screen.
- Settings: masked key with Show / Re-test / Replace / Remove, model dropdown, API call counter
  with reset, storage used, and Clear all data (this also removes the key).

**Claude API**
- Direct browser `fetch` with the `anthropic-dangerous-direct-browser-access` header and
  `anthropic-version: 2023-06-01`.
- Default model `claude-opus-5-5`; Sonnet 5.5 and Haiku 5.5 are selectable.
- Effort: low for scans and key tests, medium for recipes.
- Replies are forced into JSON with `output_config.format` schemas (SCAN_SCHEMA, RECIPE_SCHEMA),
  plus a defensive parse.
- Refusal fallback beta is on for Opus/Sonnet, with an automatic retry without it if rejected.
- All prompts, schemas, models and tunables are in `js/config.js`.

**Scan**
- Two buttons: Take photo (camera) and Choose photos (multiple).
- Images are resized on the device to 1024px JPEG; a 160px thumbnail is kept. 2 photos are
  processed at a time.
- Editable review cards with confidence and nutrition-source (label vs estimated) badges.
  Unticked items are discarded.

**Pantry**
- Amber = expiring within 3 days, red = expired.
- Quantity 0 shows "Used up" rather than deleting. −/+ step by 1. Edit doesn't cover nutrition.
- Sort options: newest first, expiring soonest, name A–Z.
- JSON export/import (merge or replace). Backups never include the key.
- Storage warning above ~4MB.

**Duplicate merging**
- Matching uses name + unit (normalised), ignoring brand. Merges keep the earliest expiry.
- The review card suggests merging, a banner offers "Merge duplicates", and there's a manual
  "Merge items" mode: select items (yellow) → Next → pick the parent (blue) → ✓. The parent keeps
  its data and expiry; quantities are summed. A warning appears if units differ.

**Recipes**
- 3–5 recipes that prioritise expiring items. Salt, pepper, oil and water are assumed available.
- Filters: dietary chips plus free text, max time, meal type; remembered in settings.
- Results are kept in memory only; starred recipes are saved to favourites.

**PWA**
- Manifest plus icons (including maskable and apple-touch).
- The service worker is network-first with a 4s timeout and falls back to the cache. It only
  registers on HTTPS or localhost.
- Bump `CACHE_VERSION` in `sw.js` when the file list changes.

## Testing notes

- Local preview: `npx serve .` from the project folder (or the `.claude/launch.json` config on
  port 5173). From the phone, use the PC's Wi-Fi IP (10.0.0.213), not the Tailscale `100.x`
  address.
- Tested with mocked API responses in the browser: request shape, error paths (401, rate limit,
  garbage/fenced JSON), image sizes, merging, import/export, storage warning, offline reload.
- Tested on the phone with a real key: key flow, Scan, Recipes.

## Future features (revisit after deploy)

- **Pantry sorting improvements.** Look at better ways to sort and organise pantry items beyond
  the current sort options (newest first, expiring soonest, name A–Z). To discuss the details
  before building, for example: manual ordering, grouping by category or storage location
  (fridge / freezer / cupboard), sort direction, or remembering the chosen sort.
- **Smarter duplicate matching** (deferred). Matching currently requires the same name and unit.
  Options discussed:
  - A: ignore word order and container words (can, canned, tin, jar…). Code only.
  - B: send existing pantry names with each scan so Claude reuses them. Changes the scan prompt.
