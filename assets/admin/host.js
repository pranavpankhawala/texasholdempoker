/**
 * Chip Table host screen (admin side). Owns the authoritative table state,
 * saves it locally and pushes updates to players' phones.
 */
import * as store from './store.js';
import * as D from './domain.js';
import * as P from './poker.js';
import { createHost } from './net-host.js';

const state = {
  data: store.load(),
  net: null,
  status: { state: 'connecting' },
  undo: [],
  winners: {}, // potIndex -> Set(pid)
  raiseDraft: { key: '', value: '' },
  copied: false,
};

const $ = (s, r = document) => r.querySelector(s);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const fmt = D.fmt;
const nameOf = (pid) => D.playerName(state.data, pid);
const game = () => D.liveGame(state.data);
const table = () => game()?.table || null;

function btn(action, label, { pid = '', cls = 'btn ghost', aria = '', disabled = false, attrs = '' } = {}) {
  return `<button type="button" id="h-${action}-${esc(pid)}" class="${cls}" data-action="${action}" ${pid !== '' ? `data-pid="${esc(pid)}"` : ''} ${aria ? `aria-label="${esc(aria)}"` : ''} ${disabled ? 'disabled' : ''} ${attrs}>${label}</button>`;
}

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

/* ------------------------------------------------------------------ theme */
function effectiveTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function syncThemeButton() {
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
    syncThemeButton();
  });
  syncThemeButton();
}

/* ------------------------------------------------------------------ dialog */
function confirmBox(title, html, { confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = $('#dlg');
    const opener = document.activeElement;
    $('#dlg-title').textContent = title;
    $('#dlg-body').innerHTML = html;
    const ok = $('#dlg-ok');
    ok.textContent = confirmLabel;
    ok.className = `btn ${danger ? 'danger' : 'primary'}`;
    let result = false;
    const onSubmit = (e) => { e.preventDefault(); result = true; dlg.close(); };
    $('#dlg-form').addEventListener('submit', onSubmit, { once: true });
    dlg.addEventListener('close', () => {
      $('#dlg-form').removeEventListener('submit', onSubmit);
      resolve(result);
      setTimeout(() => (opener && document.contains(opener) ? opener : (opener?.id && document.getElementById(opener.id)) || $('#host-root'))?.focus?.(), 0);
    }, { once: true });
    dlg.showModal();
    ok.focus();
  });
}

/* ------------------------------------------------------------------ state changes */
function snapshot() {
  const g = game();
  state.undo.push(JSON.stringify({ entries: g.entries, dealer: g.dealer, table: { ...g.table, claims: undefined } }));
  if (state.undo.length > 40) state.undo.shift();
}

function persist() {
  if (!store.save(state.data)) toast('Could not save. Browser storage may be full.', 'error');
}

/** Run a change against the table with undo, save, broadcast and render. */
function mutate(fn, { undoable = true } = {}) {
  const g = game();
  if (!g?.table) return false;
  if (undoable) snapshot();
  try {
    fn(g, g.table);
  } catch (e) {
    if (undoable) state.undo.pop();
    toast(e.message, 'error');
    return false;
  }
  afterChange();
  return true;
}

function afterChange() {
  persist();
  broadcast();
  render();
}

function undo() {
  const g = game();
  const snap = state.undo.pop();
  if (!g || !snap) return;
  const s = JSON.parse(snap);
  const claims = g.table.claims;
  g.entries = s.entries;
  g.dealer = s.dealer;
  g.table = { ...s.table, claims };
  state.winners = {};
  afterChange();
  toast('Undone.');
}

/* ------------------------------------------------------------------ networking */
function seatOf(clientId) {
  const t = table();
  if (!t) return null;
  return Object.keys(t.claims).find((pid) => t.claims[pid] === clientId) || null;
}

function publicState() {
  const g = game();
  return P.publicState(g, g.table, nameOf, state.net ? state.net.connectedIds() : new Set());
}

function broadcast() {
  if (!state.net || !table()) return;
  const s = publicState();
  state.net.broadcast((clientId) => ({ t: 'state', state: s, you: seatOf(clientId) }));
}

