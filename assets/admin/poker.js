/**
 * Chip Table betting engine (No-Limit Hold'em chip handling only — the cards are real).
 * Pure functions over the admin game object; the host page is the single source of truth.
 *
 * game.table = {
 *   room, sb, bb, stacks: {pid: chips}, claims: {pid: clientId},
 *   handNo, hand: Hand|null, lastHand: Summary|null, log: string[]
 * }
 */
import * as D from './domain.js';

const STREETS = ['preflop', 'flop', 'turn', 'river'];
export const STREET_LABEL = { preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' };
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRoomCode() {
  const bytes = new Uint8Array(6);
  (globalThis.crypto || { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
  return [...bytes].map((b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
}

export function createTable(game, { sb, bb }) {
  const table = { room: makeRoomCode(), sb, bb, stacks: {}, claims: {}, handNo: 0, hand: null, lastHand: null, log: [] };
  syncStacks(game, table);
  return table;
}

/** Make sure every seat has a stack (players added after the table opened). */
export function syncStacks(game, table) {
  for (const e of game.entries) {
    if (table.stacks[e.playerId] == null) {
      table.stacks[e.playerId] = !e.active && game.type === 'tournament' ? 0 : (e.finalChips ?? D.entryChipsIn(e));
    }
  }
  for (const pid of Object.keys(table.stacks)) {
    if (!game.entries.some((e) => e.playerId === pid)) { delete table.stacks[pid]; delete table.claims[pid]; }
  }
}

const entry = (game, pid) => game.entries.find((e) => e.playerId === pid);
const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

export function eligibleSeats(game, table) {
  return game.entries.filter((e) => e.active && (table.stacks[e.playerId] || 0) > 0).map((e) => e.playerId);
}

/** Next seat clockwise from `fromPid` (by seat order) that is in `set`. */
function nextIn(game, fromPid, set) {
  const seats = game.entries.map((e) => e.playerId);
  const start = seats.indexOf(fromPid);
  for (let s = 1; s <= seats.length; s += 1) {
    const pid = seats[(Math.max(start, 0) + s) % seats.length];
    if (set.includes(pid)) return pid;
  }
  return null;
}

/** Total chips that should exist at the table (for a sanity check). */
export function chipAudit(game, table) {
  const expected = game.entries.reduce((s, e) => s + D.entryChipsIn(e), 0);
  const actual = sum(table.stacks) + (table.hand ? sum(table.hand.committed) : 0);
  return { expected, actual, ok: expected === actual };
}

/* ---------------------------------------------------------------- hand flow */

export function startHand(game, table) {
  if (table.hand) throw new Error('A hand is already in progress.');
  syncStacks(game, table);
  const elig = eligibleSeats(game, table);
  if (elig.length < 2) throw new Error('At least two players with chips are needed to deal.');

  let button = game.dealer.button;
  if (table.handNo > 0 || !elig.includes(button)) {
    button = table.handNo > 0 ? nextIn(game, button, elig) : (elig.includes(button) ? button : nextIn(game, button, elig));
  }
  const prevButton = game.dealer.button;
  game.dealer.history.push(prevButton);
  if (game.dealer.history.length > 100) game.dealer.history.shift();
  game.dealer.button = button;
  game.dealer.hands += 1;

  const order = game.entries.map((e) => e.playerId).filter((pid) => elig.includes(pid));
  const headsUp = order.length === 2;
  const sbP = headsUp ? button : nextIn(game, button, order);
  const bbP = nextIn(game, sbP, order);

  table.handNo += 1;
  const h = {
    id: D.uid(),
    no: table.handNo,
    street: 'preflop',
    order,
    button,
    prevButton,
    sbP,
    bbP,
    startStacks: Object.fromEntries(order.map((p) => [p, table.stacks[p]])),
    bets: Object.fromEntries(order.map((p) => [p, 0])),
    committed: Object.fromEntries(order.map((p) => [p, 0])),
    folded: {},
    allin: {},
    acted: {},
    currentBet: table.bb,
    minRaise: table.bb,
    toAct: null,
    pots: null,
    actions: [],
  };
  table.hand = h;
  put(table, h, sbP, Math.min(table.sb, table.stacks[sbP]));
  put(table, h, bbP, Math.min(table.bb, table.stacks[bbP]));
  h.actions.push({ pid: sbP, type: 'sb', amount: h.bets[sbP], street: 'preflop' });
  h.actions.push({ pid: bbP, type: 'bb', amount: h.bets[bbP], street: 'preflop' });
  h.toAct = nextToAct(game, h, bbP);
  if (!h.toAct) endRound(game, table);
  return h;
}

function put(table, h, pid, amount) {
  const a = Math.max(0, Math.min(amount, table.stacks[pid]));
  table.stacks[pid] -= a;
  h.bets[pid] += a;
  h.committed[pid] += a;
  if (table.stacks[pid] === 0) h.allin[pid] = true;
  return a;
}

const canStillAct = (h, p) => !h.folded[p] && !h.allin[p];
const needsAction = (h, p) => canStillAct(h, p) && (!h.acted[p] || h.bets[p] < h.currentBet);

function nextToAct(game, h, fromPid) {
  const set = h.order.filter((p) => needsAction(h, p));
  if (!set.length) return null;
  return nextIn(game, fromPid, set);
}

/** What the player to act may do. Amounts for raises are "raise to" totals for this street. */
export function legal(table, pid) {
  const h = table.hand;
  const stack = table.stacks[pid] || 0;
  const toCall = Math.max(0, h.currentBet - h.bets[pid]);
  const othersCanAct = h.order.some((p) => p !== pid && canStillAct(h, p));
  const maxTo = h.bets[pid] + stack;
  const canRaise = stack > toCall && !h.acted[pid] && othersCanAct;
  return {
    toCall,
    callAmount: Math.min(toCall, stack),
    callIsAllIn: toCall >= stack && toCall > 0,
    canCheck: toCall === 0,
    canRaise,
    isBet: h.currentBet === 0,
    minTo: Math.min(h.currentBet + h.minRaise, maxTo),
    maxTo,
    stack,
    bet: h.bets[pid],
    pot: sum(h.committed),
  };
}

/**
 * Apply an action from the player whose turn it is.
 * @param {{type:'fold'|'check'|'call'|'raise'|'allin', to?:number}} action
 */
export function act(game, table, pid, action) {
  const h = table.hand;
  if (!h || h.street === 'showdown') throw new Error('No betting round in progress.');
  if (h.toAct !== pid) throw new Error('It is not this player’s turn.');
  const L = legal(table, pid);
  let type = action.type;
  let to = Math.floor(Number(action.to));

  if (type === 'allin') {
    if (L.maxTo <= h.currentBet) type = 'call';
    else { type = 'raise'; to = L.maxTo; }
  }

  switch (type) {
    case 'fold':
      h.folded[pid] = true;
      h.actions.push({ pid, type: 'fold', street: h.street });
      break;
    case 'check':
      if (!L.canCheck) throw new Error(`There is ${L.toCall} to call.`);
      h.actions.push({ pid, type: 'check', street: h.street });
      break;
    case 'call': {
      if (L.canCheck) { h.actions.push({ pid, type: 'check', street: h.street }); break; }
      const paid = put(table, h, pid, L.callAmount);
      h.actions.push({ pid, type: 'call', amount: paid, allin: !!h.allin[pid], street: h.street });
      break;
    }
    case 'raise': {
      const allInRaise = to === L.maxTo;
      if (!L.canRaise && !(allInRaise && L.maxTo > h.currentBet && L.stack > L.toCall && !h.acted[pid])) {
        throw new Error('Raising is not allowed here.');
      }
      if (!Number.isFinite(to) || to <= h.currentBet) throw new Error('Raise must be more than the current bet.');
      if (to > L.maxTo) throw new Error('Not enough chips for that raise.');
      if (to < L.minTo && !allInRaise) throw new Error(`Minimum ${L.isBet ? 'bet' : 'raise'} is ${L.minTo}.`);
      const raiseSize = to - h.currentBet;
      put(table, h, pid, to - h.bets[pid]);
      if (raiseSize >= h.minRaise) { h.minRaise = raiseSize; h.acted = {}; }
      h.currentBet = to;
      h.actions.push({ pid, type: L.isBet ? 'bet' : 'raise', to, allin: !!h.allin[pid], street: h.street });
      break;
    }
    default:
      throw new Error('Unknown action.');
  }
  h.acted[pid] = true;

  const live = h.order.filter((p) => !h.folded[p]);
  if (live.length === 1) {
    h.pots = [{ amount: sum(h.committed), eligible: live, winners: live }];
    distribute(game, table, h.pots[0], live);
    finishHand(game, table);
    return;
  }
  h.toAct = nextToAct(game, h, pid);
  if (!h.toAct) endRound(game, table);
}

function endRound(game, table) {
  const h = table.hand;
  for (const p of h.order) h.bets[p] = 0;
  const live = h.order.filter((p) => !h.folded[p]);
  const actors = live.filter((p) => !h.allin[p]);
  const idx = STREETS.indexOf(h.street);
  if (h.street === 'river' || actors.length <= 1) {
    toShowdown(game, table);
    return;
  }
  h.street = STREETS[idx + 1];
  h.currentBet = 0;
  h.minRaise = table.bb;
  h.acted = {};
  h.toAct = nextToAct(game, h, h.button);
  if (!h.toAct) endRound(game, table);
}

/** Split committed chips into main and side pots. */
export function buildPots(h) {
  const remaining = { ...h.committed };
  const pots = [];
  for (;;) {
    const live = h.order.filter((p) => !h.folded[p] && remaining[p] > 0);
    if (!live.length) {
      const left = sum(remaining);
      if (left && pots.length) pots[pots.length - 1].amount += left;
      break;
    }
    const level = Math.min(...live.map((p) => remaining[p]));
    let amount = 0;
    for (const p of h.order) { const c = Math.min(remaining[p], level); amount += c; remaining[p] -= c; }
    const prev = pots[pots.length - 1];
    if (prev && prev.eligible.length === live.length && prev.eligible.every((p) => live.includes(p))) prev.amount += amount;
    else pots.push({ amount, eligible: live, winners: null });
  }
  return pots;
}

function toShowdown(game, table) {
  const h = table.hand;
  h.street = 'showdown';
  h.toAct = null;
  h.currentBet = 0;
  h.pots = buildPots(h);
  // Pots only one player can win (e.g. an uncalled all-in excess) go back automatically.
  for (const pot of h.pots) if (pot.eligible.length === 1) distribute(game, table, pot, pot.eligible);
  if (h.pots.every((p) => p.winners)) finishHand(game, table);
}

function distribute(game, table, pot, winners) {
  const h = table.hand;
  // Odd chips go to the first winner clockwise from the button.
  const ordered = [];
  let p = h.button;
  for (let i = 0; i < game.entries.length; i += 1) {
    p = nextIn(game, p, winners);
    if (p && !ordered.includes(p)) ordered.push(p);
  }
  const share = Math.floor(pot.amount / ordered.length);
  let odd = pot.amount - share * ordered.length;
  pot.payouts = {};
  for (const w of ordered) {
    const amt = share + (odd > 0 ? 1 : 0);
    if (odd > 0) odd -= 1;
    table.stacks[w] += amt;
    pot.payouts[w] = amt;
  }
  pot.winners = ordered;
}

/** Host picks the winner(s) of each undecided pot at showdown. */
export function award(game, table, potIndex, winners) {
  const h = table.hand;
  if (!h || h.street !== 'showdown') throw new Error('Nothing to award.');
  const pot = h.pots[potIndex];
  if (!pot || pot.winners) throw new Error('That pot is already awarded.');
  const valid = winners.filter((w) => pot.eligible.includes(w));
  if (!valid.length) throw new Error('Pick at least one winner.');
  distribute(game, table, pot, valid);
  if (h.pots.every((p) => p.winners)) finishHand(game, table);
}

function finishHand(game, table) {
  const h = table.hand;
  const won = {};
  for (const pot of h.pots) for (const [w, amt] of Object.entries(pot.payouts || {})) won[w] = (won[w] || 0) + amt;
  const busted = [];
  for (const pid of h.order) {
    const e = entry(game, pid);
    if (e) e.finalChips = table.stacks[pid];
    if (table.stacks[pid] === 0) busted.push(pid);
  }
  // Tournament: bust-outs, smaller starting stack finishes lower.
  if (game.type === 'tournament') {
    busted.sort((a, b) => h.startStacks[a] - h.startStacks[b]);
    for (const pid of busted) {
      const potsIn = h.pots.filter((pt) => pt.eligible.includes(pid) && pt.payouts);
      const killer = potsIn.flatMap((pt) => Object.keys(pt.payouts)).find((w) => w !== pid) || null;
      D.eliminate(game, pid, killer);
    }
  }
  for (const e of game.entries) if (table.stacks[e.playerId] != null) e.finalChips = table.stacks[e.playerId];

  table.lastHand = {
    no: h.no,
    pot: Object.values(h.committed).reduce((a, b) => a + b, 0),
    won,
    pots: h.pots.map((pt) => ({ amount: pt.amount, winners: pt.winners })),
    busted,
    showdown: h.street === 'showdown',
  };
  table.hand = null;
}

/** Cancel the hand in progress and give everyone their chips back. */
export function abortHand(game, table) {
  const h = table.hand;
  if (!h) return false;
  for (const p of h.order) table.stacks[p] += h.committed[p];
  game.dealer.button = h.prevButton;
  game.dealer.history.pop();
  game.dealer.hands = Math.max(0, game.dealer.hands - 1);
  table.handNo -= 1;
  table.hand = null;
  return true;
}

/** Add chips to a player's stack (rebuy / add-on) and record it on the game. */
export function topUp(game, table, pid, kind, chips) {
  if (table.hand && table.hand.order.includes(pid)) throw new Error('Wait until the hand is over.');
  if (!D.addBuy(game, pid, kind, chips)) throw new Error('Could not add chips.');
  table.stacks[pid] = (table.stacks[pid] || 0) + chips;
  const e = entry(game, pid);
  if (e) e.finalChips = table.stacks[pid];
}

/* ---------------------------------------------------------------- public view */

/** Everything a player's phone may see. No hidden information exists, so this is the whole table. */
export function publicState(game, table, nameOf, connected) {
  const h = table.hand;
  const seats = game.entries.map((e, i) => {
    const pid = e.playerId;
    const inHand = !!h && h.order.includes(pid);
    return {
      pid,
      seat: i + 1,
      name: nameOf(pid),
      stack: table.stacks[pid] || 0,
      bet: inHand ? h.bets[pid] : 0,
      committed: inHand ? h.committed[pid] : 0,
      inHand,
      folded: inHand && !!h.folded[pid],
      allin: inHand && !!h.allin[pid],
      out: !e.active,
      place: e.place,
      button: h ? h.button === pid : game.dealer.button === pid,
      sb: inHand && h.sbP === pid,
      bb: inHand && h.bbP === pid,
      claimed: !!table.claims[pid],
      connected: !!table.claims[pid] && connected.has(table.claims[pid]),
    };
  });
  const last = h?.actions[h.actions.length - 1];
  return {
    v: 1,
    room: table.room,
    game: { name: game.name, type: game.type },
    blinds: { sb: table.sb, bb: table.bb },
    handNo: table.handNo,
    seats,
    hand: h ? {
      id: h.id,
      no: h.no,
      street: h.street,
      pot: sum(h.committed),
      currentBet: h.currentBet,
      toAct: h.toAct,
      legal: h.toAct ? legal(table, h.toAct) : null,
      pots: h.pots ? h.pots.map((p) => ({ amount: p.amount, eligible: p.eligible, winners: p.winners })) : null,
      last: last ? { ...last, name: nameOf(last.pid) } : null,
    } : null,
    lastHand: table.lastHand,
    updatedAt: Date.now(),
  };
}

export function describeAction(a, name) {
  const n = name(a.pid);
  switch (a.type) {
    case 'sb': return `${n} posts small blind ${a.amount}`;
    case 'bb': return `${n} posts big blind ${a.amount}`;
    case 'fold': return `${n} folds`;
    case 'check': return `${n} checks`;
    case 'call': return `${n} calls ${a.amount}${a.allin ? ' (all-in)' : ''}`;
    case 'bet': return `${n} bets ${a.to}${a.allin ? ' (all-in)' : ''}`;
    case 'raise': return `${n} raises to ${a.to}${a.allin ? ' (all-in)' : ''}`;
    default: return `${n} ${a.type}`;
  }
}
