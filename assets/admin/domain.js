/**
 * Admin business logic: game rules, dealer rotation, scoring.
 * Pure functions over plain data objects. No DOM, no storage.
 */

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const findPlayer = (data, id) => data.players.find((p) => p.id === id);
export const playerName = (data, id) => findPlayer(data, id)?.name ?? 'Unknown player';
export const findGame = (data, id) => data.games.find((g) => g.id === id);
export const liveGame = (data) => (data.liveGameId ? findGame(data, data.liveGameId) : null);

/* ---------------- Chips ---------------- */

export const entryChipsIn = (entry) => entry.buys.reduce((sum, b) => sum + b.chips, 0);

export function gameTotals(game) {
  let chipsIn = 0;
  let counted = 0;
  let countedEntries = 0;
  for (const e of game.entries) {
    chipsIn += entryChipsIn(e);
    if (e.finalChips != null) { counted += e.finalChips; countedEntries += 1; }
  }
  const activeCount = game.entries.filter((e) => e.active).length;
  return { chipsIn, counted, countedEntries, activeCount, diff: counted - chipsIn };
}

export function chipTotal(counts, chipSet) {
  return chipSet.reduce((sum, c) => sum + (Math.max(0, Math.floor(Number(counts[c.id]) || 0)) * c.value), 0);
}

/* ---------------- Game lifecycle ---------------- */

export function createGame({ name, date, type, seasonId, startingStack, playerIds }) {
  const now = new Date().toISOString();
  const game = {
    id: uid(),
    name,
    date,
    type,
    seasonId: seasonId || null,
    status: 'live',
    startingStack,
    createdAt: now,
    closedAt: null,
    entries: [],
    dealer: { button: null, hands: 0, history: [] },
    results: [],
  };
  playerIds.forEach((pid) => addEntry(game, pid));
  game.dealer.button = game.entries[0]?.playerId ?? null;
  return game;
}

export function addEntry(game, playerId) {
  if (game.entries.some((e) => e.playerId === playerId)) return false;
  game.entries.push({
    playerId,
    buys: [{ kind: 'buyin', chips: game.startingStack, at: new Date().toISOString() }],
    finalChips: null,
    active: true,
    place: null,
    knockouts: 0,
    knockedOutBy: null,
  });
  if (!game.dealer.button) game.dealer.button = playerId;
  return true;
}

export function addBuy(game, playerId, kind, chips) {
  const e = game.entries.find((x) => x.playerId === playerId);
  if (!e || !(chips > 0)) return false;
  e.buys.push({ kind, chips, at: new Date().toISOString() });
  // A tournament rebuy brings an eliminated player back in.
  if (game.type === 'tournament' && !e.active && kind === 'rebuy') reinstate(game, playerId, true);
  return true;
}

export function removeLastBuy(game, playerId) {
  const e = game.entries.find((x) => x.playerId === playerId);
  if (!e || e.buys.length <= 1) return false;
  e.buys.pop();
  return true;
}

export function moveSeat(game, playerId, delta) {
  const i = game.entries.findIndex((e) => e.playerId === playerId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= game.entries.length) return false;
  [game.entries[i], game.entries[j]] = [game.entries[j], game.entries[i]];
  return true;
}

