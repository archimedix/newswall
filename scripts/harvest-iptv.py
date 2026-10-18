#!/usr/bin/env python3
"""
Fishes new sources out of the public iptv-org catalog and adds them to sources.json.

iptv-org lists thousands of channels but does not say which ones work from a
static page: only what really holds up is kept here, i.e. HTTPS + CORS + a
valid manifest. Entries already in sources.json are left untouched, except
that a curated one can join another wall (its "categories" grows).

    python3 scripts/harvest-iptv.py                      # show the news candidates
    python3 scripts/harvest-iptv.py --category sports    # any iptv-org category = a wall mode
    python3 scripts/harvest-iptv.py --write              # add the ones in scripts/curated/<category>.txt

Options: --category ID (default news), --max N (overall cap), --per-country N, --cache DIR
"""
import argparse, gzip, json, re, ssl, sys, unicodedata, urllib.request, urllib.error, zlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CURATED = ROOT / "scripts" / "curated"      # one <category>.txt per wall mode
API = "https://iptv-org.github.io/api"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
CTX = ssl.create_default_context()

# Macro areas for the panel filters. Anything unmapped ends up in "world".
AREA = {
    'IT': 'italy',
    **{c: 'europe' for c in "AL AT BA BE BG BY CH CY CZ DE DK EE ES FI FR GB GR HR HU IE IS LT LU LV MD ME MK MT NL NO PL PT RO RS SE SI SK UA VA".split()},
    **{c: 'mideast' for c in "AE BH EG IL IQ IR JO KW LB OM PS QA SA SY TR YE".split()},
    **{c: 'asia' for c in "AF AZ BD BT CN GE HK ID IN JP KG KH KP KR KZ LA LK MM MN MY NP PH PK SG TH TJ TM TW UZ VN".split()},
    **{c: 'africa' for c in "AO BF BI BJ BW CD CF CG CI CM CV DJ DZ ET GA GH GM GN GQ KE LR LY MA MG ML MR MU MW MZ NA NE NG RW SD SN SO SS SZ TD TG TN TZ UG ZA ZM ZW".split()},
    **{c: 'europe' for c in "RU UK XK".split()},
    **{c: 'asia' for c in "AM HK TW".split()},
    'US': 'us', 'CA': 'us',
    **{c: 'americas' for c in "AR BO BR CL CO CR CU DO EC GT HN JM MX NI PA PE PR PY SV UY VE".split()},
    **{c: 'oceania' for c in "AU FJ NZ PG".split()},
}
# iptv-org's categories are generous: radio, trailer channels and
# teleshopping end up in them. Better to lose a few than pollute the catalog.
EXCLUDE = re.compile(r"\b(radij|radio|fm|trailer|shop|teleshop|kids|"
                     r"cinema|movie|series|traffic|test|vertical)\b", re.I)
# What belongs to another wall when it shows up under "news".
OFF_TOPIC = {"news": re.compile(r"\b(music|musik|sport|weather|meteo)\b", re.I)}

LANG = {'eng': 'en', 'ita': 'it', 'fra': 'fr', 'spa': 'es', 'deu': 'de', 'por': 'pt',
        'ara': 'ar', 'rus': 'ru', 'zho': 'zh', 'jpn': 'ja', 'kor': 'ko', 'hin': 'hi',
        'tur': 'tr', 'ell': 'el', 'nld': 'nl', 'pol': 'pl', 'ukr': 'uk', 'ron': 'ro',
        'swe': 'sv', 'nor': 'no', 'dan': 'da', 'fin': 'fi', 'ces': 'cs', 'heb': 'he',
        'fas': 'fa', 'urd': 'ur', 'tha': 'th', 'vie': 'vi', 'ind': 'id', 'msa': 'ms',
        'cat': 'ca', 'isl': 'is', 'mya': 'my', 'bos': 'bs', 'hye': 'hy', 'bel': 'be',
        'sqi': 'sq', 'pus': 'ps', 'kaz': 'kk', 'mon': 'mn', 'ben': 'bn', 'srp': 'sr',
        'hrv': 'hr', 'bul': 'bg', 'hun': 'hu', 'slk': 'sk', 'slv': 'sl', 'lit': 'lt',
        'lav': 'lv', 'est': 'et', 'kat': 'ka', 'aze': 'az', 'uzb': 'uz', 'tam': 'ta',
        'tel': 'te', 'mar': 'mr', 'swa': 'sw', 'amh': 'am', 'som': 'so', 'khm': 'km'}
