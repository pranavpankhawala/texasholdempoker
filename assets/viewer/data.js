/**
 * Viewer data access (read-only). Sources, in order of preference:
 *   1. a backup file the viewer opens,
 *   2. this browser's saved data (written by the admin page),
 *   3. an optional published file at data/standings.json in the repo.
 */

const DATA_KEY = 'thp.data.v1';
const PUBLISHED_URL = 'data/standings.json';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, d = '') => (typeof v === 'string' ? v : d);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Keep only the fields the viewer reads, with safe types. */
function sanitize(raw) {
  if (!isObj(raw) || !Array.isArray(raw.players) || !Array.isArray(raw.games)) {
    throw new Error('This file is not a Hold’em Tracker backup.');
  }
  return {
    updatedAt: str(raw.updatedAt),
    activeSeasonId: str(raw.activeSeasonId) || null,
    liveGameId: str(raw.liveGameId) || null,
    players: raw.players.filter(isObj).map((p) => ({ id: str(p.id), name: str(p.name, 'Player').slice(0, 40), active: p.active !== false })).filter((p) => p.id),
    seasons: (Array.isArray(raw.seasons) ? raw.seasons : []).filter(isObj).map((s) => ({ id: str(s.id), name: str(s.name, 'Season').slice(0, 40), startDate: str(s.startDate) })).filter((s) => s.id),
    games: raw.games.filter(isObj).map((g) => ({
      id: str(g.id),
      name: str(g.name, 'Game').slice(0, 60),
      date: str(g.date),
      createdAt: str(g.createdAt),
      type: g.type === 'cash' ? 'cash' : 'tournament',
      seasonId: str(g.seasonId) || null,
      status: g.status === 'closed' ? 'closed' : 'live',
      startingStack: num(g.startingStack),
      entries: (Array.isArray(g.entries) ? g.entries : []).filter(isObj).map((e) => ({
        playerId: str(e.playerId),
        active: e.active !== false,
        place: e.place == null ? null : num(e.place),
        knockouts: num(e.knockouts),
        chipsIn: (Array.isArray(e.buys) ? e.buys : []).reduce((s, b) => s + (isObj(b) ? num(b.chips) : 0), 0),
        rebuys: (Array.isArray(e.buys) ? e.buys : []).filter((b) => isObj(b) && b.kind === 'rebuy').length,
      })),
      dealer: isObj(g.dealer) ? { button: str(g.dealer.button) || null, hands: num(g.dealer.hands) } : { button: null, hands: 0 },
      results: (Array.isArray(g.results) ? g.results : []).filter(isObj).map((r) => ({
        playerId: str(r.playerId),
        place: num(r.place, 99),
        points: num(r.points),
        chipsIn: num(r.chipsIn),
        chipsOut: num(r.chipsOut),
        net: r.net == null ? null : num(r.net),
        knockouts: num(r.knockouts),
      })),
    })).filter((g) => g.id),
  };
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    return raw ? sanitize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export async function loadPublished() {
  try {
    const res = await fetch(PUBLISHED_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    return sanitize(await res.json());
  } catch {
    return null;
  }
}

export async function loadFile(file) {
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch { throw new Error('That file is not valid JSON.'); }
  return sanitize(parsed);
}

export function onLocalChange(cb) {
  window.addEventListener('storage', (e) => { if (e.key === DATA_KEY) cb(); });
}

export const hasContent = (d) => !!d && (d.players.length > 0 || d.games.length > 0);