function onMessage(clientId, msg) {
  const g = game();
  const t = g?.table;
  if (!t) { state.net.send(clientId, { t: 'error', msg: 'The table is closed.' }); return; }
  const reply = (m) => state.net.send(clientId, m);
  switch (msg.t) {
    case 'hello':
      reply({ t: 'state', state: publicState(), you: seatOf(clientId) });
      break;
    case 'claim': {
      const pid = String(msg.pid || '');
      if (!g.entries.some((e) => e.playerId === pid)) { reply({ t: 'error', msg: 'That seat doesn’t exist.' }); return; }
      if (t.claims[pid] && t.claims[pid] !== clientId) { reply({ t: 'error', msg: `${nameOf(pid)}’s seat is already taken. Ask the host to free it.` }); return; }
      for (const k of Object.keys(t.claims)) if (t.claims[k] === clientId) delete t.claims[k];
      t.claims[pid] = clientId;
      announce(`${nameOf(pid)} joined from their phone.`);
      afterChange();
      break;
    }
    case 'release':
      for (const k of Object.keys(t.claims)) if (t.claims[k] === clientId) delete t.claims[k];
      afterChange();
      break;
    case 'act': {
      const pid = seatOf(clientId);
      if (!pid) { reply({ t: 'error', msg: 'Pick your seat first.' }); return; }
      if (!t.hand || t.hand.id !== msg.handId) { reply({ t: 'error', msg: 'That hand is over.' }); return; }
      if (t.hand.toAct !== pid) { reply({ t: 'error', msg: 'It’s not your turn.' }); return; }
      const action = { type: String(msg.action?.type || ''), to: Number(msg.action?.to) };
      snapshot();
      try {
        P.act(g, t, pid, action);
      } catch (e) {
        state.undo.pop();
        reply({ t: 'error', msg: e.message });
        return;
      }
      afterHandStep();
      break;
    }
    default:
      break;
  }
}

function afterHandStep() {
  const t = table();
  state.winners = {};
  afterChange();
  if (t.hand?.toAct) announce(`${nameOf(t.hand.toAct)} to act.`);
  else if (t.hand?.street === 'showdown') announce('Showdown. Choose who won the pot.');
  else if (t.lastHand) announce(summary(t.lastHand));
}

function summary(lh) {
  const parts = Object.entries(lh.won).map(([pid, amt]) => `${nameOf(pid)} won ${fmt(amt)}`);
  return `Hand ${lh.no}: ${parts.join(', ') || 'no winner'}.`;
}

/* ------------------------------------------------------------------ rendering */
function joinUrl(room) {
  const u = new URL('play.html', location.href);
  u.search = '';
  u.searchParams.set('room', room);
  const peer = new URLSearchParams(location.search).get('peer');
  if (peer) u.searchParams.set('peer', peer);
  return u.toString();
}

