#!/usr/bin/env python3
"""
Downloads a logo for every channel in sources.json, for the globe's still cards.

The logos come from iptv-org's logos.json, which lists several per channel
with their size and format. Standard library only, so nothing can be resized
here: the script picks the variant that is already the right size (the
smallest at least MIN_W pixels wide) and refuses anything heavier than MAX_KB.
The browser scales it down when it draws the card.

A source is matched to an iptv-org channel by country and name (the catalog's
ids are slugs of iptv-org names); the few that do not match are in MANUAL.

    python3 scripts/fetch-logos.py              # show what would be downloaded
    python3 scripts/fetch-logos.py --write      # download into assets/logos/ and write logos.json
    python3 scripts/fetch-logos.py --write --refresh   # download again those already there

Files go in assets/logos/<source id>.<ext>; assets/logos/logos.json maps each
source id to its file. Logos are the broadcasters' trademarks, shown only to
tell the channels apart.
"""
import argparse, json, re, ssl, sys, unicodedata, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "logos"
API = "https://iptv-org.github.io/api"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
CTX = ssl.create_default_context()
MIN_W = 160          # a still card draws the logo about 70 px tall: 160 px wide is plenty
MAX_KB = 120
EXT = {"PNG": "png", "JPEG": "jpg", "WebP": "webp", "SVG": "svg"}
# iptv-org writes "UK" for the United Kingdom; the catalog keeps ISO 3166.
ISO = {"UK": "GB"}

# Sources whose name differs from iptv-org's: source id -> iptv-org channel id.
MANUAL = {
    "aljazeera-en": "AlJazeera.qa",
    "france24-en": "France24.fr",
    "dw-news": "DW.de",
    "dw-espanol": "DW.de",
    "abc-au": "ABCNews.au",
    "abc-us": "ABCNewsLive.us",
    "cbs-news": "CBSNews247.us",
    "current-time": "CurrentTimeTV.cz",
    "reuters": "ReutersTV.us",
    # Placed where its newsroom is, not where iptv-org files it.
    "voa-tv-china": "VoATVChina.cn",
}


def slug(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return re.sub(r"-+", "-", s)


def get(url, timeout=20, limit=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.read(limit + 1 if limit else -1)


def load(name, cache):
    f = cache / f"iptv-{name}.json"
    if f.exists():
        return json.loads(f.read_text())
    print(f"  downloading {name}.json …", file=sys.stderr)
    body = get(f"{API}/{name}.json", timeout=60)
    cache.mkdir(parents=True, exist_ok=True)
    f.write_bytes(body)
    return json.loads(body)


def candidates(logos):
    """Best first: the channel's own logo (no feed), horizontal or square,
    raster before SVG (an SVG without a size draws as nothing on a canvas),
    then the smallest that is still wide enough."""
    ok = [l for l in logos if l.get("format") in EXT and l.get("width") and l.get("height")
          and "vertical" not in (l.get("tags") or []) and 0.7 <= l["width"] / l["height"] <= 4.5]
    return sorted(ok, key=lambda l: (l.get("feed") is not None, l["format"] == "SVG",
                                     l["width"] < MIN_W, l["width"] if l["width"] >= MIN_W else -l["width"]))


def looks_like(fmt, data):
    if fmt == "PNG":
        return data[:8] == b"\x89PNG\r\n\x1a\n"
    if fmt == "JPEG":
        return data[:3] == b"\xff\xd8\xff"
    if fmt == "WebP":
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return b"<svg" in data[:2048]


def fetch_logo(src, options):
    """The first candidate that downloads, is what it claims to be, and is light enough."""
    for l in options:
        try:
            data = get(l["url"], limit=MAX_KB * 1024)
        except Exception:
            continue
        if len(data) > MAX_KB * 1024 or not looks_like(l["format"], data):
            continue
        return l, data
    return None, None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--write", action="store_true", help="download and write assets/logos/")
    ap.add_argument("--refresh", action="store_true", help="download again the logos already there")
    ap.add_argument("--cache", default="/tmp/iptv-cache")
    args = ap.parse_args()

    sources = json.loads((ROOT / "sources.json").read_text())["sources"]
    cache = Path(args.cache)
    channels, logos = load("channels", cache), load("logos", cache)

    by_channel = {}
    for l in logos:
        by_channel.setdefault(l["channel"], []).append(l)
    by_name = {}
    for c in channels:
        cc = ISO.get(c["country"], c["country"])
        for n in [c["name"], *c.get("alt_names", [])]:
            by_name.setdefault((cc, slug(n)), []).append(c["id"])

    manifest_file = OUT / "logos.json"
    manifest = json.loads(manifest_file.read_text()) if manifest_file.exists() else {}
    todo, missing = [], []
    for s in sources:
        ids = [MANUAL[s["id"]]] if s["id"] in MANUAL else \
            by_name.get((s["country"], s["id"])) or by_name.get((s["country"], slug(s["name"]))) or []
        options = candidates([l for i in ids for l in by_channel.get(i, [])])
        if not options:
            missing.append(s["id"])
        elif args.refresh or s["id"] not in manifest or not (OUT / manifest[s["id"]]).exists():
            todo.append((s, options))

    print(f"{len(sources)} sources: {len(manifest)} logos already there, {len(todo)} to fetch, "
          f"{len(missing)} without a logo in iptv-org")
    if missing:
        print("  no logo:", ", ".join(missing))
    if not args.write:
        for s, options in todo:
            l = options[0]
            print(f"  {s['id']:32} {l['format']:4} {l['width']}x{l['height']}  {l['url']}")
        print("\n(preview: --write to download)")
        return

    OUT.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(lambda t: (t[0], *fetch_logo(*t)), todo))
    failed = []
    for s, l, data in results:
        if not data:
            failed.append(s["id"])
            continue
        old = manifest.get(s["id"])
        name = f"{s['id']}.{EXT[l['format']]}"
        if old and old != name:
            (OUT / old).unlink(missing_ok=True)
        (OUT / name).write_bytes(data)
        manifest[s["id"]] = name

    # Logos of sources no longer in the catalog go too.
    ids = {s["id"] for s in sources}
    for sid in [k for k in manifest if k not in ids]:
        (OUT / manifest.pop(sid)).unlink(missing_ok=True)
    manifest_file.write_text(json.dumps(dict(sorted(manifest.items())), indent=1) + "\n")
    print(f"written: {len(results) - len(failed)}, failed: {len(failed)}"
          + (f" ({', '.join(failed)})" if failed else ""))


if __name__ == "__main__":
    main()
