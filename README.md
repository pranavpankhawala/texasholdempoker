# Texas Hold'em Tracker

A static site for home poker nights. It tracks **chips, points, seasons and the dealer button**, with no backend. GitHub Actions deploys it to GitHub Pages.

- **Standings (`index.html`)**: read-only leaderboard, points race chart, cash-game chip results, game history, player profiles, and a live view of the table.
- **Admin (`admin.html`)**: PIN-locked console for running games, managing players and seasons, and changing settings.

Each page has its own HTML, CSS and JS. They share no layouts or code.

## Features

| Area | What it does |
|---|---|
| Game formats | Tournament (bust-outs, finishing places, knockouts) or cash game (buy-ins, rebuys, final chip counts) |
| Chips | Buy-ins, rebuys and add-ons per player, plus a live check that chips in equal chips counted |
| Chip calculator | Count a stack by entering how many chips of each colour a player has (chip set is configurable) |
| Points | Configurable points per place, a bonus for playing and a bonus per knockout; can recalculate past games |
| Dealer button | Oval table view with D / SB / BB, one-tap **Next hand**, undo, tap a seat to move the button. Skips players who are out; heads-up uses the correct blinds. |
| Hand counter | Goes up each time the button moves |
| Seasons | Group games into seasons; standings per season or all-time |
| Stats | Points, games, wins, top-3 finishes, knockouts, average finish, cash net chips, points-race chart |
| Backup | Export/import all data as JSON |
| UX | Glass UI, dark by default with a light theme, respects `prefers-color-scheme` and `prefers-reduced-motion`, keyboard and screen-reader friendly, mobile-first |

## Where data lives

There is no server. Data is saved in the **browser's `localStorage`** on the device running the admin page.

- Admin and Standings on the **same browser** share data, and Standings updates live when Admin saves.
- To show standings on **other devices**, export a JSON file from **Admin → Settings → Backup & sharing**, send it to players, and have them use **Open backup** on the Standings page.
- *Optional:* commit an export as `data/standings.json` in this repo. The Standings page loads it automatically when a browser has no local data. **The repo is public, so that file is public too.**

Export a backup regularly. Clearing browser data deletes everything saved locally.

### About the PIN

The admin PIN is hashed (SHA-256 with a salt) and stored only in that browser. It is never exported. It only stops accidental edits. On a static site anyone can read the code and the browser storage, so it is **not** real security.

## Deploying to GitHub Pages

1. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
2. Push to `main` (or run the workflow manually from the **Actions** tab).
3. The site is published at `https://<user>.github.io/texasholdempoker/`.

The workflow (`.github/workflows/deploy.yml`) checks the JavaScript syntax, assembles `_site/`, and deploys it. There is no build step.

## Running locally

The pages use ES modules, so serve them over HTTP instead of opening them with `file://`:

```bash
python3 -m http.server 8000
# open http://localhost:8000/ and http://localhost:8000/admin.html
```

## Project structure

```
index.html                 Standings page (read-only)
admin.html                 Admin console
assets/
  viewer/
    theme.js               Applies the saved theme before first paint
    data.js                Data access: local storage, backup file, published JSON
    stats.js               Pure aggregation: standings, points race, history
    charts.js              Dependency-free SVG line chart and diverging bars
    app.js                 Rendering and events
    viewer.css
  admin/
    theme.js               Applies the saved theme before first paint
    store.js               Data access: localStorage, import/export, PIN record
    domain.js              Game rules: chips, eliminations, dealer rotation, scoring
    app.js                 Rendering, dialogs and events
    admin.css
.github/workflows/deploy.yml
```

## Using it on game night

1. **Players** tab: add your regulars.
2. **Seasons** tab (optional): create a season, e.g. "Winter 2026".
3. **Table** tab: name the game, choose Tournament or Cash, set the starting stack, pick players, then **Start game**.
4. During play:
   - **Next hand** moves the button (D/SB/BB) and counts hands.
   - **Rebuy** / **Add-on** record extra chips.
   - Tournament: **Eliminate** records the finishing place and who knocked them out.
   - Cash: enter **Final chips** (or use the chip calculator) for each player.
5. **Close game** shows the results and saves points.
6. **Settings → Export JSON** to back up or share.

## Default points

| Place | 1st | 2nd | 3rd | 4th | 5th | Others |
|---|---|---|---|---|---|---|
| Points | 10 | 7 | 5 | 3 | 2 | 0 |

Plus **+1** for playing and **+1** per knockout (tournaments). You can change all of these in **Settings → Points rules**. Cash games rank players by net chips and can award points too (on by default).