function qrSvg(text) {
  if (typeof window.qrcode !== 'function') return '<p class="muted small">QR code unavailable.</p>';
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

const STATUS_TEXT = {
  connecting: 'Opening room…',
  online: 'Room open',
  reconnecting: 'Reconnecting…',
  error: 'Offline',
};

function render() {
  const root = $('#host-root');
  const focusId = document.activeElement?.id;

  if (!store.getPinRecord() || !store.isUnlocked()) {
    root.innerHTML = `<section class="card glass empty"><h1 class="h2">Admin is locked</h1>
      <p class="muted">Unlock the admin console with your PIN to run the Chip Table.</p>
      <div class="actions center"><a class="btn primary" href="admin.html?return=host">Unlock admin</a></div></section>`;
    return;
  }
  const g = game();
  if (!g || !g.table) {
    root.innerHTML = `<section class="card glass empty"><h1 class="h2">No Chip Table running</h1>
      <p class="muted">Start a game in Admin → Table and tick <strong>Use Chip Table</strong>, or open the Chip Table from a live game.</p>
      <div class="actions center"><a class="btn primary" href="admin.html">Go to admin</a></div></section>`;
    return;
  }
  const t = g.table;
  P.syncStacks(g, t);
  const h = t.hand;
  const connected = state.net ? state.net.connectedIds() : new Set();
  const url = joinUrl(t.room);
  const claimedCount = Object.keys(t.claims).length;
  const onlineCount = Object.values(t.claims).filter((c) => connected.has(c)).length;
  const audit = P.chipAudit(g, t);

  root.innerHTML = `
  <h1 class="sr-only">Chip Table host: ${esc(g.name)}</h1>
  <div class="host-grid">
    <div class="col-side">
    <section class="card glass control-card" aria-labelledby="ctl-h">
      ${renderControls(g, t, h, connected)}
    </section>

    <section class="card glass room-card" aria-labelledby="room-h">
      <div class="card-head">
        <h2 id="room-h">Join the table</h2>
        <p class="muted small">Players scan the code or open the link, then pick their seat.</p>
      </div>
      <div class="room-body">
        <div class="qr" role="img" aria-label="QR code that opens the join link">${qrSvg(url)}</div>
        <div class="room-info">
          <p class="room-label">Room code</p>
          <p class="room-code" aria-label="Room code ${esc(t.room.split('').join(' '))}">${esc(t.room)}</p>
          <p class="net-status" data-state="${esc(state.status.state)}"><span class="dot" aria-hidden="true"></span>${esc(STATUS_TEXT[state.status.state] || state.status.state)}</p>
          ${state.status.detail ? `<p class="muted small">${esc(state.status.detail)}</p>` : ''}
          <p class="small"><strong>${onlineCount}</strong> of ${g.entries.length} phones connected${claimedCount > onlineCount ? ` · ${claimedCount - onlineCount} away` : ''}</p>
        </div>
      </div>
      <div class="join-link">
        <label for="join-url" class="sr-only">Join link</label>
        <input id="join-url" readonly value="${esc(url)}">
        ${btn('copy', state.copied ? 'Copied' : 'Copy link', { cls: 'btn ghost' })}
      </div>
    </section>

    </div>
    <div class="col-main">
    <section class="card glass seats-card" aria-labelledby="seats-h">
      <div class="card-head row">
        <h2 id="seats-h">${esc(g.name)} <span class="badge">${g.type === 'cash' ? 'Cash' : 'Tournament'}</span></h2>
        <p class="muted small">Blinds ${fmt(t.sb)} / ${fmt(t.bb)} · ${audit.ok ? `${fmt(audit.expected)} chips in play` : `<span class="danger-text">Chip check off by ${D.signed(audit.actual - audit.expected)}</span>`}</p>
      </div>
      <ul class="seat-grid">${g.entries.map((e, i) => renderSeat(g, t, e, i, connected)).join('')}</ul>
    </section>

    <section class="card glass log-card" aria-labelledby="log-h">
      <div class="card-head"><h2 id="log-h">${h ? `Hand #${h.no}` : 'Last hand'}</h2></div>
      ${renderLog(t)}
    </section>
    </div>
  </div>`;

  if (focusId && !$('#dlg').open) {
    const el = document.getElementById(focusId);
    if (el && el !== document.activeElement) el.focus({ preventScroll: true });
  }
}

function renderSeat(g, t, e, i, connected) {
  const pid = e.playerId;
  const h = t.hand;
  const inHand = !!h && h.order.includes(pid);
  const turn = h?.toAct === pid;
  const claim = t.claims[pid];
  const online = claim && connected.has(claim);
  const stack = t.stacks[pid] || 0;
  const badges = [
    (h ? h.button : g.dealer.button) === pid ? '<span class="pos-badge d" title="Dealer">D</span>' : '',
    inHand && h.sbP === pid ? '<span class="pos-badge sb" title="Small blind">SB</span>' : '',
    inHand && h.bbP === pid ? '<span class="pos-badge bb" title="Big blind">BB</span>' : '',
  ].join('');
  let status = '';
  if (!e.active) status = g.type === 'tournament' ? `Out · ${D.ordinal(e.place)}` : 'Sitting out';
  else if (inHand && h.folded[pid]) status = 'Folded';
  else if (inHand && h.allin[pid]) status = 'All-in';
  else if (!inHand && stack === 0) status = 'No chips';
  else if (h && !inHand) status = 'Not in hand';

  const device = online
    ? '<span class="device on"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>Phone connected</span>'
    : claim
      ? '<span class="device away"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M4 4l16 16"/></svg>Phone away</span>'
      : '<span class="device none">No phone</span>';

  const between = !h;
  const actions = [
    claim ? btn('free', 'Free seat', { pid, aria: `Free ${nameOf(pid)}’s seat so another phone can take it` }) : '',
    between && (g.type === 'cash' || !e.active || stack === 0) ? btn('rebuy', 'Rebuy', { pid, aria: `Rebuy for ${nameOf(pid)}` }) : '',
    between && e.active ? btn('addon', 'Add-on', { pid, aria: `Add-on for ${nameOf(pid)}` }) : '',
    between && g.type === 'cash' ? btn(e.active ? 'sitout' : 'sitin', e.active ? 'Sit out' : 'Sit in', { pid }) : '',
  ].filter(Boolean).join('');

  return `<li class="seat-card ${turn ? 'turn' : ''} ${(inHand && h.folded[pid]) || !e.active ? 'dim' : ''}" ${turn ? 'aria-current="true"' : ''}>
    <div class="seat-top">
      <span class="seat-no" aria-hidden="true">${i + 1}</span>
      <p class="seat-name">${esc(nameOf(pid))} ${badges}</p>
      ${turn ? '<span class="turn-pill">To act</span>' : ''}
    </div>
    <p class="seat-stack"><span class="sr-only">Stack </span>${fmt(stack)}</p>
    <p class="seat-sub">${inHand && h.bets[pid] ? `<span class="bet-chip">Bet ${fmt(h.bets[pid])}</span>` : ''}${status ? `<span class="seat-status">${status}</span>` : ''}</p>
    <p class="seat-device">${device}</p>
    ${actions ? `<div class="seat-actions">${actions}</div>` : ''}
  </li>`;
}

function renderControls(g, t, h, connected) {
  if (!h) {
    const elig = P.eligibleSeats(g, t);
    const lh = t.lastHand;
    return `<div class="card-head"><h2 id="ctl-h">Between hands</h2>
        ${lh ? `<p class="last-result">${esc(summary(lh))}${lh.busted.length ? ` ${esc(lh.busted.map(nameOf).join(', '))} ${lh.busted.length > 1 ? 'are' : 'is'} out of chips.` : ''}</p>` : '<p class="muted small">Deal the first hand when everyone is seated.</p>'}
      </div>
      ${btn('deal', `Deal hand #${t.handNo + 1}`, { cls: 'btn primary big block', disabled: elig.length < 2 })}
      ${elig.length < 2 ? '<p class="hint">At least two players need chips. Use Rebuy, or finish the game.</p>' : ''}
      <form class="inline-form blinds-form" data-form="blinds" novalidate>
        <div class="field"><label for="sb">Small blind</label><input id="sb" name="sb" type="number" inputmode="numeric" min="1" step="1" value="${t.sb}"></div>
        <div class="field"><label for="bb">Big blind</label><input id="bb" name="bb" type="number" inputmode="numeric" min="1" step="1" value="${t.bb}"></div>
        <button type="submit" class="btn ghost">Update blinds</button>
      </form>
      <div class="actions split">
        ${btn('undo', 'Undo last hand', { disabled: !state.undo.length })}
        <span class="spacer"></span>
        ${btn('stop', 'Stop Chip Table')}
        ${btn('finish', 'Finish game', { cls: 'btn primary' })}
      </div>`;
  }

  if (h.street === 'showdown') {
    const pending = h.pots.map((pot, i) => ({ pot, i })).filter(({ pot }) => !pot.winners);
    return `<div class="card-head"><h2 id="ctl-h">Showdown</h2><p class="muted small">Players show their cards. Tap who won each pot (tap more than one to split).</p></div>
      ${pending.map(({ pot, i }) => {
        const sel = state.winners[i] || new Set();
        return `<fieldset class="pot-pick">
          <legend>${i === 0 ? 'Main pot' : `Side pot ${i}`} · <strong>${fmt(pot.amount)}</strong></legend>
          <div class="pick-row">${pot.eligible.map((pid) => `<button type="button" id="h-pick-${i}-${esc(pid)}" class="pick ${sel.has(pid) ? 'on' : ''}" data-action="pick" data-pot="${i}" data-pid="${esc(pid)}" aria-pressed="${sel.has(pid)}">${esc(nameOf(pid))}</button>`).join('')}</div>
          ${btn('award', sel.size > 1 ? `Split between ${sel.size}` : 'Award pot', { pid: String(i), cls: 'btn primary', disabled: !sel.size })}
        </fieldset>`;
      }).join('')}
      <div class="actions split">${btn('undo', 'Undo', { disabled: !state.undo.length })}<span class="spacer"></span>${btn('abort', 'Cancel hand', { cls: 'btn ghost danger-text' })}</div>`;
  }

  const pid = h.toAct;
  const L = P.legal(t, pid);
  const online = t.claims[pid] && connected.has(t.claims[pid]);
  const key = `${h.id}:${h.street}:${pid}:${h.currentBet}`;
  if (state.raiseDraft.key !== key) state.raiseDraft = { key, value: String(L.minTo) };
  const potRaise = (frac) => Math.max(L.minTo, Math.min(L.maxTo, h.currentBet + Math.round((L.pot + L.toCall) * frac)));
  return `<div class="card-head">
      <p class="eyebrow">${esc(P.STREET_LABEL[h.street])} · Pot ${fmt(L.pot)}</p>
      <h2 id="ctl-h">${esc(nameOf(pid))} to act</h2>
      <p class="muted small">${online ? 'They can act on their phone, or you can act for them here.' : 'Their phone isn’t connected. Act for them here.'}</p>
    </div>
    <div class="act-row">
      ${btn('fold', 'Fold', { cls: 'btn ghost danger-text' })}
      ${L.canCheck ? btn('check', 'Check', { cls: 'btn ghost' }) : btn('call', `Call ${fmt(L.callAmount)}${L.callIsAllIn ? ' (all-in)' : ''}`, { cls: 'btn ghost' })}
    </div>
    ${L.canRaise ? `<form class="raise-form" data-form="raise" novalidate>
      <label for="raise-to">${L.isBet ? 'Bet' : 'Raise to'} <span class="muted">(${fmt(L.minTo)}–${fmt(L.maxTo)})</span></label>
      <div class="raise-row">
        <input id="raise-to" name="to" type="number" inputmode="numeric" min="${L.minTo}" max="${L.maxTo}" step="1" value="${esc(state.raiseDraft.value)}" data-input="raise">
        <button type="submit" class="btn primary">${L.isBet ? 'Bet' : 'Raise'}</button>
      </div>
      <div class="quick">
        ${[['Min', L.minTo], ['½ pot', potRaise(0.5)], ['Pot', potRaise(1)], ['All-in', L.maxTo]].map(([lbl, v], i) => `<button type="button" id="h-quick-${i}" class="chip-btn" data-action="quick" data-value="${v}">${lbl}<span>${fmt(v)}</span></button>`).join('')}
      </div>
    </form>` : ''}
    <div class="actions split">${btn('undo', 'Undo', { disabled: !state.undo.length })}<span class="spacer"></span>${btn('abort', 'Cancel hand', { cls: 'btn ghost danger-text' })}</div>`;
}

function renderLog(t) {
  const h = t.hand;
  if (h) {
    const items = h.actions.slice(-14).reverse();
    return `<ol class="log" reversed>${items.map((a) => `<li><span class="log-street">${esc(P.STREET_LABEL[a.street] || '')}</span>${esc(P.describeAction(a, nameOf))}</li>`).join('')}</ol>`;
  }
  if (t.lastHand) {
    const lh = t.lastHand;
    return `<ul class="log">${lh.pots.map((p, i) => `<li><span class="log-street">${i === 0 ? 'Main pot' : `Side pot ${i}`}</span>${fmt(p.amount)} → ${esc((p.winners || []).map(nameOf).join(' & '))}</li>`).join('')}</ul>`;
  }
  return '<p class="muted small">No hands yet.</p>';
}

/* ------------------------------------------------------------------ actions */
async function finishGame() {
  const g = game();
  if (g.table.hand) { toast('Finish or cancel the current hand first.', 'error'); return; }
  const { errors, warnings } = D.closeCheck(g);
  if (errors.length) { toast(errors[0], 'error'); return; }
  const preview = D.computeResults(g, state.data.settings.points);
  const rows = preview.map((r) => `<tr><td>${D.ordinal(r.place)}</td><th scope="row">${esc(nameOf(r.playerId))}</th><td class="num">${fmt(r.points)}</td><td class="num">${r.net == null ? fmt(r.chipsOut) : D.signed(r.net)}</td></tr>`).join('');
  const ok = await confirmBox(`Finish ${g.name}?`, `${warnings.map((w) => `<p class="callout warn">${esc(w)}</p>`).join('')}
    <div class="table-wrap"><table class="data"><thead><tr><th scope="col">Place</th><th scope="col">Player</th><th scope="col" class="num">Points</th><th scope="col" class="num">${g.type === 'cash' ? 'Net' : 'Chips'}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted small">Results are saved to the standings and the room closes.</p>`, { confirmLabel: 'Finish & save' });
  if (!ok) return;
  broadcastClosed('The host finished the game. Thanks for playing!');
  g.table = null;
  D.closeGame(state.data, g);
  persist();
  location.href = 'admin.html';
}

function broadcastClosed(msg) {
  state.net?.broadcast(() => ({ t: 'closed', msg }));
}

const ACTIONS = {
  copy: async () => {
    const input = $('#join-url');
    try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand?.('copy'); }
    state.copied = true; render();
    setTimeout(() => { state.copied = false; render(); }, 2000);
    announce('Join link copied.');
  },
  deal: () => { if (mutate((g, t) => P.startHand(g, t))) afterHandStep(); },
  fold: () => actFor('fold'),
  check: () => actFor('check'),
  call: () => actFor('call'),
  quick: (_, el) => {
    state.raiseDraft.value = el.dataset.value;
    const input = $('#raise-to');
    if (input) { input.value = el.dataset.value; input.focus(); }
  },
  pick: (pid, el) => {
    const i = Number(el.dataset.pot);
    const set = state.winners[i] || new Set();
    if (set.has(pid)) set.delete(pid); else set.add(pid);
    state.winners[i] = set;
    render();
  },
  award: (potIdx) => {
    const i = Number(potIdx);
    const winners = [...(state.winners[i] || [])];
    if (mutate((g, t) => P.award(g, t, i, winners))) { delete state.winners[i]; afterHandStep(); }
  },
  undo,
  abort: async () => {
    if (!(await confirmBox('Cancel this hand?', '<p>Everyone gets back the chips they put in this hand, and the button returns to where it was.</p>', { confirmLabel: 'Cancel hand', danger: true }))) return;
    mutate((g, t) => P.abortHand(g, t));
    toast('Hand cancelled. Chips returned.');
  },
  free: (pid) => mutate((g, t) => { delete t.claims[pid]; }, { undoable: false }),
  rebuy: (pid) => topUp(pid, 'rebuy'),
  addon: (pid) => topUp(pid, 'addon'),
  sitout: (pid) => mutate((g) => { D.setLeft(g, pid, true); }),
  sitin: (pid) => mutate((g) => { D.setLeft(g, pid, false); }),
  stop: async () => {
    if (game().table.hand) { toast('Finish or cancel the current hand first.', 'error'); return; }
    if (!(await confirmBox('Stop the Chip Table?', '<p>Phones are disconnected. The game stays live in Admin with everyone’s current chip counts, so you can keep tracking it by hand.</p>', { confirmLabel: 'Stop Chip Table' }))) return;
    broadcastClosed('The host closed the Chip Table.');
    game().table = null;
    persist();
    location.href = 'admin.html';
  },
  finish: finishGame,
};