export function shuffleSeats(game) {
  const a = game.entries;
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

/** Tournament bust-out. Returns the finishing place assigned. */
export function eliminate(game, playerId, byPlayerId) {
  const e = game.entries.find((x) => x.playerId === playerId);
  if (!e || !e.active) return null;
  const place = game.entries.filter((x) => x.active).length;
  e.active = false;
  e.place = place;
  e.finalChips = 0;
  e.knockedOutBy = byPlayerId || null;
  if (byPlayerId) {
    const killer = game.entries.find((x) => x.playerId === byPlayerId);
    if (killer) killer.knockouts += 1;
  }
  return place;
}

/** Only the most recent bust-out can be reversed, so places stay consistent. */
export function canReinstate(game, playerId) {
  const e = game.entries.find((x) => x.playerId === playerId);
  if (!e || e.active) return false;
  if (game.type === 'cash') return true;
  const busted = game.entries.filter((x) => !x.active && x.place != null);
  const lowestPlace = Math.min(...busted.map((x) => x.place));
  return e.place === lowestPlace;
}

export function reinstate(game, playerId, force = false) {
  const e = game.entries.find((x) => x.playerId === playerId);
  if (!e || e.active) return false;
  if (!force && !canReinstate(game, playerId)) return false;
  if (e.knockedOutBy) {
    const killer = game.entries.find((x) => x.playerId === e.knockedOutBy);
    if (killer && killer.knockouts > 0) killer.knockouts -= 1;
  }
  if (game.type === 'tournament' && e.place != null) {
    // Busted players who finished better (lower number) than this player shift down one place.
    for (const other of game.entries) {
      if (other !== e && !other.active && other.place != null && other.place < e.place) other.place += 1;
    }
  }
  e.active = true;
  e.place = null;
  e.knockedOutBy = null;
  if (game.type === 'tournament') e.finalChips = null;
  return true;
}

/** Cash game: player leaves the table (still needs a final chip count). */
export function setLeft(game, playerId, left) {
  const e = game.entries.find((x) => x.playerId === playerId);
  if (!e) return false;
  e.active = !left;
  return true;
}

export function removeEntry(game, playerId) {
  const i = game.entries.findIndex((e) => e.playerId === playerId);
  if (i < 0) return false;
  const [e] = game.entries.splice(i, 1);
  if (game.dealer.button === playerId) {
    game.dealer.button = game.entries[i % Math.max(1, game.entries.length)]?.playerId ?? null;
  }
  game.dealer.history = game.dealer.history.filter((id) => id !== playerId);
  if (e.knockedOutBy) {
    const killer = game.entries.find((x) => x.playerId === e.knockedOutBy);
    if (killer && killer.knockouts > 0) killer.knockouts -= 1;
  }
  return true;
}

/* ---------------- Dealer button ---------------- */

/** Next seat clockwise from `fromId` that is still in the hand. */
export function nextActive(game, fromId) {
  const seats = game.entries;
  if (!seats.length) return null;
  const start = Math.max(0, seats.findIndex((e) => e.playerId === fromId));
  for (let step = 1; step <= seats.length; step += 1) {
    const e = seats[(start + step) % seats.length];
    if (e.active) return e.playerId;
  }
  return null;
}

/** Dealer, small blind and big blind for the current hand. Heads-up: dealer posts the small blind. */
export function positions(game) {
  const active = game.entries.filter((e) => e.active);
  let button = game.dealer.button;
  if (!active.length) return { button: null, sb: null, bb: null };
  if (!active.some((e) => e.playerId === button)) button = nextActive(game, button);
  if (active.length === 1) return { button, sb: null, bb: null };
  if (active.length === 2) return { button, sb: button, bb: nextActive(game, button) };
  const sb = nextActive(game, button);
  return { button, sb, bb: nextActive(game, sb) };
}

export function nextHand(game) {
  const { button } = positions(game);
  if (!button) return false;
  game.dealer.history.push(game.dealer.button);
  if (game.dealer.history.length > 100) game.dealer.history.shift();
  game.dealer.button = nextActive(game, button);
  game.dealer.hands += 1;
  return true;
}

export function undoHand(game) {
  if (!game.dealer.history.length) return false;
  game.dealer.button = game.dealer.history.pop();
  game.dealer.hands = Math.max(0, game.dealer.hands - 1);
  return true;
}

export function setButton(game, playerId) {
  if (!game.entries.some((e) => e.playerId === playerId)) return false;
  game.dealer.button = playerId;
  return true;
}

/* ---------------- Closing & scoring ---------------- */

/** Validation before close. errors block, warnings need confirmation. */
export function closeCheck(game) {
  const errors = [];
  const warnings = [];
  const { chipsIn, counted } = gameTotals(game);
  if (game.entries.length < 2) errors.push('A game needs at least two players.');
  if (game.table?.hand) errors.push('A Chip Table hand is still in progress. Finish or cancel it on the host screen first.');

  if (game.type === 'cash') {
    const missing = game.entries.filter((e) => e.finalChips == null).length;
    if (missing) errors.push(`${missing} player${missing > 1 ? 's' : ''} still need a final chip count.`);
    else if (counted !== chipsIn) {
      warnings.push(`Chips don't balance: ${fmt(chipsIn)} in, ${fmt(counted)} counted (${signed(counted - chipsIn)}).`);
    }
  } else {
    const alive = game.entries.filter((e) => e.active);
    if (alive.length > 1) {
      const missing = alive.filter((e) => e.finalChips == null).length;
      if (missing) {
        errors.push(`${alive.length} players are still in. Eliminate players, or enter final chip counts for everyone still in to rank them.`);
      } else {
        warnings.push(`${alive.length} players are still in. They will be ranked by their final chip counts.`);
      }
    }
  }
  return { errors, warnings };
}

/** Standard competition ranking ("1224") on a numeric key, higher is better. */
function rankBy(list, key) {
  const sorted = [...list].sort((a, b) => key(b) - key(a));
  let lastVal = null;
  let lastRank = 0;
  return sorted.map((item, i) => {
    const v = key(item);
    const rank = v === lastVal ? lastRank : i + 1;
    lastVal = v; lastRank = rank;
    return { item, rank };
  });
}

export function computeResults(game, rules) {
  const pointsFor = (place) => (rules.places[place - 1] ?? 0);
  const scorePoints = game.type === 'tournament' || rules.applyToCash;
  const out = [];

  if (game.type === 'cash') {
    const ranked = rankBy(game.entries, (e) => (e.finalChips ?? 0) - entryChipsIn(e));
    for (const { item: e, rank } of ranked) {
      const chipsIn = entryChipsIn(e);
      const chipsOut = e.finalChips ?? 0;
      out.push({
        playerId: e.playerId,
        place: rank,
        chipsIn,
        chipsOut,
        net: chipsOut - chipsIn,
        knockouts: 0,
        rebuys: e.buys.filter((b) => b.kind === 'rebuy').length,
        points: scorePoints ? pointsFor(rank) + rules.participation : 0,
      });
    }
  } else {
    const alive = game.entries.filter((e) => e.active);
    const placeOf = new Map(game.entries.filter((e) => !e.active).map((e) => [e.playerId, e.place]));
    rankBy(alive, (e) => e.finalChips ?? 0).forEach(({ item, rank }) => placeOf.set(item.playerId, rank));
    for (const e of game.entries) {
      const place = placeOf.get(e.playerId) ?? game.entries.length;
      out.push({
        playerId: e.playerId,
        place,
        chipsIn: entryChipsIn(e),
        chipsOut: e.active ? (e.finalChips ?? 0) : 0,
        net: null,
        knockouts: e.knockouts,
        rebuys: e.buys.filter((b) => b.kind === 'rebuy').length,
        points: pointsFor(place) + rules.participation + e.knockouts * rules.knockout,
      });
    }
  }
  return out.sort((a, b) => a.place - b.place || b.points - a.points);
}

export function closeGame(data, game) {
  if (game.type === 'tournament') {
    const alive = game.entries.filter((e) => e.active);
    if (alive.length === 1) alive[0].place = 1;
  }
  game.results = computeResults(game, data.settings.points);
  game.status = 'closed';
  game.closedAt = new Date().toISOString();
  if (data.liveGameId === game.id) data.liveGameId = null;
}

export function reopenGame(data, game) {
  game.status = 'live';
  game.closedAt = null;
  game.results = [];
  if (game.type === 'tournament') {
    for (const e of game.entries) if (e.active) e.place = null;
  }
  data.liveGameId = game.id;
}

export function recalcAll(data) {
  let n = 0;
  for (const g of data.games) {
    if (g.status === 'closed') { g.results = computeResults(g, data.settings.points); n += 1; }
  }
  return n;
}

/* ---------------- Small stats for admin lists ---------------- */

export function playerSummary(data, playerId) {
  let games = 0; let points = 0; let wins = 0;
  for (const g of data.games) {
    if (g.status !== 'closed') continue;
    const r = g.results.find((x) => x.playerId === playerId);
    if (!r) continue;
    games += 1; points += r.points; if (r.place === 1) wins += 1;
  }
  return { games, points, wins };
}

export const playerHasGames = (data, playerId) => data.games.some((g) => g.entries.some((e) => e.playerId === playerId));

/* ---------------- Formatting ---------------- */

const nf = new Intl.NumberFormat();
export const fmt = (n) => nf.format(n);
export const signed = (n) => (n > 0 ? `+${nf.format(n)}` : n < 0 ? `−${nf.format(Math.abs(n))}` : '0');
export const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
