/**
 * Player phone: join a Chip Table room, take a seat, and bet from this device.
 */
import { connect } from './net.js';

const CLIENT_KEY = 'thp.play.client';
const ROOM_KEY = 'thp.play.room';

const state = {
  clientId: loadClientId(),
  room: '',
  link: null,
  status: { state: 'idle' },
  table: null, // public state from host
  you: null, // pid
  watching: false,
  error: '',
  closedMsg: '',
  raise: { key: '', value: '' },
  foldArmed: false,
  sending: false,
  lastTurnKey: '',
};

const $ = (s, r = document) => r.querySelector(s);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const nf = new Intl.NumberFormat();
const fmt = (n) => nf.format(n);
const STREET = { preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' };
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function loadClientId() {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  }
}

function announce(msg, assertive = false) {
  const el = $(assertive ? '#alert-live' : '#polite-live');
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = msg; });
}

/* ------------------------------------------------------------- theme */
function effectiveTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function syncTheme() {
  const b = $('#theme-toggle');
  b.setAttribute('aria-pressed', String(effectiveTheme() === 'dark'));
}
function initTheme() {
  $('#theme-toggle').addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('thp.theme', next); } catch { /* ignore */ }
    syncTheme();
  });
  syncTheme();
}

/* ------------------------------------------------------------- connection */
function join(room) {
  state.room = room;
  state.error = '';
  state.closedMsg = '';
  state.table = null;
  try { localStorage.setItem(ROOM_KEY, room); } catch { /* ignore */ }
  const u = new URL(location.href);
  u.searchParams.set('room', room);
  history.replaceState(null, '', u);
  state.link?.close();
  state.link = connect({
    room,
    clientId: state.clientId,
    onStatus: (s) => {
      state.status = s;
      if (s.state === 'not-found') state.error = s.detail;
      render();
    },
    onMessage,
  });
  render();
}

function leave() {
  state.link?.send({ t: 'release' });
  setTimeout(() => state.link?.close(), 150);
  state.link = null;
  state.table = null;
  state.you = null;
  state.watching = false;
  state.status = { state: 'idle' };
  const u = new URL(location.href);
  u.searchParams.delete('room');
  history.replaceState(null, '', u);
  render();
  $('#room-input')?.focus();
}

function onMessage(m) {
  if (m.t === 'state') {
    const prevYou = state.you;
    state.table = m.state;
    state.you = m.you || null;
    state.sending = false;
    if (state.you) state.watching = false;
    if (prevYou && !state.you) announce('Your seat was freed by the host.', true);
    notifyTurn();
    render();
  } else if (m.t === 'error') {
    state.sending = false;
    state.error = String(m.msg || 'Something went wrong.');
    announce(state.error, true);
    render();
    setTimeout(() => { state.error = ''; render(); }, 4000);
  } else if (m.t === 'closed') {
    state.closedMsg = String(m.msg || 'The table closed.');
    state.link?.close();
    state.link = null;
    render();
  }
}

function send(msg) {
  if (!state.link?.send(msg)) {
    state.error = 'Not connected right now. Reconnecting…';
    render();
    return false;
  }
  return true;
}

function notifyTurn() {
  const h = state.table?.hand;
  const key = h && state.you && h.toAct === state.you && h.legal ? `${h.id}:${h.street}:${h.currentBet}:${h.last?.type}` : '';
  if (key && key !== state.lastTurnKey) {
    const L = h.legal;
    announce(`Your turn. ${L.canCheck ? 'You can check.' : `${fmt(L.callAmount)} to call.`} Pot ${fmt(h.pot)}.`, true);
    if (navigator.vibrate && !reduceMotion()) navigator.vibrate([120, 60, 120]);
  }
  state.lastTurnKey = key;
}

