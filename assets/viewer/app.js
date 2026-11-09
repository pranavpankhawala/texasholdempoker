/**
 * Viewer presentation layer (read-only standings).
 */
import * as source from './data.js';
import * as S from './stats.js';
import { lineChart, divergingBars } from './charts.js';

const state = {
  data: null,
  origin: 'none', // 'file' | 'local' | 'published' | 'none'
  fileName: '',
  season: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const nf = new Intl.NumberFormat();
const fmt = (n) => nf.format(n);
const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(Math.abs(n))}` : '0');
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
const pname = (id) => state.data.players.find((p) => p.id === id)?.name ?? 'Unknown player';
const fmtDate = (iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => {
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, opts);
};

/* Categorical series colors follow the player (creation order), never their rank. */
const SLOTS = 8;
function playerColor(pid) {
  const i = state.data.players.findIndex((p) => p.id === pid);
  return i >= 0 && i < SLOTS ? { color: `var(--s${i + 1})`, dashed: false } : { color: 'var(--s-other)', dashed: true };
}

/* ------------------------------------------------------------ theme */
function effectiveTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function syncTheme() {
  const b = $('#theme-toggle');
  const dark = effectiveTheme() === 'dark';
  b.setAttribute('aria-pressed', String(dark));
  b.querySelector('.label').textContent = dark ? 'Dark' : 'Light';
}
function initTheme() {
  $('#theme-toggle').addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('thp.theme', next); } catch { /* ignore */ }
    syncTheme();
  });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', syncTheme);
  syncTheme();
}

/* ------------------------------------------------------------ data */
async function loadInitial() {
  const local = source.loadLocal();
  if (source.hasContent(local)) { setData(local, 'local'); return; }
  const pub = await source.loadPublished();
  if (source.hasContent(pub)) { setData(pub, 'published'); return; }
  setData(null, 'none');
}

function setData(data, origin, fileName = '') {
  state.data = data;
  state.origin = origin;
  state.fileName = fileName;
  if (data) {
    const valid = state.season === 'all' || data.seasons.some((s) => s.id === state.season);
    if (!valid) state.season = data.activeSeasonId && data.seasons.some((s) => s.id === data.activeSeasonId) ? data.activeSeasonId : 'all';
  }
  render();
}

/* ------------------------------------------------------------ render */
function render() {
  renderSource();
  const main = $('#content');
  const d = state.data;
  if (!source.hasContent(d)) {
    $('#toolbar-season').hidden = true;
    main.innerHTML = `<section class="card glass empty" aria-labelledby="empty-h">
      <div class="empty-art" aria-hidden="true">♠ ♥ ♣ ♦</div>
      <h2 id="empty-h">No standings to show yet</h2>
      <p class="muted">This page shows data saved in this browser by the admin page. On another device, open a backup file your host exported.</p>
      <div class="actions center">
        <label class="btn primary file-btn">Open backup file<input type="file" accept="application/json,.json" class="sr-only" data-file></label>
        <a class="btn ghost" href="admin.html">Go to admin</a>
      </div>
    </section>`;
    return;
  }

  $('#toolbar-season').hidden = false;
  renderSeasonSelect();
  const sid = state.season;
  const table = S.standings(d, sid);
  const head = S.headline(d, sid);
  const live = d.liveGameId ? d.games.find((g) => g.id === d.liveGameId && g.status === 'live') : null;
  const games = S.seasonGames(d, sid).slice().reverse();
  const cash = S.cashNet(d, sid);
  const periodName = sid === 'all' ? 'All-time' : (d.seasons.find((s) => s.id === sid)?.name ?? 'Season');

  main.innerHTML = `
    ${live ? renderLive(live) : ''}
    <section aria-labelledby="kpi-h">
      <h2 id="kpi-h" class="sr-only">${esc(periodName)} summary</h2>
      <ul class="kpis">
        <li class="kpi glass"><span class="kpi-label">Games played</span><span class="kpi-value">${fmt(head.games)}</span></li>
        <li class="kpi glass"><span class="kpi-label">Players</span><span class="kpi-value">${fmt(head.players)}</span></li>
        <li class="kpi glass"><span class="kpi-label">Points leader</span><span class="kpi-value sm">${head.leader ? esc(pname(head.leader.playerId)) : '—'}</span>
          ${head.leader ? `<span class="kpi-sub">${fmt(head.leader.points)} pts</span>` : ''}</li>
        <li class="kpi glass"><span class="kpi-label">Hands dealt</span><span class="kpi-value">${fmt(head.hands)}</span>
          ${head.biggest ? `<span class="kpi-sub">Biggest cash win: ${esc(pname(head.biggest.playerId))} ${signed(head.biggest.net)}</span>` : ''}</li>
      </ul>
    </section>

    <section class="card glass" aria-labelledby="lb-h">
      <div class="card-head">
        <h2 id="lb-h">${esc(periodName)} leaderboard</h2>
        <p class="muted small">Ranked by points, then wins. Select a player for their history.</p>
      </div>
      ${table.length ? renderLeaderboard(table) : '<p class="muted">No closed games in this period yet.</p>'}
    </section>

    <div class="chart-grid">
      <section class="card glass" aria-labelledby="race-h">
        <div class="card-head">
          <h2 id="race-h">Points race</h2>
          <p class="muted small">Running points total after each game${table.length > 6 ? ' (top 6 players)' : ''}.</p>
        </div>
        <div id="race-legend" class="legend"></div>
        <div id="race-chart" class="chart-host"></div>
      </section>
      ${cash.length ? `<section class="card glass" aria-labelledby="cash-h">
        <div class="card-head">
          <h2 id="cash-h">Cash game chips</h2>
          <p class="muted small">Net chips won or lost across cash games.</p>
        </div>
        <div id="cash-chart"></div>
      </section>` : ''}
    </div>

    <section class="card glass" aria-labelledby="hist-h">
      <div class="card-head"><h2 id="hist-h">Game history</h2></div>
      ${games.length ? `<ul class="history">${games.map(renderHistoryItem).join('')}</ul>` : '<p class="muted">No closed games in this period yet.</p>'}
    </section>`;

  drawCharts(table, cash);
}

function renderSource() {
  const el = $('#source');
  const d = state.data;
  const when = d?.updatedAt ? new Date(d.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const text = {
    file: `Viewing file: ${state.fileName}`,
    local: 'Viewing data saved on this device',
    published: 'Viewing published standings',
    none: 'No data loaded',
  }[state.origin];
  el.innerHTML = `<span class="src-dot ${state.origin}" aria-hidden="true"></span>
    <span><strong>${esc(text)}</strong>${when ? `<span class="muted"> · updated ${esc(when)}</span>` : ''}</span>`;
  $('#use-local').hidden = state.origin !== 'file' || !source.hasContent(source.loadLocal());
}

function renderSeasonSelect() {
  const sel = $('#season');
  const d = state.data;
  sel.innerHTML = `<option value="all">All-time</option>${d.seasons.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}`;
  sel.value = state.season;
}

function renderLive(g) {
  const pos = S.livePositions(g);
  const alive = g.entries.filter((e) => e.active).length;
  const chipsIn = g.entries.reduce((s, e) => s + e.chipsIn, 0);
  const role = (pid) => [pid === pos.button && '<span class="pos-badge d">D</span>', pid === pos.sb && '<span class="pos-badge sb">SB</span>', pid === pos.bb && '<span class="pos-badge bb">BB</span>'].filter(Boolean).join('');
  return `<section class="card glass live" aria-labelledby="live-h">
    <div class="live-head">
      <div>
        <p class="eyebrow"><span class="live-dot" aria-hidden="true"></span> Live now</p>
        <h2 id="live-h">${esc(g.name)}</h2>
        <p class="muted small">${g.type === 'cash' ? 'Cash game' : 'Tournament'} · ${esc(fmtDate(g.date))}</p>
      </div>
      <dl class="live-stats">
        <div><dt>Hand</dt><dd>${fmt(g.dealer.hands + 1)}</dd></div>
        <div><dt>${g.type === 'cash' ? 'At table' : 'Still in'}</dt><dd>${alive}/${g.entries.length}</dd></div>
        <div><dt>Chips in play</dt><dd>${fmt(chipsIn)}</dd></div>
      </dl>
    </div>
    <p class="live-pos">
      <span><span class="pos-badge d" aria-hidden="true">D</span> <span class="sr-only">Dealer:</span> ${pos.button ? esc(pname(pos.button)) : '—'}</span>
      <span><span class="pos-badge sb" aria-hidden="true">SB</span> <span class="sr-only">Small blind:</span> ${pos.sb ? esc(pname(pos.sb)) : '—'}</span>
      <span><span class="pos-badge bb" aria-hidden="true">BB</span> <span class="sr-only">Big blind:</span> ${pos.bb ? esc(pname(pos.bb)) : '—'}</span>
    </p>
    <ol class="live-seats" aria-label="Seats in order">
      ${g.entries.map((e) => `<li class="${e.active ? '' : 'out'}">
        <span class="ls-name">${esc(pname(e.playerId))} <span aria-hidden="true">${role(e.playerId)}</span></span>
        <span class="ls-meta">${!e.active ? (g.type === 'cash' ? 'Left' : `Out · ${ordinal(e.place)}`) : `${fmt(e.chipsIn)} in`}${e.rebuys ? ` · ${e.rebuys} rebuy${e.rebuys > 1 ? 's' : ''}` : ''}${e.knockouts ? ` · ${e.knockouts} KO` : ''}</span>
      </li>`).join('')}
    </ol>
  </section>`;
}

function renderLeaderboard(rows) {
  const anyCash = rows.some((r) => r.cashGames > 0);
  const medal = (r) => (r.rank <= 3 ? `<span class="medal m${r.rank}" aria-hidden="true">${r.rank}</span>` : `<span class="rank">${r.rank}</span>`);
  return `<div class="table-wrap"><table class="data">
    <caption class="sr-only">Leaderboard, ranked by points</caption>
    <thead><tr>
      <th scope="col">#</th><th scope="col">Player</th><th scope="col" class="num">Points</th>
      <th scope="col" class="num">Games</th><th scope="col" class="num">Wins</th><th scope="col" class="num">Top 3</th>
      <th scope="col" class="num">KOs</th><th scope="col" class="num">Avg finish</th>${anyCash ? '<th scope="col" class="num">Cash net</th>' : ''}
    </tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td>${medal(r)}<span class="sr-only">Rank ${r.rank}</span></td>
      <th scope="row"><button type="button" class="player-link" data-player="${esc(r.playerId)}">
        <span class="key" style="--c:${playerColor(r.playerId).color}" aria-hidden="true"></span>${esc(pname(r.playerId))}</button></th>
      <td class="num strong">${fmt(r.points)}</td><td class="num">${r.games}</td><td class="num">${r.wins}</td><td class="num">${r.podiums}</td>
      <td class="num">${r.knockouts}</td><td class="num">${r.avgPlace ? r.avgPlace.toFixed(1) : '—'}</td>
      ${anyCash ? `<td class="num ${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}">${r.cashGames ? signed(r.net) : '—'}</td>` : ''}
    </tr>`).join('')}</tbody></table></div>`;
}

