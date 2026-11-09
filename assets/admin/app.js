/**
 * Admin presentation layer: rendering, events, dialogs.
 * Rules live in domain.js; storage lives in store.js.
 */
import * as store from './store.js';
import * as D from './domain.js';
import * as P from './poker.js';

const state = {
  data: store.load(),
  tab: 'table',
  gameFilter: 'all',
  pinAttempts: 0,
  lockedUntil: 0,
};

/* =========================================================== helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const name = (id) => esc(D.playerName(state.data, id));
const seasonName = (id) => state.data.seasons.find((s) => s.id === id)?.name ?? 'No season';
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? esc(iso) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Button with a stable id so focus survives re-renders. */
function btn(action, label, { pid = '', cls = 'btn ghost', aria = '', attrs = '', disabled = false } = {}) {
  const id = `a-${action}-${pid}`;
  return `<button type="button" id="${esc(id)}" class="${cls}" data-action="${action}" ${pid ? `data-pid="${esc(pid)}"` : ''} ${aria ? `aria-label="${esc(aria)}"` : ''} ${disabled ? 'disabled' : ''} ${attrs}>${label}</button>`;
}

const ICON = {
  plus: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  next: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  undo: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  shuffle: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
  calc: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
  check: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>',
  warn: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/></svg>',
  more: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
};

function toast(msg, kind = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 3400);
}

function announce(msg) {
  const el = $('#announcer');
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = msg; });
}

function commit(msg, kind) {
  if (!store.save(state.data)) toast('Could not save. Browser storage may be full or blocked.', 'error');
  else if (msg) toast(msg, kind);
  render();
}

/* =========================================================== dialogs */

let dlgHandler = null;
let dlgOpener = null;

function openDialog({ title, body, confirmLabel = 'Save', danger = false, hideCancel = false, wide = false, onSubmit, onReady }) {
  const dlg = $('#dlg');
  dlgOpener = document.activeElement;
  $('#dlg-title').textContent = title;
  $('#dlg-body').innerHTML = body;
  $('#dlg-error').textContent = '';
  const ok = $('#dlg-ok');
  ok.textContent = confirmLabel;
  ok.className = `btn ${danger ? 'danger' : 'primary'}`;
  $('#dlg-cancel').hidden = hideCancel;
  dlg.classList.toggle('wide', wide);
  dlgHandler = onSubmit || (() => true);
  dlg.showModal();
  onReady?.(dlg);
  const first = $('#dlg-body [autofocus], #dlg-body input, #dlg-body select', dlg);
  (first || ok).focus();
}

function closeDialog() {
  const dlg = $('#dlg');
  if (dlg.open) dlg.close();
}

function confirmDialog(message, { title = 'Are you sure?', confirmLabel = 'Confirm', danger = false, html = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    openDialog({
      title,
      body: html ? message : `<p>${esc(message)}</p>`,
      confirmLabel,
      danger,
      onSubmit: () => { answered = true; resolve(true); return true; },
    });
    $('#dlg').addEventListener('close', () => { if (!answered) resolve(false); }, { once: true });
  });
}

function infoDialog(title, html) {
  openDialog({ title, body: html, confirmLabel: 'OK', hideCancel: true });
}

function initDialog() {
  const dlg = $('#dlg');
  $('#dlg-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const result = dlgHandler?.(new FormData(e.currentTarget), e.currentTarget);
    if (typeof result === 'string') { $('#dlg-error').textContent = result; return; }
    if (result !== false) closeDialog();
  });
  $$('[data-dlg-close]', dlg).forEach((b) => b.addEventListener('click', closeDialog));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDialog(); });
  dlg.addEventListener('close', () => {
    // The opener may have been re-rendered; find its replacement by id.
    const target = dlgOpener && (document.contains(dlgOpener) ? dlgOpener : (dlgOpener.id && document.getElementById(dlgOpener.id)));
    setTimeout(() => {
      const again = target && document.contains(target) ? target : (dlgOpener?.id && document.getElementById(dlgOpener.id));
      (again || $('#main'))?.focus();
    }, 0);
  });
}

/* =========================================================== theme */

function effectiveTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function syncThemeButton() {
  const b = $('#theme-toggle');
  const isDark = effectiveTheme() === 'dark';
  b.setAttribute('aria-pressed', String(isDark));
  b.querySelector('.label').textContent = isDark ? 'Dark' : 'Light';
}

function initTheme() {
  $('#theme-toggle').addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('thp.theme', next); } catch { /* ignore */ }
    syncThemeButton();
  });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', syncThemeButton);
  syncThemeButton();
}

/* =========================================================== PIN lock */

async function hashPin(pin, salt) {
  const input = `${salt}:${pin}`;
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381; // fallback for insecure contexts (e.g. file://)
  for (let i = 0; i < input.length; i += 1) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `djb2-${h.toString(16)}`;
}

function showLock() {
  const rec = store.getPinRecord();
  const creating = !rec;
  $('#app').hidden = true;
  $('#lock').hidden = false;
  $('#lock-title').textContent = creating ? 'Create an admin PIN' : 'Enter admin PIN';
  $('#lock-desc').textContent = creating
    ? 'Choose a 4–8 digit PIN. It stops accidental edits on this device. It is not strong security, because anyone can read a static site’s code.'
    : 'Unlock to manage games, players and settings.';
  $('#pin-confirm-field').hidden = !creating;
  $('#pin-confirm').required = creating;
  $('#pin').autocomplete = creating ? 'new-password' : 'current-password';
  $('#lock-submit').textContent = creating ? 'Create PIN & continue' : 'Unlock';
  $('#lock-forgot').hidden = creating;
  $('#lock-error').textContent = '';
  $('#lock-form').reset();
  $('#pin').focus();
}

function returnTarget() {
  return new URLSearchParams(location.search).get('return') === 'host' ? 'host.html' : null;
}

function showApp() {
  const target = returnTarget();
  if (target) { location.href = target; return; }
  $('#lock').hidden = true;
  $('#app').hidden = false;
  render();
  $('#main').focus();
}

function initLock() {
  $('#lock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#lock-error');
    const pin = $('#pin').value.trim();
    const rec = store.getPinRecord();
    if (Date.now() < state.lockedUntil) {
      err.textContent = `Too many attempts. Try again in ${Math.ceil((state.lockedUntil - Date.now()) / 1000)} seconds.`;
      return;
    }
    if (!/^\d{4,8}$/.test(pin)) { err.textContent = 'PIN must be 4 to 8 digits.'; $('#pin').focus(); return; }

    if (!rec) {
      if (pin !== $('#pin-confirm').value.trim()) { err.textContent = 'The two PINs don’t match.'; $('#pin-confirm').focus(); return; }
      const salt = D.uid();
      store.setPinRecord({ salt, hash: await hashPin(pin, salt) });
      store.setUnlocked(true);
      showApp();
      toast('PIN created. Admin unlocked.', 'success');
      return;
    }
    if ((await hashPin(pin, rec.salt)) === rec.hash) {
      state.pinAttempts = 0;
      store.setUnlocked(true);
      showApp();
    } else {
      state.pinAttempts += 1;
      if (state.pinAttempts >= 5) { state.lockedUntil = Date.now() + 30000; state.pinAttempts = 0; }
      err.textContent = 'Incorrect PIN.';
      $('#pin').select();
    }
  });

  $('#lock-forgot').addEventListener('click', () => {
    openDialog({
      title: 'Reset admin PIN',
      body: `<p>This removes the PIN on this device. Your game data stays. Type <strong>RESET</strong> to confirm.</p>
        <div class="field"><label for="reset-word">Confirmation</label><input id="reset-word" name="word" autocomplete="off" required></div>`,
      confirmLabel: 'Reset PIN',
      danger: true,
      onSubmit: (fd) => {
        if (String(fd.get('word')).trim() !== 'RESET') return 'Type RESET in capitals to confirm.';
        store.clearPin();
        setTimeout(showLock, 0);
        return true;
      },
    });
  });

  $('#lock-btn').addEventListener('click', () => {
    store.setUnlocked(false);
    showLock();
    toast('Admin locked.');
  });
}

