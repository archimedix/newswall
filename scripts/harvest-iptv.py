#!/usr/bin/env python3
"""
Fishes new sources out of public catalogs and adds them to sources.json.

Two catalogs: iptv-org (huge, permissive) and Free-TV/IPTV (small, only
channels officially free-to-air, one URL per channel). Free-TV entries carry
iptv-org channel ids in tvg-id, so they borrow iptv-org's metadata (categories,
language, time zone); the others fall back to their group and country.

iptv-org lists thousands of channels but does not say which ones work from a
static page: only what really holds up is kept here, i.e. HTTPS + CORS + a
valid manifest. Entries already in sources.json are left untouched, except
that a curated one can join another wall (its "categories" grows).

    python3 scripts/harvest-iptv.py                      # show the news candidates
    python3 scripts/harvest-iptv.py --category sports    # any iptv-org category = a wall mode
    python3 scripts/harvest-iptv.py --write              # add the ones in scripts/curated/<category>.txt
    python3 scripts/harvest-iptv.py --source free-tv     # same, from the Free-TV playlist

Options: --source iptv-org|free-tv, --category ID (default news), --max N (overall cap),
         --per-country N, --cache DIR, --alternatives
"""
import argparse, gzip, json, re, ssl, sys, unicodedata, urllib.request, urllib.error, zlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CURATED = ROOT / "scripts" / "curated"      # one <category>.txt per wall mode
API = "https://iptv-org.github.io/api"
FREETV = "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8"
YT_HEADERS = {"Cookie": "CONSENT=YES+cb.20210328-17-p0.en+FX+410", "Accept-Language": "en-US,en;q=0.9"}
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


def fetch(url, timeout=12, origin=None, limit=None, headers=None):
    h = {"User-Agent": UA, **(headers or {})}
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


# Free-TV groups that are walls in their own right; country groups say nothing
# about the content, there the iptv-org categories (via tvg-id) decide.
GROUP_CATEGORY = {"News": "news", "News (AR)": "news", "News (ES)": "news",
                  "Business": "business", "Weather": "weather", "Sports": "sports"}
# Free-TV marks: Ⓢ not HD, Ⓖ geo-blocked, Ⓨ YouTube, Ⓣ Twitch.
MARKS = re.compile(r"\s*[ⓈⒼⓎⓉ]")


def load_freetv(cache: Path):
    f = cache / "freetv-playlist.m3u8"
    if f.exists():
        return f.read_text()
    print("  downloading Free-TV playlist …", file=sys.stderr)
    _, body = fetch(FREETV, timeout=60)
    cache.mkdir(parents=True, exist_ok=True)
    f.write_text(body)
    return body


def parse_m3u(text):
    """[(attributes, display name, url)] of an extended M3U playlist."""
    out, info = [], None
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("#EXTINF"):
            head, _, title = line.partition(",")
            info = (dict(re.findall(r'([\w-]+)="([^"]*)"', head)), title.strip())
        elif line and not line.startswith("#") and info:
            out.append((*info, line))
            info = None
    return out


def entries_iptv(channels, feed_of, streams):
    """iptv-org streams in the common shape the harvest works on."""
    out = []
    for s in streams:
        ch = channels.get(s.get("channel"))
        if not ch or ch.get("closed") or ch.get("is_nsfw"):
            continue
        if s.get("referrer") or s.get("user_agent"):
            continue      # streams that require a referrer/UA do not work from a browser
        out.append(meta(ch, feed_of, {"key": ch["id"], "kind": "hls", "url": s["url"], "via": "iptv-org"}))
    return out


def meta(ch, feed_of, e):
    feed = feed_of.get(ch["id"], {})
    code = (feed.get("languages") or [""])[0]
    return {**e, "name": ch["name"], "id_name": ch["name"], "country": ch.get("country") or "??",
            "categories": ch.get("categories") or [], "lang": LANG.get(code, code),
            "tz": (feed.get("timezones") or ["UTC"])[0],
            "names": [ch["name"]] + (ch.get("alt_names") or [])}


