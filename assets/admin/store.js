/**
 * Admin data-access layer.
 * Owns everything that touches browser storage. No DOM, no game rules.
 */

export const DATA_KEY = 'thp.data.v1';
const PIN_KEY = 'thp.admin.pin';
const SESSION_KEY = 'thp.admin.unlocked';
export const SCHEMA_VERSION = 1;

export const DEFAULT_POINTS = Object.freeze({
  places: [10, 7, 5, 3, 2],
  participation: 1,
  knockout: 1,
  applyToCash: true,
});

export const DEFAULT_CHIPS = Object.freeze([
  { id: 'c25', name: 'White', color: '#f4f4f5', value: 25 },
  { id: 'c100', name: 'Red', color: '#dc2626', value: 100 },
  { id: 'c500', name: 'Blue', color: '#2563eb', value: 500 },
  { id: 'c1000', name: 'Green', color: '#16a34a', value: 1000 },
  { id: 'c5000', name: 'Black', color: '#18181b', value: 5000 },
]);

export function createEmpty() {
  return {
    version: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    settings: {
      points: { ...DEFAULT_POINTS, places: [...DEFAULT_POINTS.places] },
      chips: DEFAULT_CHIPS.map((c) => ({ ...c })),
      defaultStack: 10000,
    },
    players: [],
    seasons: [],
    activeSeasonId: null,
    liveGameId: null,
    games: [],
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v, d = '') => (typeof v === 'string' ? v : d);

/** Coerce any parsed JSON into a well-formed data object (throws if hopeless). */
export function normalize(raw) {
  if (!isObj(raw)) throw new Error('File is not a tracker backup.');
  if (!Array.isArray(raw.players) || !Array.isArray(raw.games)) {
    throw new Error('Backup is missing players or games.');
  }
  const base = createEmpty();
  const s = isObj(raw.settings) ? raw.settings : {};
  const p = isObj(s.points) ? s.points : {};

  const data = {
    version: SCHEMA_VERSION,
    updatedAt: str(raw.updatedAt, base.updatedAt),
    settings: {
      points: {
        places: Array.isArray(p.places) ? p.places.map((n) => Math.max(0, num(n))) : base.settings.points.places,
        participation: Math.max(0, num(p.participation, DEFAULT_POINTS.participation)),
        knockout: Math.max(0, num(p.knockout, DEFAULT_POINTS.knockout)),
        applyToCash: p.applyToCash !== false,
      },
      chips: Array.isArray(s.chips)
        ? s.chips.filter(isObj).map((c, i) => ({
            id: str(c.id, `chip${i}`),
            name: str(c.name, 'Chip').slice(0, 30),
            color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#888888',
            value: Math.max(1, num(c.value, 1)),
          }))
        : base.settings.chips,
      defaultStack: Math.max(1, num(s.defaultStack, base.settings.defaultStack)),
    },
    players: raw.players.filter(isObj).map((pl) => ({
      id: str(pl.id),
      name: str(pl.name, 'Player').slice(0, 40),
      active: pl.active !== false,
      createdAt: str(pl.createdAt, base.updatedAt),
    })).filter((pl) => pl.id),
    seasons: (Array.isArray(raw.seasons) ? raw.seasons : []).filter(isObj).map((se) => ({
      id: str(se.id),
      name: str(se.name, 'Season').slice(0, 40),
      startDate: str(se.startDate),
      createdAt: str(se.createdAt, base.updatedAt),
    })).filter((se) => se.id),
    activeSeasonId: str(raw.activeSeasonId) || null,
    liveGameId: str(raw.liveGameId) || null,
    games: raw.games.filter(isObj).map(normalizeGame).filter((g) => g.id),
  };

  if (data.activeSeasonId && !data.seasons.some((x) => x.id === data.activeSeasonId)) data.activeSeasonId = null;
  if (data.liveGameId && !data.games.some((g) => g.id === data.liveGameId && g.status === 'live')) data.liveGameId = null;
  return data;
}

function normalizeGame(g) {
  const dealer = isObj(g.dealer) ? g.dealer : {};
  return {
    id: str(g.id),
    name: str(g.name, 'Game').slice(0, 60),
    date: str(g.date),
    type: g.type === 'cash' ? 'cash' : 'tournament',
    seasonId: str(g.seasonId) || null,
    status: g.status === 'closed' ? 'closed' : 'live',
    startingStack: Math.max(1, num(g.startingStack, 10000)),
    createdAt: str(g.createdAt),
    closedAt: str(g.closedAt) || null,
    entries: (Array.isArray(g.entries) ? g.entries : []).filter(isObj).map((e) => ({
      playerId: str(e.playerId),
      buys: (Array.isArray(e.buys) ? e.buys : []).filter(isObj).map((b) => ({
        kind: ['buyin', 'rebuy', 'addon'].includes(b.kind) ? b.kind : 'buyin',
        chips: Math.max(0, num(b.chips)),
        at: str(b.at),
      })),
      finalChips: e.finalChips === null || e.finalChips === undefined || e.finalChips === '' ? null : Math.max(0, num(e.finalChips)),
      active: e.active !== false,
      place: e.place == null ? null : num(e.place),
      knockouts: Math.max(0, num(e.knockouts)),
      knockedOutBy: str(e.knockedOutBy) || null,
    })).filter((e) => e.playerId),
    dealer: {
      button: str(dealer.button) || null,
      hands: Math.max(0, num(dealer.hands)),
      history: Array.isArray(dealer.history) ? dealer.history.filter((x) => typeof x === 'string').slice(-100) : [],
    },
    results: Array.isArray(g.results) ? g.results.filter(isObj) : [],
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) return createEmpty();
    return normalize(JSON.parse(raw));
  } catch (err) {
    console.warn('Could not read saved data, starting fresh.', err);
    return createEmpty();
  }
}

/** @returns {boolean} true when persisted */
export function save(data) {
  try {
    data.updatedAt = new Date().toISOString();
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.error('Save failed', err);
    return false;
  }
}

export function toExportJSON(data) {
  return JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2);
}

export function parseImport(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  return normalize(parsed);
}

export function clearAll() {
  try { localStorage.removeItem(DATA_KEY); } catch { /* ignore */ }
}

/* ---------- PIN (kept apart from game data; never exported) ---------- */

export function getPinRecord() {
  try { return JSON.parse(localStorage.getItem(PIN_KEY) || 'null'); } catch { return null; }
}
export function setPinRecord(rec) {
  try { localStorage.setItem(PIN_KEY, JSON.stringify(rec)); return true; } catch { return false; }
}
export function clearPin() {
  try { localStorage.removeItem(PIN_KEY); } catch { /* ignore */ }
}
export function isUnlocked() {
  try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch { return false; }
}
export function setUnlocked(on) {
  try { on ? sessionStorage.setItem(SESSION_KEY, '1') : sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}
