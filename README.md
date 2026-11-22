# Pantry Snap

Snap photos of your groceries, keep track of what's in your pantry, and get recipe ideas that use up what's about to expire. All of this runs in your phone's browser, powered by Claude.

- **Plain HTML, CSS and JavaScript.** No build step, no framework, no server code.
- **No database.** Your pantry, saved recipes and settings live in your browser's `localStorage`, on your device only.
- **Bring your own key.** The app ships with no API key. Each person adds their own Anthropic API key, which is stored only on their device and sent only to `api.anthropic.com`.

## 1. Get an Anthropic API key

1. Go to [console.anthropic.com](https://console.anthropic.com) and sign in or create an account.
2. Add some credit under **Billing**. A few dollars lasts a long time. Roughly 1–4 cents per scanned photo and 3–10 cents per recipe request on Claude Opus 5.5; cheaper models cost less.
3. Open **API keys** → **Create key**, and copy it (it starts with `sk-ant-`).
4. Paste it into Pantry Snap when it asks. The app makes a tiny test call before saving it.

You can show, replace, re-test or remove the key, and pick the Claude model, in **Settings**.

## 2. Preview on your computer

You need [Node.js](https://nodejs.org) installed. From this folder:

```powershell
cd C:\Users\emgil\dev_ws\recipantry
npx serve .
```

Open `http://localhost:3000`. Changes to the files show up when you refresh.

**On your phone (same Wi-Fi):** open `http://<your PC's Wi-Fi IP>:3000`, e.g. `http://10.0.0.213:3000`.
Find the Wi-Fi IP with `ipconfig` (the "IPv4 Address" under your Wi-Fi adapter). Don't use the "Network" address `serve` prints if it starts with `100.` (that's Tailscale/VPN).
Over plain `http://` the camera works, but offline mode and "install" don't (they need HTTPS). That's normal; they work once deployed.

Alternatively, `vercel dev` (after installing the Vercel CLI below) serves it the same way Vercel will.

## 3. Deploy to Vercel (free Hobby plan)

The app is a static site: no build command, no environment variables, no serverless functions. **Never** put an API key in Vercel environment variables; users bring their own.

### Option A: GitHub + Vercel (automatic deploys on every push)

1. Create an empty repository on [github.com/new](https://github.com/new) (e.g. `pantry-snap`).
2. Push this folder to it:
   ```powershell
   cd C:\Users\emgil\dev_ws\recipantry
   git init
   git add .
   git commit -m "Pantry Snap"
   git branch -M main
   git remote add origin https://github.com/<your-username>/pantry-snap.git
   git push -u origin main
   ```
3. Go to [vercel.com/new](https://vercel.com/new), sign in with GitHub, and **Import** the repository.
4. Settings: **Framework Preset: Other**, leave **Build Command** and **Output Directory** empty, and add no environment variables. Click **Deploy**.
5. You get a URL like `https://pantry-snap-xxxx.vercel.app`. Every `git push` to `main` redeploys automatically.

### Option B: Vercel CLI

```powershell
npm install -g vercel
cd C:\Users\emgil\dev_ws\recipantry
vercel login
vercel
```

Answer the prompts (set up and deploy: **Y**, link to existing project: **N**, directory: `./`, and accept the detected settings with no build command). That gives you a preview URL. To publish to your production URL:

```powershell
vercel --prod
```

`.vercelignore` keeps `PLAN.md` and the `.claude` folder off the public site. No `vercel.json` is needed.

## 4. Install on your phone

Open your Vercel URL (it must be the `https://` one).

- **iPhone (Safari):** tap **Share** → **Add to Home Screen** → **Add**.
- **Android (Chrome):** tap **⋮** → **Install app** (or **Add to Home screen**), or accept the install banner.

It then opens full-screen like a normal app, and the pantry works offline. Scanning and recipes need a connection because they call Claude.

**Note:** each browser and each installed copy has its own storage. Your pantry from the `http://10.0.0.213:3000` test won't appear at the Vercel URL. Use **Pantry → Export JSON** there and **Import JSON** on the new one to move it.

## Using the app

| Tab | What it does |
|-----|--------------|
| **Scan** | Take a photo or choose several. Claude identifies each item (name, brand, category, quantity, expiry, nutrition). Review and edit, then add to the pantry. Duplicates offer to merge. |
| **Pantry** | Search, filter by category, sort, adjust quantities with − / +, edit or delete items. Amber = expiring within 3 days, red = expired. Merge duplicates, and export/import JSON backups. |
| **Recipes** | "What can I make?" suggests 3–5 recipes that prioritise what's expiring. Optional dietary, time and meal filters. Star recipes to save them. |
| **Settings** | API key management, model choice, a rough API-call counter, and Clear all data. |

## Customising

Everything you're likely to tweak is in [`js/config.js`](js/config.js):

- `MODELS`: the models offered in Settings (default Claude Opus 5.5).
- `PROMPTS`: the exact text sent to Claude for scans and recipes.
- `SCAN_SCHEMA` / `RECIPE_SCHEMA`: the JSON shape Claude must reply in.
- `CATEGORIES`, `RECIPE_FILTERS`, `EXPIRY_SOON_DAYS`, image sizes, effort levels.

If you add or rename files, also update the `APP_SHELL` list in `sw.js` and bump `CACHE_VERSION`.

## Privacy

- Your API key, pantry and recipes are stored only in this browser's `localStorage`.
- Photos are resized on the device (which also strips location data) and sent only to Anthropic for identification. Only a small thumbnail is kept.
- Recipe requests send item names, quantities and expiry dates only.
- Backups never include your API key.

## Troubleshooting

- **Phone can't open the local address:** check the phone is on the same Wi-Fi (not a guest network or mobile data) and that you started `serve` from this folder. Use the Wi-Fi IP, not a `100.x` VPN address.
- **"Invalid API key":** copy the whole key again, or create a new one in the Console.
- **"Out of credit":** add credit under Billing in the Anthropic Console.
- **"Too many requests":** wait a minute; scan fewer photos at once.
- **An old version keeps showing:** close the app or tab fully and reopen it. When online it always fetches the latest files.

## Project structure

```
index.html              app shell, tab bar
manifest.webmanifest    install metadata (PWA)
sw.js                   service worker (offline support)
css/styles.css          styles, light and dark mode
icons/                  app icons
js/app.js               routing, key gating, startup
js/config.js            models, prompts, schemas, settings to tweak
js/api.js               Anthropic API calls and error handling
js/storage.js           localStorage helpers
js/keyscreen.js         API key onboarding
js/settings.js          Settings tab
js/scan.js              Scan tab
js/image.js             in-browser resize and thumbnails
js/identify.js          scan request and reply parsing
js/merge.js             duplicate matching and merging
js/pantry.js            Pantry tab
js/backup.js            JSON export/import
js/recipes.js           Recipes tab
js/suggest.js           recipe request and reply parsing
js/dates.js             expiry date helpers
js/ui.js                small shared UI helpers
```