def entries_freetv(text, channels, feed_of, countries, tz_of):
    """Free-TV entries in the same shape. YouTube ones keep their channel page URL:
    the channelId is resolved only for the entries that get probed."""
    out = []
    for attrs, title, url in parse_m3u(text):
        group = attrs.get("group-title", "")
        if group.startswith("VOD") or "Ⓖ" in title:
            continue      # recordings, and channels that only work inside one country
        if "youtube.com/" in url:
            kind = "youtube"
        elif re.search(r"twitch\.tv|dailymotion\.com", url):
            continue      # no player for these
        else:
            kind = "hls"
        name = MARKS.sub("", title).strip()
        e = {"kind": kind, "url": url, "via": "free-tv"}
        ch = channels.get(attrs.get("tvg-id", "").split("@")[0])
        if ch and not ch.get("closed") and not ch.get("is_nsfw"):
            e = meta(ch, feed_of, {**e, "key": ch["id"]})
            e["name"] = name      # Free-TV's display name is usually the cleaner one,
            e["names"].append(name)   # the id stays iptv-org's, so curated lists match both
        else:
            # tvg-id follows iptv-org's "Name.cc" even for channels iptv-org lacks
            cc = (attrs.get("tvg-country") or attrs.get("tvg-id", "").rpartition(".")[2] or "??")[:2].upper()
            code = (countries.get(cc, {}).get("languages") or [""])[0]
            e = {**e, "key": f"free-tv:{slug(name)}:{cc}", "name": name, "id_name": name, "country": cc,
                 "categories": [], "lang": LANG.get(code, code), "tz": tz_of.get(cc, "UTC"),
                 "names": [name]}
        if group in GROUP_CATEGORY and GROUP_CATEGORY[group] not in e["categories"]:
            e["categories"] = e["categories"] + [GROUP_CATEGORY[group]]
        out.append(e)
    return out


def zones_by_country(timezones):
    """A plausible time zone per country, for channels iptv-org does not know.
    Zones listing the country first are its own, the others are shared."""
    tz = {}
    for z in timezones:
        cs = z.get("countries") or []
        if cs and cs[0] not in tz:
            tz[cs[0]] = z["id"]
    for z in timezones:
        for c in z.get("countries") or []:
            tz.setdefault(c, z["id"])
    return tz