/* =========================================================== tabs */

const TABS = ['table', 'games', 'players', 'seasons', 'settings'];

function setTab(tab, focus = false) {
  state.tab = tab;
  for (const t of TABS) {
    const b = $(`#tab-${t}`);
    const on = t === tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    $(`#panel-${t}`).hidden = !on;
  }
  if (focus) $(`#tab-${tab}`).focus();
  render();
}

function initTabs() {
  const list = $('#tablist');
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[role="tab"]');
    if (b) setTab(b.dataset.tab);
  });
  list.addEventListener('keydown', (e) => {
    const i = TABS.indexOf(state.tab);
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
    if (e.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length;
    if (e.key === 'Home') j = 0;
    if (e.key === 'End') j = TABS.length - 1;
    if (j !== null) { e.preventDefault(); setTab(TABS[j], true); }
  });
}

/* =========================================================== render */

function render() {
  const focusId = document.activeElement?.id;
  const live = D.liveGame(state.data);
  $('#tab-table .tab-dot').hidden = !live;

  const panel = $(`#panel-${state.tab}`);
  const renderers = { table: renderTable, games: renderGames, players: renderPlayers, seasons: renderSeasons, settings: renderSettings };
  panel.innerHTML = renderers[state.tab]();

  if (focusId && !$('#dlg').open) {
    const el = document.getElementById(focusId);
    if (el && el !== document.activeElement) el.focus({ preventScroll: true });
  }
}

/* ---------------- Table (live game) ---------------- */

function renderTable() {
  const game = D.liveGame(state.data);
  return game ? renderLiveGame(game) : renderNewGame();
}

function renderNewGame() {
  const d = state.data;
  const players = d.players.filter((p) => p.active);
  const n = d.games.length + 1;
  const seasonOpts = [`<option value="">No season</option>`]
    .concat(d.seasons.map((s) => `<option value="${esc(s.id)}" ${s.id === d.activeSeasonId ? 'selected' : ''}>${esc(s.name)}</option>`))
    .join('');

  const playerList = players.length
    ? `<div class="check-grid">${players.map((p) => `
        <label class="check-chip"><input type="checkbox" name="players" value="${esc(p.id)}"><span>${esc(p.name)}</span></label>`).join('')}
      </div>`
    : `<p class="empty-inline">No players yet. ${btn('goto-players', 'Add players', { cls: 'link-btn' })}</p>`;

  return `
  <section class="card glass" aria-labelledby="ng-h">
    <div class="card-head">
      <div>
        <h2 id="ng-h">Start a new game</h2>
        <p class="muted">No game is running. Set it up, pick who’s playing, and deal.</p>
      </div>
    </div>
    <form data-form="new-game" class="form-grid" novalidate>
      <div class="field">
        <label for="ng-name">Game name</label>
        <input id="ng-name" name="name" required maxlength="60" value="Game #${n}">
      </div>
      <div class="field">
        <label for="ng-date">Date</label>
        <input id="ng-date" name="date" type="date" required value="${D.todayISO()}">
      </div>
      <fieldset class="field">
        <legend>Format</legend>
        <div class="segmented">
          <input type="radio" id="ng-type-t" name="type" value="tournament" checked>
          <label for="ng-type-t">Tournament</label>
          <input type="radio" id="ng-type-c" name="type" value="cash">
          <label for="ng-type-c">Cash game</label>
        </div>
      </fieldset>
      <div class="field">
        <label for="ng-season">Season</label>
        <select id="ng-season" name="seasonId">${seasonOpts}</select>
      </div>
      <div class="field">
        <label for="ng-stack">Starting stack (chips)</label>
        <input id="ng-stack" name="stack" type="number" inputmode="numeric" min="1" step="1" required value="${d.settings.defaultStack}">
      </div>
      <fieldset class="field span-all chip-table-opt">
        <legend>Chip Table</legend>
        <label class="switch"><input type="checkbox" name="chipTable" id="ng-chiptable"><span>Players bet from their phones (no physical chips)</span></label>
        <div class="inline-form">
          <div class="field"><label for="ng-sb">Small blind</label><input id="ng-sb" name="sb" type="number" inputmode="numeric" min="1" step="1" value="${Math.max(1, Math.round(d.settings.defaultStack / 200))}"></div>
          <div class="field"><label for="ng-bb">Big blind</label><input id="ng-bb" name="bb" type="number" inputmode="numeric" min="1" step="1" value="${Math.max(2, Math.round(d.settings.defaultStack / 100))}"></div>
        </div>
        <p class="hint">Blinds are only used by the Chip Table. You get a room code and QR code for players to join.</p>
      </fieldset>
      <fieldset class="field span-all">
        <legend>Players at the table</legend>
        <p class="hint" id="ng-players-hint">Seats follow this order. You can shuffle or move seats after the game starts.</p>
        ${playerList}
      </fieldset>
      <p class="form-error span-all" id="ng-error" role="alert"></p>
      <div class="actions span-all">
        ${players.length ? btn('select-all', 'Select all') : ''}
        <button type="submit" class="btn primary" ${players.length < 2 ? 'disabled' : ''}>${ICON.next} Start game</button>
      </div>
    </form>
  </section>`;
}

