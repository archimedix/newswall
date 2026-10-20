/* The catalog, shared by every view: what the sources are (sources.json),
   whether they were live at the last check (live.json), and how to name them. */

/* One wall per mode. The keys are iptv-org category ids, the same ones the
   sources carry in `categories`. Without a hand-picked wall, the default is
   the first live channels of the mode, one per country. */
export const MODES = {
  news: { label: 'News', wall: ['aljazeera-en', 'france24-en', 'dw-news', 'rainews24', 'cgtn', 'trt-world'] },
  // National sport channels are often geoblocked: these play from abroad.
  sports: { label: 'Sport', wall: ['tvr-sport', 'a-spor', 'ge-fast', 'real-madrid-tv', 'red-bull-tv', 'tyc-sports'] },
  business: { label: 'Markets' },
  weather: { label: 'Weather' },
};

export const catalog = {
  all: [],              // curated catalog, every mode
  live: {},             // result of the last refresh, by id
  generated: null,      // when that refresh ran
};

export async function loadCatalog() {
  const [sources, live] = await Promise.all([
    fetch('sources.json').then((r) => r.json()),
    fetch('live.json').then((r) => r.json()).catch(() => ({ entries: {} })),
  ]);
  catalog.all = sources.sources;
  catalog.live = live.entries || {};
  catalog.generated = live.generated;
  return catalog;
}

export const byId = (id) => catalog.all.find((s) => s.id === id);
export const inMode = (s, mode) => (s.categories || ['news']).includes(mode);
export const isPlayable = (id) => (catalog.live[id] ? catalog.live[id].ok !== false : true);

/* Which stream to try first: the one the last check found working. */
export function firstStream(src) {
  const use = catalog.live[src.id]?.use;
  return Number.isInteger(use) ? use : 0;
}

/* Flag from the ISO code: two letters -> two "regional indicators". */
export function flag(cc) {
  if (!/^[A-Za-z]{2}$/.test(cc || '')) return '';
  const cp = [...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65);
  return String.fromCodePoint(...cp);
}

/* The browser already knows country names: no list to keep up to date. */
const REGION = (() => {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; }
})();
export const countryName = (cc) => {
  try { return REGION?.of(cc) || cc; } catch { return cc; }
};
/* Same for languages: two-letter codes, or three where ISO 639-1 has none. */
const LANGUAGE = (() => {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }); } catch { return null; }
})();
export const langName = (l) => {
  try { return (l && LANGUAGE?.of(l)) || l || '?'; } catch { return l || '?'; }
};

export const ORIGIN_LABEL = {
  broadcaster: 'from the broadcaster',
  cdn: 'via CDN',
  rebroadcast: 'rebroadcast by a third party',
  unknown: 'unidentified origin',
};

export function originText(stream) {
  const o = stream.origin || {};
  const who = o.label || o.host || '?';
  return `${who} — ${ORIGIN_LABEL[o.kind] || o.kind || ''}`.trim();
}

export const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
