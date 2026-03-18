/**
 * oflProxy.ts — Fixture library search and profile fetch.
 *
 * Strategy:
 *   1. If the bundled starter set has >100 entries (full library imported via
 *      scripts/import-ofl.ts), search it locally — instant, fully offline.
 *   2. Otherwise fall back to the live OFL API, then disk cache, then starter.
 *
 * Key format:
 *   2-segment:  "manufacturer/fixture"          — legacy / live API key
 *   3-segment:  "manufacturer/fixture/modeShort" — mode-qualified starter key
 *
 * The 3-segment format is returned by searchFixtures() when the full library
 * is loaded. fetchFixture() resolves it directly from the starter without any
 * network request.
 */

import fs from 'fs';
import path from 'path';
import { Profile } from '@lites/shared';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OflSearchResult {
  key: string;           // e.g. "chauvet-dj/slimpar-t12-bt/7ch"
  name: string;          // e.g. "SlimPAR T12 BT (7ch)"
  manufacturer: string;  // e.g. "Chauvet DJ"
  channelCount: number;
}

export interface OflProfile extends Profile {
  oflKey: string;
}

// ── Paths ─────────────────────────────────────────────────────────────────────

// In production: dist/assets/  In dev (tsx): src/assets/
const STARTER_PATH = (() => {
  const distPath = path.resolve(__dirname, 'assets', 'ofl-starter.json');
  if (fs.existsSync(distPath)) return distPath;
  // tsx runs from src/ so __dirname may be src/ — check parent too
  return path.resolve(__dirname, '..', 'src', 'assets', 'ofl-starter.json');
})();

const CACHE_DIR = path.resolve(__dirname, '..', '..', 'data');
const CACHE_PATH = path.join(CACHE_DIR, 'ofl-cache.json');

const OFL_BASE = 'https://open-fixture-library.org/api/v1';
const FETCH_TIMEOUT_MS = 5000;

// ── Starter entry format (written by scripts/import-ofl.ts) ──────────────────

interface StarterEntry {
  key: string;                      // "manufacturer/fixture"
  mode: string;                     // mode short name, e.g. "7ch"
  name: string;                     // "SlimPAR T12 BT (7ch)"
  manufacturer: string;
  channelCount: number;
  params: Record<string, number>;
}

let _starter: StarterEntry[] | null = null;

function getStarter(): StarterEntry[] {
  if (_starter) return _starter;
  try {
    _starter = JSON.parse(fs.readFileSync(STARTER_PATH, 'utf8')) as StarterEntry[];
  } catch {
    _starter = [];
  }
  return _starter;
}

/** True when the full library has been imported (not just the tiny seed set). */
function hasFullLibrary(): boolean {
  return getStarter().length > 100;
}

// ── Cache I/O ─────────────────────────────────────────────────────────────────

type CacheStore = Record<string, unknown>;

function readCache(): CacheStore {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as CacheStore;
  } catch {
    return {};
  }
}

function writeCache(store: CacheStore): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(store, null, 2));
  } catch (e) {
    console.warn('[OFL] Could not write cache:', (e as Error).message);
  }
}

function getCache<T>(key: string): T | null {
  return (readCache()[key] as T) ?? null;
}

function setCache(key: string, value: unknown): void {
  const store = readCache();
  store[key] = value;
  writeCache(store);
}

// ── Local search ─────────────────────────────────────────────────────────────

// Common abbreviations → expansion for search
const SEARCH_ALIASES: Record<string, string> = {
  adj:    'american dj',
  chauvet:'chauvet',
  robe:   'robe',
  martin: 'martin',
  elation:'elation',
  ayrton: 'ayrton',
  clay:   'clay paky',
  gfe:    'guangzhou',
};

function searchLocal(query: string): OflSearchResult[] {
  const raw = query.toLowerCase().trim();
  if (!raw) return getStarter().slice(0, 50).map(toResult);

  // Expand per-token abbreviations then re-split
  // e.g. "adj par" → tokens ["adj","par"] → expand → ["american dj","par"] → ["american","dj","par"]
  const rawTokens = raw.split(/\s+/).filter(Boolean);
  const tokens = rawTokens
    .flatMap(t => (SEARCH_ALIASES[t] ?? t).split(/\s+/))
    .filter(Boolean);
  const all = getStarter();

  const matched = all.filter(e => {
    const haystack = `${e.name} ${e.manufacturer} ${e.key}`.toLowerCase();
    return tokens.every(t => haystack.includes(t));
  });

  return matched.slice(0, 50).map(toResult);
}