/* ------------------------------------------------------------- render */
function render() {
  const root = $('#app');
  const focusId = document.activeElement?.id;
  document.body.dataset.view = state.watching ? 'watch' : 'phone';

  if (state.closedMsg) {
    root.innerHTML = `<section class="panel glass center-panel">
      <h1>Table closed</h1><p class="muted">${esc(state.closedMsg)}</p>
      <a class="btn primary" href="./">See standings</a>
      <button type="button" id="b-new" class="btn ghost" data-action="leave">Join another table</button></section>`;
  } else if (!state.link) {
    root.innerHTML = renderJoin();
  } else if (!state.table) {
    root.innerHTML = `<section class="panel glass center-panel" aria-busy="true">
      <div class="spinner" aria-hidden="true"></div>
      <h1>Joining room ${esc(state.room)}…</h1>
      ${statusLine()}
      ${state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ''}
      <button type="button" id="b-cancel" class="btn ghost" data-action="leave">Cancel</button></section>`;
  } else if (!state.you && !state.watching) {
    root.innerHTML = renderSeatPicker();
  } else {
    root.innerHTML = renderTable();
  }

  if (focusId) {
    const el = document.getElementById(focusId);
    if (el && el !== document.activeElement) el.focus({ preventScroll: true });
  }
}

function statusLine() {
  const s = state.status;
  const text = { connecting: 'Connecting…', online: 'Connected', reconnecting: 'Reconnecting…', 'not-found': 'Room not found', error: 'Offline', idle: '' }[s.state] || s.state;
  return `<p class="status" data-state="${esc(s.state)}"><span class="dot" aria-hidden="true"></span>${esc(text)}${s.detail && s.state !== 'online' ? ` <span class="muted">· ${esc(s.detail)}</span>` : ''}</p>`;
}

function renderJoin() {
  let last = '';
  try { last = localStorage.getItem(ROOM_KEY) || ''; } catch { /* ignore */ }
  return `<section class="panel glass join-panel" aria-labelledby="join-h">
    <div class="hero-chips" aria-hidden="true"><span></span><span></span><span></span></div>
    <h1 id="join-h">Join a Chip Table</h1>
    <p class="muted">Enter the room code shown on the host’s screen, or scan their QR code.</p>
    <form id="join-form" class="join-form" novalidate>
      <label for="room-input">Room code</label>
      <input id="room-input" name="room" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="8" inputmode="text" placeholder="e.g. K7Q2MX" value="${esc(state.room || last)}" aria-describedby="join-err">
      <p id="join-err" class="error" role="alert">${esc(state.error)}</p>
      <button type="submit" class="btn primary block">Join table</button>
    </form>
    <a class="link" href="./">View standings instead</a>
  </section>`;
}

function renderSeatPicker() {
  const t = state.table;
  return `<section class="panel glass" aria-labelledby="seat-h">
    <div class="panel-head">
      <div><p class="eyebrow">Room ${esc(t.room)} · ${esc(t.game.name)}</p><h1 id="seat-h">Which seat is yours?</h1></div>
      ${statusLine()}
    </div>
    ${state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ''}
    <ul class="seat-pick">
      ${t.seats.map((s) => `<li>
        <button type="button" id="b-seat-${esc(s.pid)}" class="seat-option" data-action="claim" data-pid="${esc(s.pid)}" ${s.claimed ? 'aria-disabled="true"' : ''}>
          <span class="so-no" aria-hidden="true">${s.seat}</span>
          <span class="so-name">${esc(s.name)}</span>
          <span class="so-meta">${s.claimed ? 'Taken' : `${fmt(s.stack)} chips`}</span>
        </button></li>`).join('')}
    </ul>
    <div class="row-actions">
      <button type="button" id="b-watch" class="btn ghost" data-action="watch">Just watch (big screen)</button>
      <button type="button" id="b-leave" class="btn ghost" data-action="leave">Leave room</button>
    </div>
  </section>`;
}

function badges(s) {
  return [s.button && '<span class="pb d" title="Dealer">D</span>', s.sb && '<span class="pb sb" title="Small blind">SB</span>', s.bb && '<span class="pb bb" title="Big blind">BB</span>'].filter(Boolean).join('');
}