# Codes not listed above stay in their three-letter form: the browser can
# still name them (Intl.DisplayNames knows ISO 639-3), so nothing is lost.


def fetch(url, timeout=12, origin=None, limit=None):
    h = {"User-Agent": UA}
    if origin:
        h["Origin"] = origin
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout, context=CTX) as r:
        # Some "streams" are raw endless video, not a manifest: reading them to
        # the end would never return, the timeout only fires when data stops.
        raw = r.read(limit) if limit else r.read()
        enc = (r.headers.get("Content-Encoding") or "").lower()
        if enc == "gzip" or raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        elif enc == "deflate":
            raw = zlib.decompress(raw, -zlib.MAX_WBITS)
        return r.headers, raw.decode("utf-8", "replace")


def load(name, cache: Path):
    """The three API files weigh ~19 MB: download once and reuse."""
    f = cache / f"iptv-{name}.json"
    if f.exists():
        return json.loads(f.read_text())
    print(f"  downloading {name}.json …", file=sys.stderr)
    _, body = fetch(f"{API}/{name}.json", timeout=60)
    cache.mkdir(parents=True, exist_ok=True)
    f.write_text(body)
    return json.loads(body)


def slug(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return re.sub(r"-+", "-", s) or "channel"


def probe(url):
    """The three conditions for living in a static page, plus a sane manifest."""
    if not url.startswith("https://"):
        return None
    try:
        headers, body = fetch(url, timeout=8, origin="https://example.org", limit=512 * 1024)
    except Exception:
        return None
    if not headers.get("Access-Control-Allow-Origin"):
        return None
    if "#EXTM3U" not in body[:200]:
        return None
    heights = sorted({int(h) for h in re.findall(r"RESOLUTION=\d+x(\d+)", body)})
    return {"heights": heights}


def add_alternatives(current, channels, streams, probe_pool=40):
    """For channels already in the catalog, look for other streams from the same broadcaster.
    More sources per channel means a dead CDN does not take the tile down."""
    by_name = {}
    for ch in channels.values():
        if ch.get("closed"):
            continue
        for n in [ch["name"]] + (ch.get("alt_names") or []):
            by_name.setdefault(slug(n), set()).add(ch["id"])

    have = {st.get("url") for s in current["sources"] for st in s["streams"]}
    per_channel = {}
    for st in streams:
        if st.get("referrer") or st.get("user_agent"):
            continue
        per_channel.setdefault(st.get("channel"), []).append(st["url"])

    jobs = []
    for src in current["sources"]:
        for cid in by_name.get(slug(src["name"]), ()):
            for url in per_channel.get(cid, []):
                if url not in have and url.startswith("https://"):
                    jobs.append((src["id"], url))
                    have.add(url)

    print(f"possible alternative sources to try: {len(jobs)}", file=sys.stderr)
    with ThreadPoolExecutor(probe_pool) as ex:
        checked = list(ex.map(lambda j: (j[0], j[1], probe(j[1])), jobs))

    index = {s["id"]: s for s in current["sources"]}
    added = 0
    for sid, url, r in checked:
        if not r:
            continue
        src = index[sid]
        if len(src["streams"]) >= 3:      # three sources are enough: beyond that is dead weight
            continue
        src["streams"].append({"kind": "hls", "url": url, "via": "iptv-org"})
        added += 1
    return added


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="write to sources.json")
    ap.add_argument("--category", default="news", help="iptv-org category, i.e. the wall mode")
    ap.add_argument("--max", type=int, default=90, help="maximum number of sources to add")
    ap.add_argument("--per-country", type=int, default=3, help="per-country cap, so no country takes over")
    ap.add_argument("--cache", default="/tmp/iptv-cache")
    ap.add_argument("--alternatives", action="store_true",
                    help="add fallback sources to channels already present")
    args = ap.parse_args()
    cache = Path(args.cache)

    channels = {c["id"]: c for c in load("channels", cache)}
    feeds = load("feeds", cache)
    streams = load("streams", cache)

    feed_of = {}
    for f in feeds:
        if f.get("is_main") or f["channel"] not in feed_of:
            feed_of[f["channel"]] = f

    current = json.loads((ROOT / "sources.json").read_text())

    if args.alternatives:
        n = add_alternatives(current, channels, streams)
        print(f"\nalternative sources added: {n}")
        if args.write:
            (ROOT / "sources.json").write_text(json.dumps(current, indent=2, ensure_ascii=False) + "\n")
            tot = sum(len(s["streams"]) for s in current["sources"])
            print(f"sources.json: {tot} streams across {len(current['sources'])} sources")
        else:
            print("(preview — run again with --write)")
        return
    cat = args.category
    off_topic = OFF_TOPIC.get(cat)

    # The final word is scripts/curated/<category>.txt: candidates listed there
    # always get in, the others are only shown, so they can be judged. An id
    # that is already in the catalog simply joins this wall too.
    lst = CURATED / f"{cat}.txt"
    curated = ({l.split("#")[0].strip() for l in lst.read_text().splitlines()} - {""}
               if lst.exists() else set())
    tagged = []
    for src in current["sources"]:
        cats = src.setdefault("categories", ["news"])
        if src["id"] in curated and cat not in cats:
            cats.append(cat)
            tagged.append(src["id"])

    taken_ids = {s["id"] for s in current["sources"]}
    taken_urls = {st.get("url") for s in current["sources"] for st in s["streams"]}
    taken_names = {slug(s["name"]) for s in current["sources"]}

    # One channel, its first working stream. Local live news channels are countless:
    # the per-country cap keeps the wall international rather than, say, Indian.
    candidates = {}
    for s in streams:
        cid = s.get("channel")
        ch = channels.get(cid)
        if not ch or ch.get("closed") or ch.get("is_nsfw"):
            continue
        if cat not in (ch.get("categories") or []):
            continue
        if EXCLUDE.search(ch["name"]) or (off_topic and off_topic.search(ch["name"])):
            continue
        if s["url"] in taken_urls or s.get("referrer") or s.get("user_agent"):
            continue      # streams that require a referrer/UA do not work from a browser
        if s["url"].startswith("https://"):
            candidates.setdefault(cid, []).append(s)

    print(f"{cat} candidates from iptv-org: {len(candidates)}", file=sys.stderr)
    print("checking HTTPS + CORS + manifest …", file=sys.stderr)

    # A channel's first stream is often a dead mirror: try them in order.
    def first_working(item):
        cid, lst = item
        for s in lst:
            r = probe(s["url"])
            if r:
                return cid, s, r
        return cid, None, None

    items = list(candidates.items())
    with ThreadPoolExecutor(40) as ex:
        results = list(ex.map(first_working, items))

    good = [(cid, s, r) for cid, s, r in results if r]
    print(f"usable: {len(good)}/{len(items)}", file=sys.stderr)

    # Order: HD broadcasters first, then shorter names (main channels are
    # called "France 24", local variants are not).
    good.sort(key=lambda t: (-(max(t[2]["heights"]) if t[2]["heights"] else 0), len(channels[t[0]]["name"])))

    added, picked, per_country = [], [], {}
    for cid, s, r in good:
        ch = channels[cid]
        country = ch.get("country") or "??"
        listed = {slug(ch["name"]), f"{slug(ch['name'])}-{country.lower()}"} & curated
        if not listed and (len(added) >= args.max or per_country.get(country, 0) >= args.per_country):
            continue
        feed = feed_of.get(cid, {})
        tz = (feed.get("timezones") or ["UTC"])[0]
        code = (feed.get("languages") or [""])[0]
        lang = LANG.get(code, code)
        sid = slug(ch["name"])
        if sid in taken_names:
            continue          # already in the catalog, maybe via YouTube
        if sid in taken_ids:
            sid = f"{sid}-{country.lower()}"
        if sid in taken_ids:
            continue
        taken_ids.add(sid)
        per_country[country] = per_country.get(country, 0) + 1
        added.append({
            "id": sid, "name": ch["name"], "lang": lang, "country": country, "tz": tz,
            "tags": [AREA.get(country, "world")], "categories": [cat], "via": "iptv-org",
            "streams": [{"kind": "hls", "url": s["url"]}],
        })
        if listed:
            picked.append(added[-1])

    print(f"\ncandidates: {len(added)}, in {lst.relative_to(ROOT)}: {len(picked)} (marked *)")
    if tagged:
        print(f"already in the catalog, now also in '{cat}': {', '.join(tagged)}")
    for a in added:
        mark = "*" if a in picked else " "
        print(f" {mark} {a['country']:3} {a['id'][:38]:40} {a['tags'][0]}")

    if args.write:
        current["sources"].extend(picked)
        (ROOT / "sources.json").write_text(json.dumps(current, indent=2, ensure_ascii=False) + "\n")
        print(f"\nsources.json: {len(current['sources'])} sources in total")
    else:
        print("\n(preview — run again with --write to write)")


if __name__ == "__main__":
    main()