function toResult(e: StarterEntry): OflSearchResult {
  return {
    key: `${e.key}/${e.mode}`,   // 3-segment mode-qualified key
    name: e.name,
    manufacturer: e.manufacturer,
    channelCount: e.channelCount,
  };
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

// ── OFL API response types ────────────────────────────────────────────────────

interface OflApiFixture {
  key: string;
  name: string;
  manufacturerName: string;
  modes: Array<{ name: string; channelCount: number }>;
}

interface OflApiSearchResponse {
  fixtures: OflApiFixture[];
}

interface OflApiCap {
  type: string;
  color?: string;
}

interface OflApiChannel {
  type?: string;
  capabilities?: OflApiCap[];
  capability?: OflApiCap;
}

interface OflApiFull {
  name: string;
  modes: Array<{ name: string; channels: string[] }>;
  availableChannels: Record<string, OflApiChannel>;
}

// ── OFL channel → lites param name ───────────────────────────────────────────

const OFL_PARAM_MAP: Record<string, string> = {
  'Intensity':         'dimmer',
  'Single Color':      'dimmer',
  'Red':               'red',
  'Green':             'green',
  'Blue':              'blue',
  'White':             'white',
  'Amber':             'amber',
  'UV':                'uv',
  'Warm White':        'warmwhite',
  'Cold White':        'coldwhite',
  'Cyan':              'cyan',
  'Magenta':           'magenta',
  'Yellow':            'yellow',
  'Pan':               'pan',
  'Tilt':              'tilt',
  'Color Temperature': 'colorTemp',
  'Strobe':            'strobe',
  'ShutterStrobe':     'strobe',
  'Zoom':              'zoom',
  'Focus':             'focus',
  'Iris':              'iris',
  'Rotation':          'rotation',
  'Speed':             'speed',
  'EffectSpeed':       'speed',
  'Effect':            'auto',
  'Fog':               'fog',
  'Prism':             'prism',
};

function oflTypeToParam(ch: OflApiChannel, channelName: string): string {
  // Check single capability (OFL export uses `capability` singular)
  const capSingle = (ch as { capability?: OflApiCap }).capability;
  const caps: OflApiCap[] = ch.capabilities ?? (capSingle ? [capSingle] : []);

  for (const cap of caps) {
    if (!cap.type || cap.type === 'NoFunction') continue;
    if (cap.type === 'ColorIntensity' && cap.color && OFL_PARAM_MAP[cap.color]) {
      return OFL_PARAM_MAP[cap.color];
    }
    if (OFL_PARAM_MAP[cap.type]) return OFL_PARAM_MAP[cap.type];
  }

  const lower = channelName.toLowerCase();
  for (const [oflType, param] of Object.entries(OFL_PARAM_MAP)) {
    if (lower.includes(oflType.toLowerCase())) return param;
  }

  return channelName.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Search for fixtures. Returns up to 50 results.
 * Uses local library when the full import has been run, otherwise live API.
 */
export async function searchFixtures(query: string): Promise<OflSearchResult[]> {
  // Full library available — serve locally, no network needed
  if (hasFullLibrary()) {
    return searchLocal(query);
  }

  const cacheKey = `search:${query.toLowerCase().trim()}`;

  try {
    const data = await fetchJson<OflApiSearchResponse>(
      `${OFL_BASE}/search?query=${encodeURIComponent(query)}&pageSize=50`
    );
    const results: OflSearchResult[] = (data.fixtures ?? []).map(f => ({
      key: f.key,
      name: f.name,
      manufacturer: f.manufacturerName,
      channelCount: f.modes[0]?.channelCount ?? 0,
    }));
    setCache(cacheKey, results);
    return results;
  } catch {
    console.warn(`[OFL] Live search failed for "${query}", trying cache…`);
  }

  const cached = getCache<OflSearchResult[]>(cacheKey);
  if (cached) return cached;

  console.warn('[OFL] Cache miss — serving from bundled starter set.');
  return searchLocal(query);
}

/**
 * Fetch and convert a full fixture profile.
 * 3-segment keys (manufacturer/fixture/mode) resolve instantly from the
 * local starter. 2-segment keys use cache then live API.
 */
export async function fetchFixture(key: string): Promise<OflProfile | null> {
  const parts = key.split('/');

  // 3-segment mode-qualified key — look up directly in starter (no network)
  if (parts.length === 3) {
    const baseKey = `${parts[0]}/${parts[1]}`;
    const mode = parts[2];
    const entry = getStarter().find(e => e.key === baseKey && e.mode === mode);
    if (entry) {
      return { id: '', oflKey: key, name: entry.name, channelCount: entry.channelCount, params: entry.params };
    }
    // If not in starter, strip mode and fall through to API
  }

  // 2-segment key — try cache then live API
  const baseKey = parts.slice(0, 2).join('/');
  const cacheKey = `fixture:${baseKey}`;

  const cached = getCache<OflProfile>(cacheKey);
  if (cached) return cached;

  try {
    const [manufacturer, fixture] = baseKey.split('/');
    const data = await fetchJson<OflApiFull>(`${OFL_BASE}/fixture/${manufacturer}/${fixture}`);
    const profile = oflFullToProfile(baseKey, data);
    if (profile) setCache(cacheKey, profile);
    return profile;
  } catch {
    console.warn(`[OFL] Live fetch failed for "${baseKey}".`);
  }

  // Last resort: match by base key in starter (first mode)
  const fallback = getStarter().find(e => e.key === baseKey);
  if (fallback) {
    return { id: '', oflKey: key, name: fallback.name, channelCount: fallback.channelCount, params: fallback.params };
  }

  return null;
}

function oflFullToProfile(key: string, data: OflApiFull): OflProfile | null {
  const mode = data.modes?.[0];
  if (!mode) return null;

  const paramCounts: Record<string, number> = {};
  const params: Record<string, number> = {};

  mode.channels.forEach((channelKey, offset) => {
    const ch = data.availableChannels?.[channelKey] ?? {};
    let param = oflTypeToParam(ch as OflApiChannel, channelKey);
    paramCounts[param] = (paramCounts[param] ?? 0) + 1;
    if (paramCounts[param] > 1) param = `${param}${paramCounts[param]}`;
    params[param] = offset;
  });

  return { id: '', oflKey: key, name: data.name, channelCount: mode.channels.length, params };
}