function renderHistoryItem(g) {
  const winner = g.results.find((r) => r.place === 1);
  const isCash = g.type === 'cash';
  return `<li><details class="hist">
    <summary>
      <span class="hist-main"><strong>${esc(g.name)}</strong><span class="muted">${esc(fmtDate(g.date))} · ${isCash ? 'Cash' : 'Tournament'} · ${g.results.length} players</span></span>
      ${winner ? `<span class="hist-win"><span class="medal m1" aria-hidden="true">1</span><span class="sr-only">Winner: </span>${esc(pname(winner.playerId))}</span>` : ''}
    </summary>
    <div class="table-wrap"><table class="data compact">
      <caption class="sr-only">Results for ${esc(g.name)}</caption>
      <thead><tr><th scope="col">Place</th><th scope="col">Player</th><th scope="col" class="num">Points</th>${isCash ? '<th scope="col" class="num">Net chips</th>' : '<th scope="col" class="num">KOs</th>'}</tr></thead>
      <tbody>${g.results.map((r) => `<tr><td>${ordinal(r.place)}</td><th scope="row">${esc(pname(r.playerId))}</th><td class="num">${fmt(r.points)}</td>
        ${isCash ? `<td class="num ${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}">${signed(r.net ?? 0)}</td>` : `<td class="num">${r.knockouts}</td>`}</tr>`).join('')}</tbody>
    </table></div>
  </details></li>`;
}

