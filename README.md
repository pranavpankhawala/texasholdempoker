# Texas Hold'em Tracker

A static site for home poker nights. It tracks **chips, points, seasons and the dealer button**, with no backend. GitHub Actions deploys it to GitHub Pages.

- **Standings (`index.html`)**: read-only leaderboard, points race chart, cash-game chip results, game history, player profiles, and a live view of the table.
- **Admin (`admin.html`)**: PIN-locked console for running games, managing players and seasons, and changing settings.
- **Chip Table host (`host.html`)**: admin-side screen that runs hands live while players bet from their phones.
- **Chip Table player (`play.html`)**: players join with a room code or QR code, pick their seat, and use their phone as their chip stack.

Admin pages (admin and host) and user pages (standings and player) each have their own HTML, CSS and JS and share no layouts or code.

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

## Chip Table: phones instead of chips

Inspired by apps like PointPia: real cards, virtual chips.

1. **Admin → Table**: start a game, tick **Use Chip Table**, and set the blinds. You can also move a live game over with **Use Chip Table**.
2. The **host screen** opens with a **room code, QR code and join link**.
3. Players scan the code, open `play.html`, and **tap their seat**. A phone without a player can **Just watch**, which is a big-screen view for a TV or tablet.
4. Host taps **Deal hand**. The button moves and the blinds are posted automatically.
5. The player whose turn it is gets a buzz and sees **Fold / Check / Call / Raise** with a slider, ±1 BB steps, and **Min, ½ Pot, Pot, All-in** presets. The host can act for anyone, such as a player without a phone.
6. When betting finishes, the host taps who won each pot. **Side pots** and **split pots** are handled, and odd chips go to the first winner left of the button.
7. Between hands the host can change the blinds, record rebuys and add-ons, let players sit out or back in (cash games), undo the last hand, or **Finish game**. Results then go to the standings like any other game.

**Rules handled:** heads-up blinds (the dealer posts the small blind and acts first pre-flop), minimum raises, short all-ins that don't reopen the betting, uncalled bets returned, and tournament bust-outs ranked by stack and credited to the player who won the chips.

### How the phones connect

There is still **no backend**. Phones connect **peer-to-peer (WebRTC)** to the host's browser using [PeerJS](https://peerjs.com/). The free public PeerJS server only introduces the devices to each other; game data then flows directly between them. Keep in mind:

- **The host screen must stay open.** If the host's device sleeps or the tab closes, phones show "Reconnecting…" and rejoin automatically when it's back. The table state is saved, so nothing is lost.
- **Phones rejoin their seat automatically** after a reload or screen lock, because each phone remembers an ID.
- **Network.** Same Wi-Fi works best. Some mobile-carrier networks block direct connections; if a phone can't join, move it onto the same Wi-Fi as the host.
- **Self-hosted broker (optional).** Add `?peer=your-host:port` (or `your-host:443:secure`) to the host page URL. The join link carries it to the players.
- **Trust.** Seats are claimed by tapping, with no login, so play with people you trust. The host can **Free seat** to reassign a phone.

The libraries are bundled in `assets/vendor/` (MIT licensed), so no CDN is needed.

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
host.html                  Chip Table host screen (admin side)
play.html                  Chip Table player phone page
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
    poker.js               Chip Table betting engine: blinds, turns, raises, side pots
    net-host.js            PeerJS host networking
    host.js / host.css     Chip Table host screen
  play/
    theme.js
    net.js                 PeerJS player networking with auto-reconnect
    play.js / play.css     Player phone UI
  vendor/                  peerjs 1.5.4, qrcode-generator 1.4.4 (MIT)
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