function renderChipTableGame(game) {
  const t = game.table;
  const isCash = game.type === 'cash';
  return `
  <section class="card glass game-head" aria-labelledby="live-h">
    <div class="game-title">
      <p class="eyebrow"><span class="live-dot" aria-hidden="true"></span> Live on Chip Table · Room ${esc(t.room)}</p>
      <h2 id="live-h">${esc(game.name)}</h2>
      <p class="muted"><span class="badge">${isCash ? 'Cash game' : 'Tournament'}</span> ${esc(seasonName(game.seasonId))} · ${fmtDate(game.date)} · Blinds ${D.fmt(t.sb)} / ${D.fmt(t.bb)}</p>
    </div>
    <p>Players are betting from their phones. Run hands, rebuys and payouts from the host screen.</p>
    <div class="actions">
      <a class="btn primary" href="host.html">Open host screen</a>
      ${btn('edit-game', 'Edit details', { pid: game.id })}
    </div>
  </section>
  <section class="card glass" aria-labelledby="stacks-h">
    <h2 id="stacks-h">Stacks${t.hand ? ` · hand #${t.hand.no} in progress` : ''}</h2>
    <div class="table-wrap"><table class="data">
      <thead><tr><th scope="col">Seat</th><th scope="col">Player</th><th scope="col" class="num">Chips in</th><th scope="col" class="num">Stack</th></tr></thead>
      <tbody>${game.entries.map((e, i) => `<tr class="${e.active ? '' : 'is-out'}"><td>${i + 1}</td><th scope="row">${name(e.playerId)}${e.active ? '' : ` <span class="status out">${isCash ? 'Sitting out' : `Out · ${D.ordinal(e.place)}`}</span>`}</th>
        <td class="num">${D.fmt(D.entryChipsIn(e))}</td><td class="num">${D.fmt(t.stacks[e.playerId] ?? 0)}</td></tr>`).join('')}</tbody>
    </table></div>
  </section>`;
}

function renderLiveGame(game) {
  if (game.table) return renderChipTableGame(game);
  const t = D.gameTotals(game);
  const pos = D.positions(game);
  const isCash = game.type === 'cash';
  const alive = game.entries.filter((e) => e.active);
  const winner = !isCash && alive.length === 1 ? alive[0] : null;

  const balance = !isCash
    ? ''
    : t.countedEntries < game.entries.length
      ? `<div class="chip-check" data-state="pending">${ICON.calc}<span>Counted ${t.countedEntries} of ${game.entries.length} players · ${D.fmt(t.counted)} of ${D.fmt(t.chipsIn)} chips</span></div>`
      : t.diff === 0
        ? `<div class="chip-check" data-state="ok">${ICON.check}<span>Balanced: ${D.fmt(t.chipsIn)} chips in, ${D.fmt(t.counted)} counted</span></div>`
        : `<div class="chip-check" data-state="warn">${ICON.warn}<span>Off by ${D.signed(t.diff)} chips: ${D.fmt(t.chipsIn)} in, ${D.fmt(t.counted)} counted</span></div>`;

  return `
  <section class="card glass game-head" aria-labelledby="live-h">
    <div class="game-title">
      <p class="eyebrow"><span class="live-dot" aria-hidden="true"></span> Live now</p>
      <h2 id="live-h">${esc(game.name)}</h2>
      <p class="muted">
        <span class="badge">${isCash ? 'Cash game' : 'Tournament'}</span>
        ${esc(seasonName(game.seasonId))} · ${fmtDate(game.date)} · ${D.fmt(game.startingStack)} starting stack
      </p>
    </div>
    <dl class="stats">
      <div><dt>${isCash ? 'At table' : 'Still in'}</dt><dd>${t.activeCount}<small>/${game.entries.length}</small></dd></div>
      <div><dt>Chips in play</dt><dd>${D.fmt(t.chipsIn)}</dd></div>
      <div><dt>Hands</dt><dd>${D.fmt(game.dealer.hands)}</dd></div>
    </dl>
    <div class="actions">
      ${btn('open-chip-table', 'Use Chip Table', { cls: 'btn ghost' })}
      ${btn('add-entry', `${ICON.plus} Add player`)}
      ${btn('shuffle', `${ICON.shuffle} Shuffle seats`)}
      ${btn('edit-game', 'Edit details', { pid: game.id })}
      ${btn('cancel-game', 'Discard game', { cls: 'btn ghost danger-text' })}
      ${btn('close-game', `${ICON.check} Close game`, { cls: 'btn primary' })}
    </div>
    ${winner ? `<p class="callout" role="status"><strong>${name(winner.playerId)}</strong> is the last player standing. Close the game to save results.</p>` : ''}
  </section>

  <div class="live-grid">
    <section class="card glass dealer-card" aria-labelledby="dealer-h">
      <div class="card-head">
        <h2 id="dealer-h">Dealer button</h2>
        <p class="muted small">Tap a seat to move the button there.</p>
      </div>
      ${renderFelt(game, pos)}
      <div class="hand-controls">
        ${btn('undo-hand', `${ICON.undo} Undo`, { disabled: !game.dealer.history.length, aria: 'Undo last button move' })}
        ${btn('next-hand', `Next hand ${ICON.next}`, { cls: 'btn primary big', disabled: !pos.button || alive.length < 2 })}
      </div>
      <ul class="pos-list" aria-label="Current positions">
        <li><span class="pos-badge d" aria-hidden="true">D</span><span><span class="sr-only">Dealer: </span>${pos.button ? name(pos.button) : '—'}</span></li>
        <li><span class="pos-badge sb" aria-hidden="true">SB</span><span><span class="sr-only">Small blind: </span>${pos.sb ? name(pos.sb) : '—'}</span></li>
        <li><span class="pos-badge bb" aria-hidden="true">BB</span><span><span class="sr-only">Big blind: </span>${pos.bb ? name(pos.bb) : '—'}</span></li>
      </ul>
    </section>

    <section class="card glass players-card" aria-labelledby="players-h">
      <div class="card-head">
        <h2 id="players-h">Players & chips</h2>
      </div>
      ${balance}
      <ul class="entry-list">
        ${game.entries.map((e, i) => renderEntry(game, e, i, pos)).join('')}
      </ul>
    </section>
  </div>`;
}

function renderFelt(game, pos) {
  const n = game.entries.length;
  const seats = game.entries.map((e, i) => {
    const a = (Math.PI / 2) + (i * 2 * Math.PI) / n;
    const x = 50 + 44 * Math.cos(a);
    const y = 50 + 40 * Math.sin(a);
    const roles = [];
    if (e.playerId === pos.button) roles.push('dealer');
    if (e.playerId === pos.sb) roles.push('small blind');
    if (e.playerId === pos.bb) roles.push('big blind');
    const pname = D.playerName(state.data, e.playerId);
    const label = `Seat ${i + 1}, ${pname}${roles.length ? `, ${roles.join(' and ')}` : ''}${e.active ? '' : ', out'}. Move dealer button here.`;
    return `<button type="button" id="a-seat-${esc(e.playerId)}" class="seat ${e.active ? '' : 'out'} ${e.playerId === pos.button ? 'has-button' : ''}"
        style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%" data-action="seat" data-pid="${esc(e.playerId)}" aria-label="${esc(label)}">
        <span class="seat-name">${esc(pname)}</span>
        <span class="seat-badges" aria-hidden="true">
          ${e.playerId === pos.button ? '<span class="pos-badge d">D</span>' : ''}
          ${e.playerId === pos.sb ? '<span class="pos-badge sb">SB</span>' : ''}
          ${e.playerId === pos.bb ? '<span class="pos-badge bb">BB</span>' : ''}
        </span>
      </button>`;
  }).join('');

  return `<div class="felt-wrap">
    <div class="felt" role="group" aria-label="Table seats in clockwise order">
      <div class="felt-center" aria-hidden="true">
        <span class="felt-label">Hand</span>
        <span class="felt-count">${D.fmt(game.dealer.hands + 1)}</span>
      </div>
      ${seats}
    </div>
  </div>`;
}

function renderEntry(game, e, i, pos) {
  const isCash = game.type === 'cash';
  const pid = e.playerId;
  const pname = D.playerName(state.data, pid);
  const chipsIn = D.entryChipsIn(e);
  const rebuys = e.buys.filter((b) => b.kind === 'rebuy').length;
  const addons = e.buys.filter((b) => b.kind === 'addon').length;
  const extras = [rebuys && `${rebuys} rebuy${rebuys > 1 ? 's' : ''}`, addons && `${addons} add-on${addons > 1 ? 's' : ''}`].filter(Boolean).join(', ');
  const status = !e.active
    ? (isCash ? '<span class="status out">Left table</span>' : `<span class="status out">Out · ${D.ordinal(e.place)}</span>`)
    : '';
  const showFinal = isCash || e.active;
  const finalLabel = isCash ? 'Final chips' : 'Chip count';

  const statusBtn = isCash
    ? (e.active ? btn('leave', 'Left table', { pid, aria: `${pname} left the table` }) : btn('return', 'Back in', { pid, aria: `${pname} is back at the table` }))
    : (e.active
      ? btn('eliminate', 'Eliminate', { pid, cls: 'btn ghost danger-text', aria: `Eliminate ${pname}` })
      : (D.canReinstate(game, pid) ? btn('reinstate', 'Reinstate', { pid, aria: `Reinstate ${pname}` }) : ''));

  return `<li class="entry ${e.active ? '' : 'is-out'}">
    <div class="entry-main">
      <span class="seat-no" aria-label="Seat ${i + 1}">${i + 1}</span>
      <div class="entry-id">
        <p class="entry-name">${esc(pname)}
          ${pid === pos.button ? '<span class="pos-badge d" title="Dealer">D</span>' : ''}
          ${pid === pos.sb ? '<span class="pos-badge sb" title="Small blind">SB</span>' : ''}
          ${pid === pos.bb ? '<span class="pos-badge bb" title="Big blind">BB</span>' : ''}
          ${status}
        </p>
        <p class="entry-meta">In: <strong>${D.fmt(chipsIn)}</strong>${extras ? ` · ${extras}` : ''}${!isCash && e.knockouts ? ` · ${e.knockouts} KO${e.knockouts > 1 ? 's' : ''}` : ''}${!isCash && !e.active && e.knockedOutBy ? ` · by ${name(e.knockedOutBy)}` : ''}</p>
      </div>
    </div>
    ${showFinal ? `<div class="entry-final">
      <label for="fc-${esc(pid)}">${finalLabel}${isCash ? '' : ' <span class="muted">(optional)</span>'}</label>
      <div class="input-row">
        <input id="fc-${esc(pid)}" type="number" inputmode="numeric" min="0" step="1" data-change="final" data-pid="${esc(pid)}" value="${e.finalChips ?? ''}" placeholder="—">
        ${btn('count', `${ICON.calc}<span class="sr-only">Count chips for ${esc(pname)}</span>`, { pid, cls: 'btn icon', attrs: 'title="Chip calculator"' })}
      </div>
      ${isCash && e.finalChips != null ? `<p class="entry-net ${e.finalChips - chipsIn >= 0 ? 'pos' : 'neg'}">Net ${D.signed(e.finalChips - chipsIn)}</p>` : ''}
    </div>` : '<div class="entry-final"></div>'}
    <div class="entry-actions">
      ${btn('rebuy', `${ICON.plus} Rebuy`, { pid, aria: `Rebuy for ${pname}` })}
      ${btn('addon', 'Add-on', { pid, aria: `Add-on for ${pname}` })}
      ${statusBtn}
      <details class="menu">
        <summary class="btn icon" aria-label="More actions for ${esc(pname)}">${ICON.more}</summary>
        <div class="menu-pop glass" role="group" aria-label="More actions for ${esc(pname)}">
          ${btn('seat-up', 'Move seat up', { pid, cls: 'menu-item', disabled: i === 0 })}
          ${btn('seat-down', 'Move seat down', { pid, cls: 'menu-item', disabled: i === game.entries.length - 1 })}
          ${btn('undo-buy', 'Undo last rebuy/add-on', { pid, cls: 'menu-item', disabled: e.buys.length <= 1 })}
          ${btn('remove-entry', 'Remove from game', { pid, cls: 'menu-item danger-text' })}
        </div>
      </details>
    </div>
  </li>`;
}

/* ---------------- Games ---------------- */

function resultsTable(game) {
  if (!game.results.length) return '<p class="muted">No results yet.</p>';
  const isCash = game.type === 'cash';
  return `<div class="table-wrap"><table class="data">
    <caption class="sr-only">Results for ${esc(game.name)}</caption>
    <thead><tr><th scope="col">Place</th><th scope="col">Player</th><th scope="col" class="num">Points</th>
      <th scope="col" class="num">Chips in</th>${isCash ? '<th scope="col" class="num">Chips out</th><th scope="col" class="num">Net</th>' : '<th scope="col" class="num">KOs</th>'}</tr></thead>
    <tbody>${game.results.map((r) => `<tr>
      <td>${D.ordinal(r.place)}</td><th scope="row">${name(r.playerId)}</th><td class="num">${D.fmt(r.points)}</td>
      <td class="num">${D.fmt(r.chipsIn)}</td>
      ${isCash ? `<td class="num">${D.fmt(r.chipsOut)}</td><td class="num ${r.net >= 0 ? 'pos' : 'neg'}">${D.signed(r.net)}</td>` : `<td class="num">${r.knockouts}</td>`}
    </tr>`).join('')}</tbody></table></div>`;
}

function renderGames() {
  const d = state.data;
  const games = d.games
    .filter((g) => state.gameFilter === 'all' || (state.gameFilter === 'none' ? !g.seasonId : g.seasonId === state.gameFilter))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));

  const opts = [`<option value="all">All seasons</option>`, `<option value="none" ${state.gameFilter === 'none' ? 'selected' : ''}>No season</option>`]
    .concat(d.seasons.map((s) => `<option value="${esc(s.id)}" ${state.gameFilter === s.id ? 'selected' : ''}>${esc(s.name)}</option>`)).join('');

  const items = games.map((g) => {
    const winner = g.results.find((r) => r.place === 1);
    return `<article class="card glass game-item">
      <div class="game-item-head">
        <div>
          <h3>${esc(g.name)}</h3>
          <p class="muted">${fmtDate(g.date)} · ${esc(seasonName(g.seasonId))} · ${g.entries.length} players${winner ? ` · Winner: <strong>${name(winner.playerId)}</strong>` : ''}</p>
        </div>
        <div class="badges">
          <span class="badge">${g.type === 'cash' ? 'Cash' : 'Tournament'}</span>
          ${g.status === 'live' ? '<span class="badge live"><span class="live-dot" aria-hidden="true"></span>Live</span>' : ''}
        </div>
      </div>
      ${g.status === 'closed' ? `<details class="disclosure"><summary>Results</summary>${resultsTable(g)}</details>` : ''}
      <div class="actions">
        ${g.status === 'live' ? btn('goto-table', 'Open table', { pid: g.id, cls: 'btn primary' }) : btn('reopen', 'Reopen', { pid: g.id, aria: `Reopen ${g.name}` })}
        ${btn('edit-game', 'Edit details', { pid: g.id, aria: `Edit details of ${g.name}` })}
        ${btn('delete-game', 'Delete', { pid: g.id, cls: 'btn ghost danger-text', aria: `Delete ${g.name}` })}
      </div>
    </article>`;
  }).join('');

  return `<section aria-labelledby="games-h">
    <div class="section-head">
      <h2 id="games-h">Games</h2>
      <div class="field inline">
        <label for="games-filter">Season</label>
        <select id="games-filter" data-change="games-filter">${opts}</select>
      </div>
    </div>
    ${items || `<div class="card glass empty"><p>No games yet. Start one from the <strong>Table</strong> tab.</p></div>`}
  </section>`;
}

/* ---------------- Players ---------------- */

function renderPlayers() {
  const d = state.data;
  const rows = d.players
    .slice()
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
    .map((p) => {
      const s = D.playerSummary(d, p.id);
      return `<tr class="${p.active ? '' : 'is-out'}">
        <th scope="row">${esc(p.name)}${p.active ? '' : ' <span class="status out">Retired</span>'}</th>
        <td class="num">${s.games}</td><td class="num">${D.fmt(s.points)}</td><td class="num">${s.wins}</td>
        <td class="row-actions">
          ${btn('rename-player', 'Rename', { pid: p.id, aria: `Rename ${p.name}` })}
          ${btn('toggle-player', p.active ? 'Retire' : 'Restore', { pid: p.id, aria: `${p.active ? 'Retire' : 'Restore'} ${p.name}` })}
          ${btn('delete-player', 'Delete', { pid: p.id, cls: 'btn ghost danger-text', aria: `Delete ${p.name}` })}
        </td></tr>`;
    }).join('');

  return `<section class="card glass" aria-labelledby="players-tab-h">
    <div class="card-head"><h2 id="players-tab-h">Players</h2><p class="muted">Retired players are hidden when you start a game but keep their history.</p></div>
    <form data-form="add-player" class="inline-form" novalidate>
      <div class="field grow">
        <label for="new-player">New player name</label>
        <input id="new-player" name="name" maxlength="40" required autocomplete="off" placeholder="e.g. Sam">
      </div>
      <button type="submit" class="btn primary">${ICON.plus} Add player</button>
    </form>
    <p class="form-error" id="player-error" role="alert"></p>
    ${rows ? `<div class="table-wrap"><table class="data">
      <caption class="sr-only">All players</caption>
      <thead><tr><th scope="col">Name</th><th scope="col" class="num">Games</th><th scope="col" class="num">Points</th><th scope="col" class="num">Wins</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : '<p class="empty-inline">No players yet. Add your regulars above.</p>'}
  </section>`;
}

/* ---------------- Seasons ---------------- */

function renderSeasons() {
  const d = state.data;
  const rows = d.seasons.map((s) => {
    const count = d.games.filter((g) => g.seasonId === s.id).length;
    const active = s.id === d.activeSeasonId;
    return `<tr>
      <th scope="row">${esc(s.name)} ${active ? '<span class="badge accent">Current</span>' : ''}</th>
      <td>${fmtDate(s.startDate)}</td><td class="num">${count}</td>
      <td class="row-actions">
        ${active ? '' : btn('activate-season', 'Make current', { pid: s.id, aria: `Make ${s.name} the current season` })}
        ${btn('rename-season', 'Rename', { pid: s.id, aria: `Rename ${s.name}` })}
        ${btn('delete-season', 'Delete', { pid: s.id, cls: 'btn ghost danger-text', aria: `Delete ${s.name}` })}
      </td></tr>`;
  }).join('');

  return `<section class="card glass" aria-labelledby="seasons-h">
    <div class="card-head"><h2 id="seasons-h">Seasons</h2><p class="muted">New games go into the current season by default. Standings show per season and all-time.</p></div>
    <form data-form="add-season" class="inline-form" novalidate>
      <div class="field grow"><label for="season-name">Season name</label><input id="season-name" name="name" maxlength="40" required placeholder="e.g. Winter 2026"></div>
      <div class="field"><label for="season-start">Start date</label><input id="season-start" name="start" type="date" value="${D.todayISO()}"></div>
      <button type="submit" class="btn primary">${ICON.plus} Add season</button>
    </form>
    <p class="form-error" id="season-error" role="alert"></p>
    ${rows ? `<div class="table-wrap"><table class="data">
      <caption class="sr-only">Seasons</caption>
      <thead><tr><th scope="col">Season</th><th scope="col">Starts</th><th scope="col" class="num">Games</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : '<p class="empty-inline">No seasons yet. Games can still be played without one.</p>'}
  </section>`;
}

/* ---------------- Settings ---------------- */

function chipRow(c) {
  const id = esc(c.id);
  return `<li class="chip-row" data-chip-id="${id}">
    <div class="field"><label for="chip-name-${id}">Name</label><input id="chip-name-${id}" name="chip-name" maxlength="30" value="${esc(c.name)}" required></div>
    <div class="field"><label for="chip-color-${id}">Colour</label><input id="chip-color-${id}" name="chip-color" type="color" value="${esc(c.color)}"></div>
    <div class="field"><label for="chip-value-${id}">Value</label><input id="chip-value-${id}" name="chip-value" type="number" min="1" step="1" inputmode="numeric" value="${c.value}" required></div>
    <button type="button" class="btn icon danger-text" data-action="remove-chip-row" aria-label="Remove ${esc(c.name)} chip">
      <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
    </button>
  </li>`;
}

function renderSettings() {
  const s = state.data.settings;
  const closed = state.data.games.filter((g) => g.status === 'closed').length;
  return `
  <section class="card glass" aria-labelledby="pts-h">
    <div class="card-head"><h2 id="pts-h">Points rules</h2><p class="muted">Used when a game is closed. Change them anytime, then recalculate past games if you want.</p></div>
    <form data-form="points" class="form-grid" novalidate>
      <div class="field span-all">
        <label for="pts-places">Points by finishing place</label>
        <input id="pts-places" name="places" value="${esc(s.points.places.join(', '))}" aria-describedby="pts-places-hint" inputmode="numeric" autocomplete="off">
        <p class="hint" id="pts-places-hint">Comma-separated, 1st place first. Places not listed get 0. Example: 10, 7, 5, 3, 2</p>
      </div>
      <div class="field"><label for="pts-part">Bonus for playing</label><input id="pts-part" name="participation" type="number" min="0" step="1" value="${s.points.participation}"></div>
      <div class="field"><label for="pts-ko">Bonus per knockout</label><input id="pts-ko" name="knockout" type="number" min="0" step="1" value="${s.points.knockout}"><p class="hint">Tournaments only.</p></div>
      <div class="field span-all">
        <label class="switch"><input type="checkbox" name="applyToCash" ${s.points.applyToCash ? 'checked' : ''}><span>Award points in cash games (ranked by net chips)</span></label>
      </div>
      <p class="form-error span-all" id="pts-error" role="alert"></p>
      <div class="actions span-all">
        ${btn('recalc', `Recalculate ${closed} closed game${closed === 1 ? '' : 's'}`, { disabled: !closed })}
        <button type="submit" class="btn primary">Save rules</button>
      </div>
    </form>
  </section>

  <section class="card glass" aria-labelledby="chips-h">
    <div class="card-head"><h2 id="chips-h">Chip set</h2><p class="muted">Used by the chip calculator to count stacks.</p></div>
    <form data-form="chips" novalidate>
      <ul class="chip-rows" id="chip-rows">${s.chips.map(chipRow).join('')}</ul>
      <p class="form-error" id="chips-error" role="alert"></p>
      <div class="actions">
        ${btn('add-chip-row', `${ICON.plus} Add chip`)}
        <button type="submit" class="btn primary">Save chip set</button>
      </div>
    </form>
    <form data-form="stack" class="inline-form" novalidate>
      <div class="field grow"><label for="def-stack">Default starting stack</label><input id="def-stack" name="stack" type="number" min="1" step="1" value="${s.defaultStack}" required></div>
      <button type="submit" class="btn ghost">Save</button>
    </form>
  </section>

  <section class="card glass" aria-labelledby="pin-h">
    <div class="card-head"><h2 id="pin-h">Admin PIN</h2><p class="muted">Stored only in this browser and never included in exports.</p></div>
    <form data-form="pin" class="form-grid" novalidate>
      <div class="field"><label for="pin-cur">Current PIN</label><input id="pin-cur" name="current" type="password" inputmode="numeric" autocomplete="current-password" required></div>
      <div class="field"><label for="pin-new">New PIN</label><input id="pin-new" name="next" type="password" inputmode="numeric" autocomplete="new-password" required></div>
      <div class="field"><label for="pin-new2">Confirm new PIN</label><input id="pin-new2" name="confirm" type="password" inputmode="numeric" autocomplete="new-password" required></div>
      <p class="form-error span-all" id="pin-error" role="alert"></p>
      <div class="actions span-all"><button type="submit" class="btn primary">Change PIN</button></div>
    </form>
  </section>

  <section class="card glass" aria-labelledby="data-h">
    <div class="card-head"><h2 id="data-h">Backup & sharing</h2>
      <p class="muted">Data lives in this browser only. Export a JSON backup regularly. Players can open that file on the viewer page to see standings.</p></div>
    <div class="actions">
      ${btn('export', 'Export JSON', { cls: 'btn primary' })}
      <label class="btn ghost file-btn">Import JSON<input type="file" accept="application/json,.json" data-change="import" class="sr-only"></label>
      ${btn('reset-all', 'Delete all data', { cls: 'btn ghost danger-text' })}
    </div>
    <p class="muted small">Last saved: ${state.data.updatedAt ? new Date(state.data.updatedAt).toLocaleString() : 'never'}</p>
  </section>`;
}

/* =========================================================== actions */

function currentGame() { return D.liveGame(state.data); }
function entryOf(game, pid) { return game?.entries.find((e) => e.playerId === pid); }

function buyDialog(kind, pid) {
  const game = currentGame();
  if (!game) return;
  const label = kind === 'rebuy' ? 'Rebuy' : 'Add-on';
  openDialog({
    title: `${label}: ${D.playerName(state.data, pid)}`,
    body: `<div class="field"><label for="buy-chips">Chips</label>
      <input id="buy-chips" name="chips" type="number" inputmode="numeric" min="1" step="1" required value="${game.startingStack}" autofocus></div>
      ${kind === 'rebuy' && game.type === 'tournament' && !entryOf(game, pid)?.active ? '<p class="hint">This brings the player back into the tournament.</p>' : ''}`,
    confirmLabel: `Add ${label.toLowerCase()}`,
    onSubmit: (fd) => {
      const chips = Math.floor(Number(fd.get('chips')));
      if (!(chips > 0)) return 'Enter a chip amount above 0.';
      D.addBuy(game, pid, kind, chips);
      setTimeout(() => commit(`${label} of ${D.fmt(chips)} chips for ${D.playerName(state.data, pid)}.`, 'success'), 0);
      return true;
    },
  });
}

function eliminateDialog(pid) {
  const game = currentGame();
  const others = game.entries.filter((e) => e.active && e.playerId !== pid);
  openDialog({
    title: `Eliminate ${D.playerName(state.data, pid)}`,
    body: `<p>They will finish <strong>${D.ordinal(game.entries.filter((e) => e.active).length)}</strong>.</p>
      <div class="field"><label for="ko-by">Knocked out by</label>
        <select id="ko-by" name="by"><option value="">Not recorded</option>
          ${others.map((e) => `<option value="${esc(e.playerId)}">${name(e.playerId)}</option>`).join('')}
        </select></div>`,
    confirmLabel: 'Eliminate',
    danger: true,
    onSubmit: (fd) => {
      const place = D.eliminate(game, pid, String(fd.get('by') || '') || null);
      const left = game.entries.filter((e) => e.active);
      setTimeout(() => {
        commit(`${D.playerName(state.data, pid)} finished ${D.ordinal(place)}.`);
        if (left.length === 1) announce(`${D.playerName(state.data, left[0].playerId)} is the last player standing.`);
      }, 0);
      return true;
    },
  });
}

function chipCalcDialog(pid) {
  const game = currentGame();
  const chips = state.data.settings.chips.slice().sort((a, b) => a.value - b.value);
  if (!chips.length) { toast('Add chips in Settings → Chip set first.', 'error'); return; }
  openDialog({
    title: `Count chips: ${D.playerName(state.data, pid)}`,
    body: `<ul class="calc-list">${chips.map((c) => `<li>
        <span class="chip-swatch" style="--chip:${esc(c.color)}" aria-hidden="true"></span>
        <label for="calc-${esc(c.id)}">${esc(c.name)} <span class="muted">× ${D.fmt(c.value)}</span></label>
        <input id="calc-${esc(c.id)}" name="${esc(c.id)}" type="number" inputmode="numeric" min="0" step="1" placeholder="0">
      </li>`).join('')}</ul>
      <p class="calc-total">Total <output id="calc-total" for="${chips.map((c) => `calc-${esc(c.id)}`).join(' ')}" aria-live="polite">0</output></p>`,
    confirmLabel: 'Use this total',
    onReady: (dlg) => {
      const form = $('#dlg-form', dlg);
      const update = () => {
        const counts = Object.fromEntries(chips.map((c) => [c.id, form.elements[c.id].value]));
        $('#calc-total').textContent = D.fmt(D.chipTotal(counts, chips));
      };
      form.addEventListener('input', update);
      dlg.addEventListener('close', () => form.removeEventListener('input', update), { once: true });
    },
    onSubmit: (fd) => {
      const counts = Object.fromEntries(chips.map((c) => [c.id, fd.get(c.id)]));
      const total = D.chipTotal(counts, chips);
      const e = entryOf(game, pid);
      if (e) e.finalChips = total;
      setTimeout(() => commit(`${D.playerName(state.data, pid)}: ${D.fmt(total)} chips counted.`, 'success'), 0);
      return true;
    },
  });
}

async function closeGameFlow() {
  const game = currentGame();
  const { errors, warnings } = D.closeCheck(game);
  if (errors.length) {
    infoDialog('Can’t close yet', `<ul class="bullets">${errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
    return;
  }
  const preview = { ...game, results: D.computeResults(game, state.data.settings.points) };
  const html = `${warnings.length ? `<div class="callout warn">${ICON.warn}<div>${warnings.map((w) => `<p>${esc(w)}</p>`).join('')}</div></div>` : ''}
    <p>These results will be saved:</p>${resultsTable(preview)}`;
  const ok = await confirmDialog(html, { title: `Close ${game.name}?`, confirmLabel: 'Close & save results', html: true });
  if (!ok) return;
  D.closeGame(state.data, game);
  const w = game.results.find((r) => r.place === 1);
  commit(`Game closed.${w ? ` ${D.playerName(state.data, w.playerId)} wins!` : ''}`, 'success');
}