function seatStatus(s, t) {
  if (s.out) return t.game.type === 'tournament' && s.place ? `Out · ${ordinal(s.place)}` : 'Sitting out';
  if (s.folded) return 'Folded';
  if (s.allin) return 'All-in';
  if (t.hand && !s.inHand) return 'Not in hand';
  return '';
}
const ordinal = (n) => { const x = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${x[(v - 20) % 10] || x[v] || x[0]}`; };

function renderTable() {
  const t = state.table;
  const h = t.hand;
  const me = t.seats.find((s) => s.pid === state.you);
  const toActName = h?.toAct ? t.seats.find((s) => s.pid === h.toAct)?.name : '';
  const myTurn = !!h && !!state.you && h.toAct === state.you && !!h.legal;
  const others = state.watching ? t.seats : t.seats.filter((s) => s.pid !== state.you);

  const potBlock = `<div class="pot" aria-live="off">
      <p class="pot-label">${h ? `Hand #${h.no} · ${STREET[h.street]}` : (t.handNo ? `Hand #${t.handNo} finished` : 'Waiting for the first hand')}</p>
      <p class="pot-amount"><span class="sr-only">Pot </span>${h ? fmt(h.pot) : '—'}</p>
      <p class="pot-sub">Blinds ${fmt(t.blinds.sb)} / ${fmt(t.blinds.bb)}${h && h.currentBet ? ` · Bet to match ${fmt(h.currentBet)}` : ''}</p>
      ${h?.last ? `<p class="last-act">${esc(describe(h.last))}</p>` : ''}
    </div>`;

  const result = !h && t.lastHand ? `<p class="result">${Object.entries(t.lastHand.won).map(([pid, amt]) => `${esc(t.seats.find((s) => s.pid === pid)?.name || 'Someone')} won ${fmt(amt)}`).join(' · ')}</p>` : '';

  return `
  <section class="topline glass" aria-label="Table info">
    <div class="tl-left"><p class="eyebrow">Room ${esc(t.room)}</p><p class="tl-game">${esc(t.game.name)}</p></div>
    ${statusLine()}
    <details class="menu">
      <summary class="btn icon" aria-label="Table menu"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg></summary>
      <div class="menu-pop glass">
        ${state.watching ? '<button type="button" id="m-seat" class="menu-item" data-action="pick">Take a seat</button>' : '<button type="button" id="m-change" class="menu-item" data-action="change">Change seat</button><button type="button" id="m-watch" class="menu-item" data-action="watch">Big-screen view</button>'}
        <button type="button" id="m-leave" class="menu-item" data-action="leave">Leave table</button>
      </div>
    </details>
  </section>

  ${state.error ? `<p class="error banner" role="alert">${esc(state.error)}</p>` : ''}

  <section class="table-view" aria-label="Table">
    ${potBlock}
    ${result}
  </section>

  ${me ? `<section class="me glass ${myTurn ? 'my-turn' : ''}" aria-labelledby="me-h">
    <div class="me-head">
      <div>
        <h2 id="me-h" class="me-name">${esc(me.name)} <span aria-hidden="true">${badges(me)}</span><span class="sr-only">${me.button ? ', dealer' : ''}${me.sb ? ', small blind' : ''}${me.bb ? ', big blind' : ''}</span></h2>
        <p class="me-sub">${me.bet ? `In this round: ${fmt(me.bet)}` : seatStatus(me, t) || (h ? 'In the hand' : 'Waiting for the next hand')}</p>
      </div>
      <p class="me-stack"><span class="label">Your chips</span>${fmt(me.stack)}</p>
    </div>
    ${renderActions(t, h, me, myTurn, toActName)}
  </section>` : ''}

  <section class="table-view" aria-label="Other players">
    <ul class="seats">${others.map((s) => `<li class="seat ${h?.toAct === s.pid ? 'turn' : ''} ${s.folded || s.out ? 'dim' : ''}" ${h?.toAct === s.pid ? 'aria-current="true"' : ''}>
      <p class="s-name">${esc(s.name)} <span aria-hidden="true">${badges(s)}</span></p>
      <p class="s-stack"><span class="sr-only">Stack </span>${fmt(s.stack)}</p>
      <p class="s-sub">${s.bet ? `<span class="bet">Bet ${fmt(s.bet)}</span>` : ''}${seatStatus(s, t) ? `<span class="tag">${seatStatus(s, t)}</span>` : ''}${h?.toAct === s.pid ? '<span class="tag turn-tag">Thinking…</span>' : ''}${s.claimed && !s.connected ? '<span class="tag">Phone away</span>' : ''}</p>
    </li>`).join('')}</ul>
  </section>

`;
}

function describe(a) {
  switch (a.type) {
    case 'sb': return `${a.name} posts small blind ${fmt(a.amount)}`;
    case 'bb': return `${a.name} posts big blind ${fmt(a.amount)}`;
    case 'fold': return `${a.name} folds`;
    case 'check': return `${a.name} checks`;
    case 'call': return `${a.name} calls ${fmt(a.amount)}${a.allin ? ' (all-in)' : ''}`;
    case 'bet': return `${a.name} bets ${fmt(a.to)}${a.allin ? ' (all-in)' : ''}`;
    case 'raise': return `${a.name} raises to ${fmt(a.to)}${a.allin ? ' (all-in)' : ''}`;
    default: return '';
  }
}

function renderActions(t, h, me, myTurn, toActName) {
  if (!h) return '<p class="wait">Waiting for the host to deal.</p>';
  if (h.street === 'showdown') return '<p class="wait">Showdown. Show your cards. The host will award the pot.</p>';
  if (!myTurn) return `<p class="wait">${toActName ? `Waiting for <strong>${esc(toActName)}</strong>…` : 'Waiting…'}</p>`;

  const L = h.legal;
  const key = `${h.id}:${h.street}:${h.currentBet}`;
  if (state.raise.key !== key) { state.raise = { key, value: L.minTo }; state.foldArmed = false; }
  const potTo = (f) => Math.max(L.minTo, Math.min(L.maxTo, h.currentBet + Math.round((L.pot + L.toCall) * f)));
  const v = Math.max(L.minTo, Math.min(L.maxTo, Number(state.raise.value) || L.minTo));
  const dis = state.sending ? 'disabled' : '';

  return `<div class="actions" role="group" aria-label="Your action">
    <p class="your-turn">Your turn</p>
    <div class="main-acts">
      <button type="button" id="b-fold" class="act fold ${state.foldArmed ? 'armed' : ''}" data-action="fold" ${dis}>${state.foldArmed ? 'Tap again to fold' : 'Fold'}</button>
      ${L.canCheck
        ? `<button type="button" id="b-check" class="act primary" data-action="check" ${dis}>Check</button>`
        : `<button type="button" id="b-call" class="act primary" data-action="call" ${dis}>Call ${fmt(L.callAmount)}${L.callIsAllIn ? '<small>All-in</small>' : ''}</button>`}
    </div>
    ${L.canRaise ? `<div class="raise">
      <label for="raise-range" class="raise-label">${L.isBet ? 'Bet' : 'Raise to'} <output id="raise-out" for="raise-range raise-num">${fmt(v)}</output></label>
      <div class="raise-controls">
        <button type="button" id="b-minus" class="step" data-action="step" data-dir="-1" aria-label="Decrease by one big blind">−</button>
        <input id="raise-range" type="range" min="${L.minTo}" max="${L.maxTo}" step="1" value="${v}" data-input="raise" aria-valuetext="${fmt(v)} chips">
        <button type="button" id="b-plus" class="step" data-action="step" data-dir="1" aria-label="Increase by one big blind">+</button>
      </div>
      <div class="presets">
        ${[['Min', L.minTo], ['½ Pot', potTo(0.5)], ['Pot', potTo(1)], ['All-in', L.maxTo]].map(([lbl, val], i) => `<button type="button" id="b-p-${i}" class="preset" data-action="preset" data-value="${val}">${lbl}</button>`).join('')}
      </div>
      <div class="raise-confirm">
        <label for="raise-num" class="sr-only">Exact amount</label>
        <input id="raise-num" type="number" inputmode="numeric" min="${L.minTo}" max="${L.maxTo}" step="1" value="${v}" data-input="raise">
        <button type="button" id="b-raise" class="act raise-btn" data-action="raise" ${dis}>${v >= L.maxTo ? 'All-in' : (L.isBet ? 'Bet' : 'Raise')} ${fmt(v)}</button>
      </div>
    </div>` : ''}
  </div>`;
}

/* ------------------------------------------------------------- events */
function act(type, to) {
  const h = state.table?.hand;
  if (!h || state.sending) return;
  if (send({ t: 'act', handId: h.id, action: { type, to } })) {
    state.sending = true;
    render();
  }
}

function setRaise(val) {
  const L = state.table?.hand?.legal;
  if (!L) return;
  const v = Math.max(L.minTo, Math.min(L.maxTo, Math.round(Number(val) || 0)));
  state.raise.value = v;
  const range = $('#raise-range'); const num = $('#raise-num'); const out = $('#raise-out'); const b = $('#b-raise');
  if (range && document.activeElement !== range) range.value = v;
  if (range) range.setAttribute('aria-valuetext', `${fmt(v)} chips`);
  if (num && document.activeElement !== num) num.value = v;
  if (out) out.textContent = fmt(v);
  if (b) b.textContent = `${v >= L.maxTo ? 'All-in' : (L.isBet ? 'Bet' : 'Raise')} ${fmt(v)}`;
}

const ACTIONS = {
  leave,
  claim: (el) => {
    if (el.getAttribute('aria-disabled') === 'true') {
      state.error = 'That seat is taken. Ask the host to free it if it’s yours.';
      render();
      return;
    }
    send({ t: 'claim', pid: el.dataset.pid });
  },
  watch: () => { state.watching = true; if (state.you) send({ t: 'release' }); state.you = null; render(); },
  pick: () => { state.watching = false; render(); },
  change: () => { send({ t: 'release' }); state.you = null; render(); },
  fold: () => {
    const L = state.table?.hand?.legal;
    if (L?.canCheck && !state.foldArmed) {
      state.foldArmed = true;
      announce('You can check for free. Tap fold again to fold anyway.', true);
      render();
      setTimeout(() => { if (state.foldArmed) { state.foldArmed = false; render(); } }, 3500);
      return;
    }
    state.foldArmed = false;
    act('fold');
  },
  check: () => act('check'),
  call: () => act('call'),
  step: (el) => {
    const bb = state.table.blinds.bb;
    setRaise(Number(state.raise.value) + Number(el.dataset.dir) * bb);
  },
  preset: (el) => setRaise(el.dataset.value),
  raise: () => {
    const L = state.table?.hand?.legal;
    const v = Number(state.raise.value);
    act(v >= L.maxTo ? 'allin' : 'raise', v);
  },
};

function initEvents() {
  const root = $('#app');
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    el.closest('details.menu')?.removeAttribute('open');
    ACTIONS[el.dataset.action]?.(el);
  });
  root.addEventListener('input', (e) => {
    if (e.target.dataset.input === 'raise') setRaise(e.target.value);
    if (e.target.id === 'room-input') e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
  root.addEventListener('submit', (e) => {
    if (e.target.id !== 'join-form') return;
    e.preventDefault();
    const code = $('#room-input').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(code)) {
      state.error = 'Enter the room code from the host’s screen (letters and numbers).';
      render();
      $('#room-input').focus();
      return;
    }
    join(code);
  });
  document.addEventListener('click', (e) => {
    document.querySelectorAll('details.menu[open]').forEach((d) => { if (!d.contains(e.target)) d.removeAttribute('open'); });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const open = document.querySelector('details.menu[open]');
      if (open) { open.removeAttribute('open'); open.querySelector('summary').focus(); }
    }
  });
}

function boot() {
  initTheme();
  initEvents();
  const room = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (room) join(room); else render();
}

boot();