def slug(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return re.sub(r"-+", "-", s) or "channel"


def probe(url, kind="hls"):
    """The three conditions for living in a static page, plus a sane manifest.
    For a YouTube channel page: its channelId (refresh-live.py checks the live)."""
    if kind == "youtube":
        return probe_youtube(url)
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


def probe_youtube(url):
    page = re.sub(r"/(live|streams|videos)/?$", "", url.split("?")[0])
    m = re.search(r"/channel/(UC[\w-]{22})", page)
    if m:
        return {"channelId": m.group(1), "heights": []}
    try:
        _, html = fetch(page, timeout=10, headers=YT_HEADERS, limit=2 * 1024 * 1024)
    except Exception:
        return None
    m = re.search(r'"externalId":"(UC[\w-]{22})"', html) or \
        re.search(r'rel="canonical" href="https://www\.youtube\.com/channel/(UC[\w-]{22})"', html)
    return {"channelId": m.group(1), "heights": []} if m else None


def stream_of(e, r):
    if e["kind"] == "youtube":
        return {"kind": "youtube", "channelId": r["channelId"]}
    return {"kind": "hls", "url": e["url"]}


def add_alternatives(current, entries, probe_pool=40):
    """For channels already in the catalog, look for other streams from the same broadcaster.
    More sources per channel means a dead CDN does not take the tile down."""
    by_name = {}
    for e in entries:
        for n in e["names"]:
            by_name.setdefault(slug(n), []).append(e)

    have = {st.get("url") or st.get("channelId") for s in current["sources"] for st in s["streams"]}
    jobs = []
    for src in current["sources"]:
        for e in by_name.get(slug(src["name"]), ()):
            if e["url"] not in have and (e["kind"] == "youtube" or e["url"].startswith("https://")):
                jobs.append((src["id"], e))
                have.add(e["url"])

    print(f"possible alternative sources to try: {len(jobs)}", file=sys.stderr)
    with ThreadPoolExecutor(probe_pool) as ex:
        checked = list(ex.map(lambda j: (j[0], j[1], probe(j[1]["url"], j[1]["kind"])), jobs))

    index = {s["id"]: s for s in current["sources"]}
    added = 0
    for sid, e, r in checked:
        if not r:
            continue
        src = index[sid]
        st = stream_of(e, r)
        if len(src["streams"]) >= 3:      # three sources are enough: beyond that is dead weight
            continue
        if st.get("channelId") and st["channelId"] in have:
            continue      # a handle URL resolving to a channel already listed
        have.add(st.get("channelId"))
        src["streams"].append({**st, "via": e["via"]})
        added += 1
    return added


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="write to sources.json")
    ap.add_argument("--source", choices=["iptv-org", "free-tv"], default="iptv-org",
                    help="catalog to harvest from")
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

    if args.source == "free-tv":
        countries = {c["code"]: c for c in load("countries", cache)}
        tz_of = zones_by_country(load("timezones", cache))
        entries = entries_freetv(load_freetv(cache), channels, feed_of, countries, tz_of)
    else:
        entries = entries_iptv(channels, feed_of, streams)

    current = json.loads((ROOT / "sources.json").read_text())

    if args.alternatives:
        n = add_alternatives(current, entries)
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

    taken_yt = {st.get("channelId") for s in current["sources"] for st in s["streams"]} - {None}

    def ids_of(e):
        return {slug(e["id_name"]), f"{slug(e['id_name'])}-{e['country'].lower()}"}

    # One channel, its first working stream. Local live news channels are countless:
    # the per-country cap keeps the wall international rather than, say, Indian.
    # A Free-TV channel without a category of its own is in only if curated.
    candidates = {}
    for e in entries:
        if cat not in e["categories"] and not ids_of(e) & curated:
            continue
        if EXCLUDE.search(e["name"]) or (off_topic and off_topic.search(e["name"])):
            continue
        if e["url"] in taken_urls:
            continue
        if e["kind"] == "youtube" or e["url"].startswith("https://"):
            candidates.setdefault(e["key"], []).append(e)

    print(f"{cat} candidates from {args.source}: {len(candidates)}", file=sys.stderr)
    print("checking HTTPS + CORS + manifest …", file=sys.stderr)

    # A channel's first stream is often a dead mirror: try them in order.
    def first_working(item):
        key, lst = item
        for e in lst:
            r = probe(e["url"], e["kind"])
            if r:
                return key, e, r
        return key, None, None

    items = list(candidates.items())
    with ThreadPoolExecutor(40) as ex:
        results = list(ex.map(first_working, items))

    good = [(key, e, r) for key, e, r in results if r]
    print(f"usable: {len(good)}/{len(items)}", file=sys.stderr)

    # Order: HD broadcasters first, then shorter names (main channels are
    # called "France 24", local variants are not).
    good.sort(key=lambda t: (-(max(t[2]["heights"]) if t[2]["heights"] else 0), len(t[1]["name"])))

    added, picked, per_country = [], [], {}
    for key, e, r in good:
        country, lang, tz = e["country"], e["lang"], e["tz"]
        listed = ids_of(e) & curated
        if not listed and (len(added) >= args.max or per_country.get(country, 0) >= args.per_country):
            continue
        sid = slug(e["id_name"])
        if any(slug(n) in taken_names for n in e["names"]) or r.get("channelId") in taken_yt:
            continue          # already in the catalog, maybe under another name or via YouTube
        if sid in taken_ids:
            sid = f"{sid}-{country.lower()}"
        if sid in taken_ids:
            continue
        taken_ids.add(sid)
        per_country[country] = per_country.get(country, 0) + 1
        added.append({
            "id": sid, "name": e["name"], "lang": lang, "country": country, "tz": tz,
            "tags": [AREA.get(country, "world")], "categories": [cat], "via": e["via"],
            "streams": [stream_of(e, r)],
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