function actFor(type, to) {
  const t = table();
  const pid = t?.hand?.toAct;
  if (!pid) return;
  if (mutate((g, tt) => P.act(g, tt, pid, { type, to }))) afterHandStep();
}

async function topUp(pid, kind) {
  const g = game();
  const amount = await askAmount(`${kind === 'rebuy' ? 'Rebuy' : 'Add-on'} for ${nameOf(pid)}`, g.startingStack);
  if (!amount) return;
  if (mutate((gg, t) => P.topUp(gg, t, pid, kind, amount))) toast(`${nameOf(pid)} +${fmt(amount)} chips.`, 'success');
}

function askAmount(title, def) {
  return new Promise((resolve) => {
    const dlg = $('#dlg');
    $('#dlg-title').textContent = title;
    $('#dlg-body').innerHTML = `<div class="field"><label for="amt">Chips</label><input id="amt" name="amt" type="number" inputmode="numeric" min="1" step="1" value="${def}"></div>`;
    const ok = $('#dlg-ok');
    ok.textContent = 'Add chips';
    ok.className = 'btn primary';
    let value = 0;
    const onSubmit = (e) => {
      e.preventDefault();
      const v = Math.floor(Number($('#amt').value));
      if (!(v > 0)) { $('#amt').focus(); return; }
      value = v;
      dlg.close();
    };
    $('#dlg-form').addEventListener('submit', onSubmit);
    dlg.addEventListener('close', () => { $('#dlg-form').removeEventListener('submit', onSubmit); resolve(value); }, { once: true });
    dlg.showModal();
    $('#amt').select();
  });
}