function drawCharts(table, cash) {
  const host = $('#race-chart');
  if (!host) return;
  const race = S.pointsRace(state.data, state.season);
  if (!race.games.length) { host.innerHTML = '<p class="muted">Charts appear after the first closed game.</p>'; $('#race-legend').innerHTML = ''; }
  else {
    const top = table.slice(0, 6).map((r) => r.playerId);
    const series = top.map((pid) => ({ name: pname(pid), values: race.series.get(pid) || [], ...playerColor(pid) }));
    $('#race-legend').innerHTML = series.map((s) => `<span class="legend-item"><span class="key ${s.dashed ? 'dashed' : ''}" style="--c:${s.color}" aria-hidden="true"></span>${esc(s.name)}</span>`).join('');
    const cfg = {
      label: 'Points race line chart',
      unit: 'points',
      xLabels: race.games.map((g) => fmtDate(g.date, { day: 'numeric', month: 'short' })),
      xSub: race.games.map((g) => g.name),
      series,
    };
    lineChart(host, cfg);
    host._cfg = cfg;
  }
  const cashHost = $('#cash-chart');
  if (cashHost) divergingBars(cashHost, cash.map((c) => ({ name: pname(c.playerId), value: c.net, sub: `${c.games} game${c.games > 1 ? 's' : ''}` })), 'chips');
}