function editGameDialog(gid) {
  const g = D.findGame(state.data, gid);
  if (!g) return;
  openDialog({
    title: 'Edit game details',
    body: `<div class="field"><label for="eg-name">Name</label><input id="eg-name" name="name" maxlength="60" required value="${esc(g.name)}"></div>
      <div class="field"><label for="eg-date">Date</label><input id="eg-date" name="date" type="date" required value="${esc(g.date)}"></div>
      <div class="field"><label for="eg-season">Season</label><select id="eg-season" name="seasonId"><option value="">No season</option>
        ${state.data.seasons.map((s) => `<option value="${esc(s.id)}" ${s.id === g.seasonId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>`,
    onSubmit: (fd) => {
      const nm = String(fd.get('name')).trim();
      if (!nm) return 'Give the game a name.';
      g.name = nm;
      g.date = String(fd.get('date')) || g.date;
      g.seasonId = String(fd.get('seasonId')) || null;
      setTimeout(() => commit('Game updated.', 'success'), 0);
      return true;
    },
  });
}

function renameDialog(kind, id) {
  const list = kind === 'player' ? state.data.players : state.data.seasons;
  const item = list.find((x) => x.id === id);
  if (!item) return;
  openDialog({
    title: `Rename ${kind}`,
    body: `<div class="field"><label for="rn">Name</label><input id="rn" name="name" maxlength="40" required value="${esc(item.name)}"></div>`,
    onSubmit: (fd) => {
      const nm = String(fd.get('name')).trim();
      if (!nm) return 'Name can’t be empty.';
      if (list.some((x) => x.id !== id && x.name.toLowerCase() === nm.toLowerCase())) return `Another ${kind} already has that name.`;
      item.name = nm;
      setTimeout(() => commit('Renamed.', 'success'), 0);
      return true;
    },
  });
}

function addEntryDialog() {
  const game = currentGame();
  const avail = state.data.players.filter((p) => p.active && !game.entries.some((e) => e.playerId === p.id));
  if (!avail.length) { toast('Everyone active is already at the table. Add players on the Players tab.'); return; }
  openDialog({
    title: 'Add player to this game',
    body: `<div class="field"><label for="ae-player">Player</label><select id="ae-player" name="pid">${avail.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <p class="hint">They buy in for ${D.fmt(game.startingStack)} chips and take the last seat.</p>`,
    confirmLabel: 'Add to game',
    onSubmit: (fd) => {
      const pid = String(fd.get('pid'));
      D.addEntry(game, pid);
      setTimeout(() => commit(`${D.playerName(state.data, pid)} joined the game.`, 'success'), 0);
      return true;
    },
  });
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dealerAnnouncement(game) {
  const p = D.positions(game);
  const parts = [`Hand ${game.dealer.hands + 1}.`];
  if (p.button) parts.push(`Dealer ${D.playerName(state.data, p.button)}.`);
  if (p.sb) parts.push(`Small blind ${D.playerName(state.data, p.sb)}.`);
  if (p.bb) parts.push(`Big blind ${D.playerName(state.data, p.bb)}.`);
  return parts.join(' ');
}

const ACTIONS = {
  'goto-players': () => setTab('players'),
  'goto-table': () => setTab('table'),
  'select-all': () => {
    const boxes = $$('input[name="players"]');
    const all = boxes.every((b) => b.checked);
    boxes.forEach((b) => { b.checked = !all; });
  },
  'next-hand': () => {
    const g = currentGame();
    if (D.nextHand(g)) { commit(); announce(dealerAnnouncement(g)); }
  },
  'undo-hand': () => {
    const g = currentGame();
    if (D.undoHand(g)) { commit(); announce(`Undone. ${dealerAnnouncement(g)}`); }
  },
  seat: (pid) => {
    const g = currentGame();
    if (g.dealer.button === pid) return;
    D.setButton(g, pid);
    commit();
    announce(`Button moved. ${dealerAnnouncement(g)}`);
  },
  shuffle: async () => {
    const g = currentGame();
    if (g.dealer.hands > 0 && !(await confirmDialog('Hands have already been dealt. Shuffle seats anyway?', { confirmLabel: 'Shuffle' }))) return;
    D.shuffleSeats(g);
    g.dealer.button = g.entries.find((e) => e.active)?.playerId ?? null;
    g.dealer.history = [];
    commit('Seats shuffled. Button is on seat 1.');
  },
  'add-entry': addEntryDialog,
  'open-chip-table': () => {
    const g = currentGame();
    openDialog({
      title: 'Move this game to the Chip Table',
      body: `<p>Players will bet from their phones. Each stack starts at the player’s current chips (their final count if entered, otherwise their buy-ins).</p>
        <div class="inline-form">
          <div class="field"><label for="ct-sb">Small blind</label><input id="ct-sb" name="sb" type="number" inputmode="numeric" min="1" step="1" value="${Math.max(1, Math.round(g.startingStack / 200))}"></div>
          <div class="field"><label for="ct-bb">Big blind</label><input id="ct-bb" name="bb" type="number" inputmode="numeric" min="1" step="1" value="${Math.max(2, Math.round(g.startingStack / 100))}"></div>
        </div>`,
      confirmLabel: 'Open Chip Table',
      onSubmit: (fd) => {
        const sb = Math.floor(Number(fd.get('sb')));
        const bb = Math.floor(Number(fd.get('bb')));
        if (!(sb > 0 && bb >= sb)) return 'Big blind must be at least the small blind, and both above 0.';
        g.table = P.createTable(g, { sb, bb });
        store.save(state.data);
        location.href = 'host.html';
        return true;
      },
    });
  },
  'edit-game': (gid) => editGameDialog(gid),
  'cancel-game': async () => {
    const g = currentGame();
    if (!(await confirmDialog(`Discard “${g.name}”? Nothing from it will be saved.`, { title: 'Discard game?', confirmLabel: 'Discard game', danger: true }))) return;
    state.data.games = state.data.games.filter((x) => x.id !== g.id);
    state.data.liveGameId = null;
    commit('Game discarded.');
  },
  'close-game': closeGameFlow,
  rebuy: (pid) => buyDialog('rebuy', pid),
  addon: (pid) => buyDialog('addon', pid),
  eliminate: (pid) => eliminateDialog(pid),
  reinstate: (pid) => {
    if (D.reinstate(currentGame(), pid)) commit(`${D.playerName(state.data, pid)} is back in.`);
  },
  leave: (pid) => { D.setLeft(currentGame(), pid, true); commit(`${D.playerName(state.data, pid)} left the table. Enter their final chips.`); },
  return: (pid) => { D.setLeft(currentGame(), pid, false); commit(`${D.playerName(state.data, pid)} is back at the table.`); },
  count: (pid) => chipCalcDialog(pid),
  'seat-up': (pid) => { D.moveSeat(currentGame(), pid, -1); commit(); },
  'seat-down': (pid) => { D.moveSeat(currentGame(), pid, 1); commit(); },
  'undo-buy': (pid) => { if (D.removeLastBuy(currentGame(), pid)) commit('Last rebuy/add-on removed.'); },
  'remove-entry': async (pid) => {
    if (!(await confirmDialog(`Remove ${D.playerName(state.data, pid)} from this game? Their buy-ins are removed too.`, { confirmLabel: 'Remove', danger: true }))) return;
    D.removeEntry(currentGame(), pid);
    commit('Player removed from the game.');
  },
  reopen: async (gid) => {
    if (state.data.liveGameId) { infoDialog('A game is already live', '<p>Close or discard the live game before reopening another.</p>'); return; }
    const g = D.findGame(state.data, gid);
    if (!(await confirmDialog(`Reopen “${g.name}”? Its results are removed until you close it again.`, { confirmLabel: 'Reopen' }))) return;
    D.reopenGame(state.data, g);
    state.tab = 'table';
    setTab('table');
    commit('Game reopened.');
  },
  'delete-game': async (gid) => {
    const g = D.findGame(state.data, gid);
    if (!(await confirmDialog(`Delete “${g.name}” and its results permanently?`, { title: 'Delete game?', confirmLabel: 'Delete', danger: true }))) return;
    state.data.games = state.data.games.filter((x) => x.id !== gid);
    if (state.data.liveGameId === gid) state.data.liveGameId = null;
    commit('Game deleted.');
  },
  'rename-player': (pid) => renameDialog('player', pid),
  'toggle-player': (pid) => {
    const p = D.findPlayer(state.data, pid);
    p.active = !p.active;
    commit(p.active ? `${p.name} restored.` : `${p.name} retired.`);
  },
  'delete-player': async (pid) => {
    const p = D.findPlayer(state.data, pid);
    if (D.playerHasGames(state.data, pid)) {
      infoDialog('Player has game history', `<p>${esc(p.name)} has played games, so deleting them would break past results. Retire them instead to hide them from new games.</p>`);
      return;
    }
    if (!(await confirmDialog(`Delete ${p.name}?`, { confirmLabel: 'Delete', danger: true }))) return;
    state.data.players = state.data.players.filter((x) => x.id !== pid);
    commit('Player deleted.');
  },
  'activate-season': (sid) => { state.data.activeSeasonId = sid; commit('Current season updated.', 'success'); },
  'rename-season': (sid) => renameDialog('season', sid),
  'delete-season': async (sid) => {
    const s = state.data.seasons.find((x) => x.id === sid);
    const count = state.data.games.filter((g) => g.seasonId === sid).length;
    const msg = count ? `Delete “${s.name}”? Its ${count} game${count > 1 ? 's' : ''} will be kept with no season.` : `Delete “${s.name}”?`;
    if (!(await confirmDialog(msg, { confirmLabel: 'Delete season', danger: true }))) return;
    state.data.games.forEach((g) => { if (g.seasonId === sid) g.seasonId = null; });
    state.data.seasons = state.data.seasons.filter((x) => x.id !== sid);
    if (state.data.activeSeasonId === sid) state.data.activeSeasonId = null;
    commit('Season deleted.');
  },
  recalc: async () => {
    if (!(await confirmDialog('Recalculate points for every closed game using the current rules?', { confirmLabel: 'Recalculate' }))) return;
    const n = D.recalcAll(state.data);
    commit(`Recalculated ${n} game${n === 1 ? '' : 's'}.`, 'success');
  },
  'add-chip-row': () => {
    const list = $('#chip-rows');
    list.insertAdjacentHTML('beforeend', chipRow({ id: `chip-${D.uid().slice(0, 8)}`, name: '', color: '#7c3aed', value: 1 }));
    list.lastElementChild.querySelector('input').focus();
  },
  'remove-chip-row': (_, el) => {
    const row = el.closest('.chip-row');
    const next = row.nextElementSibling || row.previousElementSibling;
    row.remove();
    (next?.querySelector('input') || $('#a-add-chip-row-'))?.focus();
  },
  export: () => {
    download(`holdem-tracker-${D.todayISO()}.json`, store.toExportJSON(state.data));
    toast('Backup downloaded.', 'success');
  },
  'reset-all': () => {
    openDialog({
      title: 'Delete all data',
      body: `<p>This permanently deletes every player, season and game on this device. Export a backup first if you might need it. Type <strong>DELETE</strong> to confirm.</p>
        <div class="field"><label for="del-word">Confirmation</label><input id="del-word" name="word" autocomplete="off" required></div>`,
      confirmLabel: 'Delete everything',
      danger: true,
      onSubmit: (fd) => {
        if (String(fd.get('word')).trim() !== 'DELETE') return 'Type DELETE in capitals to confirm.';
        store.clearAll();
        state.data = store.createEmpty();
        setTimeout(() => commit('All data deleted.'), 0);
        return true;
      },
    });
  },
};

const FORMS = {
  'new-game': (form) => {
    const fd = new FormData(form);
    const err = $('#ng-error');
    const nm = String(fd.get('name')).trim();
    const stack = Math.floor(Number(fd.get('stack')));
    const playerIds = fd.getAll('players').map(String);
    if (!nm) { err.textContent = 'Give the game a name.'; $('#ng-name').focus(); return; }
    if (!(stack > 0)) { err.textContent = 'Starting stack must be above 0.'; $('#ng-stack').focus(); return; }
    if (playerIds.length < 2) { err.textContent = 'Pick at least two players.'; form.querySelector('input[name="players"]')?.focus(); return; }
    const game = D.createGame({
      name: nm,
      date: String(fd.get('date')) || D.todayISO(),
      type: fd.get('type') === 'cash' ? 'cash' : 'tournament',
      seasonId: String(fd.get('seasonId')) || null,
      startingStack: stack,
      playerIds,
    });
    if (fd.get('chipTable') === 'on') {
      const sb = Math.floor(Number(fd.get('sb')));
      const bb = Math.floor(Number(fd.get('bb')));
      if (!(sb > 0 && bb >= sb)) { err.textContent = 'Big blind must be at least the small blind, and both above 0.'; $('#ng-bb').focus(); return; }
      game.table = P.createTable(game, { sb, bb });
    }
    state.data.games.push(game);
    state.data.liveGameId = game.id;
    commit(`${nm} started with ${playerIds.length} players.`, 'success');
    if (game.table) { location.href = 'host.html'; return; }
    $('#a-next-hand-')?.focus();
  },
  'add-player': (form) => {
    const input = form.elements.name;
    const nm = input.value.trim();
    const err = $('#player-error');
    if (!nm) { err.textContent = 'Enter a name.'; input.focus(); return; }
    if (state.data.players.some((p) => p.name.toLowerCase() === nm.toLowerCase())) { err.textContent = `${nm} already exists.`; input.focus(); return; }
    state.data.players.push({ id: D.uid(), name: nm, active: true, createdAt: new Date().toISOString() });
    commit(`${nm} added.`, 'success');
    $('#new-player')?.focus();
  },
  'add-season': (form) => {
    const nm = form.elements.name.value.trim();
    const err = $('#season-error');
    if (!nm) { err.textContent = 'Enter a season name.'; form.elements.name.focus(); return; }
    if (state.data.seasons.some((s) => s.name.toLowerCase() === nm.toLowerCase())) { err.textContent = 'That season already exists.'; return; }
    const s = { id: D.uid(), name: nm, startDate: form.elements.start.value, createdAt: new Date().toISOString() };
    state.data.seasons.push(s);
    if (!state.data.activeSeasonId) state.data.activeSeasonId = s.id;
    commit(`${nm} added.`, 'success');
    $('#season-name')?.focus();
  },
  points: async (form) => {
    const fd = new FormData(form);
    const err = $('#pts-error');
    const parts = String(fd.get('places')).split(',').map((x) => x.trim()).filter(Boolean);
    const places = parts.map(Number);
    if (!places.length || places.some((n) => !Number.isFinite(n) || n < 0)) { err.textContent = 'Use positive numbers separated by commas, e.g. 10, 7, 5.'; $('#pts-places').focus(); return; }
    const participation = Number(fd.get('participation'));
    const knockout = Number(fd.get('knockout'));
    if (!(participation >= 0) || !(knockout >= 0)) { err.textContent = 'Bonuses must be 0 or more.'; return; }
    state.data.settings.points = { places, participation, knockout, applyToCash: fd.get('applyToCash') === 'on' };
    commit('Points rules saved.', 'success');
    const closed = state.data.games.some((g) => g.status === 'closed');
    if (closed && (await confirmDialog('Apply the new rules to games that are already closed?', { title: 'Recalculate past games?', confirmLabel: 'Recalculate' }))) {
      const n = D.recalcAll(state.data);
      commit(`Recalculated ${n} game${n === 1 ? '' : 's'}.`, 'success');
    }
  },
  chips: (form) => {
    const err = $('#chips-error');
    const rows = $$('.chip-row', form);
    const chips = [];
    for (const r of rows) {
      const nm = r.querySelector('[name="chip-name"]').value.trim();
      const value = Math.floor(Number(r.querySelector('[name="chip-value"]').value));
      if (!nm) { err.textContent = 'Every chip needs a name.'; r.querySelector('[name="chip-name"]').focus(); return; }
      if (!(value >= 1)) { err.textContent = `${nm} needs a value of at least 1.`; r.querySelector('[name="chip-value"]').focus(); return; }
      chips.push({ id: r.dataset.chipId, name: nm, color: r.querySelector('[name="chip-color"]').value, value });
    }
    state.data.settings.chips = chips;
    commit('Chip set saved.', 'success');
  },
  stack: (form) => {
    const v = Math.floor(Number(form.elements.stack.value));
    if (!(v > 0)) { toast('Starting stack must be above 0.', 'error'); return; }
    state.data.settings.defaultStack = v;
    commit('Default stack saved.', 'success');
  },
  pin: async (form) => {
    const fd = new FormData(form);
    const err = $('#pin-error');
    const rec = store.getPinRecord();
    const cur = String(fd.get('current')).trim();
    const next = String(fd.get('next')).trim();
    if (!rec || (await hashPin(cur, rec.salt)) !== rec.hash) { err.textContent = 'Current PIN is incorrect.'; $('#pin-cur').focus(); return; }
    if (!/^\d{4,8}$/.test(next)) { err.textContent = 'New PIN must be 4 to 8 digits.'; $('#pin-new').focus(); return; }
    if (next !== String(fd.get('confirm')).trim()) { err.textContent = 'New PINs don’t match.'; $('#pin-new2').focus(); return; }
    const salt = D.uid();
    store.setPinRecord({ salt, hash: await hashPin(next, salt) });
    form.reset();
    err.textContent = '';
    toast('PIN changed.', 'success');
  },
};

async function handleImport(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const next = store.parseImport(await file.text());
    const ok = await confirmDialog(
      `Replace everything on this device with “${file.name}”? It has ${next.players.length} players and ${next.games.length} games.`,
      { title: 'Import backup?', confirmLabel: 'Replace data', danger: true },
    );
    if (!ok) return;
    state.data = next;
    commit('Backup imported.', 'success');
  } catch (e) {
    infoDialog('Import failed', `<p>${esc(e.message)}</p>`);
  }
}

function initEvents() {
  const main = $('#main');
  main.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    el.closest('details.menu')?.removeAttribute('open');
    ACTIONS[el.dataset.action]?.(el.dataset.pid, el);
  });
  main.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    FORMS[form.dataset.form]?.(form);
  });
  main.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (!el) return;
    if (el.dataset.change === 'final') {
      const entry = entryOf(currentGame(), el.dataset.pid);
      if (!entry) return;
      const v = el.value.trim();
      entry.finalChips = v === '' ? null : Math.max(0, Math.floor(Number(v)) || 0);
      // Defer so focus has moved (e.g. on Tab) before re-render restores it.
      setTimeout(() => commit(), 0);
    } else if (el.dataset.change === 'games-filter') {
      state.gameFilter = el.value;
      render();
    } else if (el.dataset.change === 'import') {
      handleImport(el);
    }
  });
  // Close open "more" menus on outside click / Escape.
  document.addEventListener('click', (e) => {
    $$('details.menu[open]').forEach((d) => { if (!d.contains(e.target)) d.removeAttribute('open'); });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = $('details.menu[open]');
    if (open) { open.removeAttribute('open'); open.querySelector('summary').focus(); }
  });
  // Keep in sync if the data is changed in another tab.
  window.addEventListener('storage', (e) => {
    if (e.key === store.DATA_KEY) { state.data = store.load(); if (!$('#app').hidden) render(); }
  });
}

/* =========================================================== boot */

function boot() {
  initTheme();
  initDialog();
  initLock();
  initTabs();
  initEvents();
  if (store.getPinRecord() && store.isUnlocked()) showApp();
  else showLock();
}

boot();
