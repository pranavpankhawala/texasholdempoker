/**
 * Viewer statistics: pure aggregation over closed-game results.
 */

const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || '');

export function seasonGames(data, seasonId) {
  return data.games
    .filter((g) => g.status === 'closed')
    .filter((g) => seasonId === 'all' || g.seasonId === seasonId)
    .sort(byDate);
}

export function standings(data, seasonId) {
  const games = seasonGames(data, seasonId);
  const rows = new Map();
  const row = (pid) => {
    if (!rows.has(pid)) {
      rows.set(pid, { playerId: pid, points: 0, games: 0, wins: 0, podiums: 0, knockouts: 0, placeSum: 0, cashGames: 0, net: 0, best: null });
    }
    return rows.get(pid);
  };
  for (const g of games) {
    for (const r of g.results) {
      const s = row(r.playerId);
      s.points += r.points;
      s.games += 1;
      s.placeSum += r.place;
      if (r.place === 1) s.wins += 1;
      if (r.place <= 3) s.podiums += 1;
      s.knockouts += r.knockouts;
      if (s.best === null || r.place < s.best) s.best = r.place;
      if (g.type === 'cash' && r.net != null) { s.cashGames += 1; s.net += r.net; }
    }
  }
  const list = [...rows.values()].map((s) => ({ ...s, avgPlace: s.games ? s.placeSum / s.games : null }));
  list.sort((a, b) => b.points - a.points || b.wins - a.wins || b.net - a.net || (a.avgPlace ?? 99) - (b.avgPlace ?? 99));
  let prev = null; let rank = 0;
  list.forEach((s, i) => {
    const key = `${s.points}|${s.wins}`;
    if (key !== prev) rank = i + 1;
    s.rank = rank; prev = key;
  });
  return list;
}

/** Cumulative points after each game, for every player who scored in the period. */
export function pointsRace(data, seasonId) {
  const games = seasonGames(data, seasonId);
  const totals = new Map();
  const series = new Map();
  games.forEach((g, gi) => {
    for (const r of g.results) {
      if (!series.has(r.playerId)) series.set(r.playerId, new Array(games.length).fill(null));
    }
    for (const [pid, arr] of series) {
      const r = g.results.find((x) => x.playerId === pid);
      totals.set(pid, (totals.get(pid) || 0) + (r ? r.points : 0));
      arr[gi] = totals.get(pid);
    }
  });
  // Fill leading gaps with 0 so lines start at the baseline.
  for (const arr of series.values()) for (let i = 0; i < arr.length; i += 1) if (arr[i] === null) arr[i] = 0;
  return { games, series };
}

export function cashNet(data, seasonId) {
  return standings(data, seasonId).filter((s) => s.cashGames > 0).map((s) => ({ playerId: s.playerId, net: s.net, games: s.cashGames }))
    .sort((a, b) => b.net - a.net);
}

export function playerHistory(data, playerId, seasonId) {
  return seasonGames(data, seasonId)
    .map((g) => ({ game: g, result: g.results.find((r) => r.playerId === playerId) }))
    .filter((x) => x.result)
    .reverse();
}

export function headline(data, seasonId) {
  const games = seasonGames(data, seasonId);
  const table = standings(data, seasonId);
  let biggest = null;
  for (const g of games) {
    if (g.type !== 'cash') continue;
    for (const r of g.results) if (r.net != null && (!biggest || r.net > biggest.net)) biggest = { ...r, game: g };
  }
  const hands = games.reduce((s, g) => s + (g.dealer?.hands || 0), 0);
  return { games: games.length, players: table.length, leader: table[0] || null, biggest, hands };
}

/** Dealer / blinds for a live game (heads-up: dealer is small blind). */
export function livePositions(game) {
  const seats = game.entries;
  const next = (fromId) => {
    const start = Math.max(0, seats.findIndex((e) => e.playerId === fromId));
    for (let s = 1; s <= seats.length; s += 1) {
      const e = seats[(start + s) % seats.length];
      if (e.active) return e.playerId;
    }
    return null;
  };
  const active = seats.filter((e) => e.active);
  if (!active.length) return { button: null, sb: null, bb: null };
  let button = game.dealer.button;
  if (!active.some((e) => e.playerId === button)) button = next(button);
  if (active.length === 1) return { button, sb: null, bb: null };
  if (active.length === 2) return { button, sb: button, bb: next(button) };
  const sb = next(button);
  return { button, sb, bb: next(sb) };
}