function initEvents() {
  const root = $('#host-root');
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    ACTIONS[el.dataset.action]?.(el.dataset.pid, el);
  });
  root.addEventListener('input', (e) => {
    if (e.target.dataset.input === 'raise') state.raiseDraft.value = e.target.value;
  });
  root.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    if (form.dataset.form === 'raise') {
      const to = Math.floor(Number(form.elements.to.value));
      const L = P.legal(table(), table().hand.toAct);
      actFor(to >= L.maxTo ? 'allin' : 'raise', to);
    } else if (form.dataset.form === 'blinds') {
      const sb = Math.floor(Number(form.elements.sb.value));
      const bb = Math.floor(Number(form.elements.bb.value));
      if (!(sb > 0 && bb >= sb)) { toast('Big blind must be at least the small blind, and both above 0.', 'error'); return; }
      if (mutate((g, t) => { t.sb = sb; t.bb = bb; })) toast(`Blinds now ${fmt(sb)} / ${fmt(bb)}.`, 'success');
    }
  });
  $('#dlg-cancel').addEventListener('click', () => $('#dlg').close());
  $('#dlg-x').addEventListener('click', () => $('#dlg').close());

  // Another tab (admin) changed data: reload but keep this page authoritative for the live hand.
  window.addEventListener('storage', (e) => {
    if (e.key !== store.DATA_KEY) return;
    const fresh = store.load();
    const mine = game();
    const theirs = fresh.games.find((x) => x.id === mine?.id);
    if (mine?.table && theirs) theirs.table = { ...(theirs.table || {}), ...mine.table };
    state.data = fresh;
    broadcast();
    render();
  });
  window.addEventListener('beforeunload', () => state.net?.destroy());
}

function boot() {
  initTheme();
  initEvents();
  render();
  const t = table();
  if (t && store.isUnlocked()) {
    state.net = createHost({
      room: t.room,
      onMessage,
      onStatus: (s) => { state.status = s; render(); },
      onPeers: () => { broadcast(); render(); },
    });
  }
}

boot();