/* ------------------------------------------------------------ player dialog */
function openPlayer(pid) {
  const dlg = $('#player-dlg');
  const sid = state.season;
  const row = S.standings(state.data, sid).find((r) => r.playerId === pid);
  const hist = S.playerHistory(state.data, pid, sid);
  $('#player-dlg-title').textContent = pname(pid);
  $('#player-dlg-body').innerHTML = `
    <ul class="kpis mini">
      <li class="kpi"><span class="kpi-label">Rank</span><span class="kpi-value">${row ? `#${row.rank}` : '—'}</span></li>
      <li class="kpi"><span class="kpi-label">Points</span><span class="kpi-value">${fmt(row?.points ?? 0)}</span></li>
      <li class="kpi"><span class="kpi-label">Wins</span><span class="kpi-value">${row?.wins ?? 0}</span></li>
      <li class="kpi"><span class="kpi-label">Best finish</span><span class="kpi-value">${row?.best ? ordinal(row.best) : '—'}</span></li>
    </ul>
    ${hist.length ? `<div class="table-wrap"><table class="data compact">
      <caption class="sr-only">Game history for ${esc(pname(pid))}</caption>
      <thead><tr><th scope="col">Date</th><th scope="col">Game</th><th scope="col" class="num">Place</th><th scope="col" class="num">Points</th><th scope="col" class="num">Chips</th></tr></thead>
      <tbody>${hist.map(({ game, result }) => `<tr><td>${esc(fmtDate(game.date, { day: 'numeric', month: 'short' }))}</td><th scope="row">${esc(game.name)}</th>
        <td class="num">${ordinal(result.place)}</td><td class="num">${fmt(result.points)}</td>
        <td class="num ${result.net > 0 ? 'pos' : result.net < 0 ? 'neg' : ''}">${game.type === 'cash' ? signed(result.net ?? 0) : `${result.knockouts} KO`}</td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="muted">No games in this period.</p>'}`;
  dlg.showModal();
}

/* ------------------------------------------------------------ events */
async function openFile(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const d = await source.loadFile(file);
    setData(d, 'file', file.name);
    announce(`Loaded ${file.name}.`);
  } catch (e) {
    announce(e.message);
    alertBox(e.message);
  }
}

function alertBox(msg) {
  const el = $('#alert');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(alertBox.t);
  alertBox.t = setTimeout(() => { el.hidden = true; }, 6000);
}

function announce(msg) {
  const el = $('#announcer');
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = msg; });
}

function initEvents() {
  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-file]')) openFile(e.target);
    if (e.target.id === 'season') { state.season = e.target.value; render(); $('#season').focus(); }
  });
  document.addEventListener('click', (e) => {
    const p = e.target.closest('[data-player]');
    if (p) openPlayer(p.dataset.player);
  });
  $('#use-local').addEventListener('click', () => { setData(source.loadLocal(), 'local'); announce('Showing data saved on this device.'); });
  const dlg = $('#player-dlg');
  $('#player-dlg-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  // Live refresh when the admin page (same browser) saves changes.
  source.onLocalChange(() => {
    if (state.origin === 'local' || state.origin === 'none') {
      const local = source.loadLocal();
      if (source.hasContent(local)) setData(local, 'local');
    }
  });

  // Redraw the line chart when its width changes.
  let lastW = 0;
  const ro = new ResizeObserver((entries) => {
    for (const en of entries) {
      const w = Math.round(en.contentRect.width);
      if (w && Math.abs(w - lastW) > 8 && en.target._cfg) { lastW = w; lineChart(en.target, en.target._cfg); }
    }
  });
  const mo = new MutationObserver(() => { const h = $('#race-chart'); if (h) ro.observe(h); });
  mo.observe($('#content'), { childList: true });
}

initTheme();
initEvents();
loadInitial();
