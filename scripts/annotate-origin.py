#!/usr/bin/env python3
"""
Records, for every source, where the stream really comes from.

The principle: nothing is attributed that cannot be proven. Host and the way
the stream was found are hard facts and are always recorded; the broadcaster
label only appears when the domain makes it obvious, or when the stream has a
"page": the broadcaster's own page that publishes that URL, which is proof
enough. The rest stays "cdn" or "unknown", which is honest information rather
than a guess.

    python3 scripts/annotate-origin.py [--write]
"""
import argparse, json, re, unicodedata
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent

# Technical delivery: it tells how the stream arrives, not who publishes it.
CDN = re.compile(r"(cloudfront\.net|akamaized\.net|akamaihd\.net|amagi\.tv|mediatailor|"
                 r"mediapackage|wurl\.com|fastly|llnwd|edgecast|broadpeak|kwikmotion|"
                 r"easybroadcast|azureedge|cdn77|bunnycdn|streamlock|wowza|mangomolo|"
                 r"mgmlcdn|cdnvideo\.ru|enetres|mdstrm|tulix|gostreaming|medonecdn|"
                 r"cdnbridge|live-tv\.cloud|dai\.google\.com|uplink\.kz|cdn\.cra\.cz)", re.I)

# Third parties rebroadcasting someone else's feed: always flag them.
# Personal pages and redirect services: there is no broadcaster behind these,
# and viewers have a right to know.
RELAY = re.compile(r"(workers\.dev|bozztv|jmp2\.uk|short\.gy|onrender\.com|xemzi|"
                   r"\.xyz|0472\.org|fastpublish|tangotv|malingtv|voidnet|badinan|"
                   r"github\.io|githubusercontent|glitch\.me|repl\.co|herokuapp)", re.I)

# Broadcasters recognisable by domain, where the name alone is not enough.
KNOWN = {
    "getaj.net": "Al Jazeera", "thehlive.com": "Al Jazeera",
    "cgtn.com": "CGTN", "rttv.com": "RT", "trt.com.tr": "TRT",
    "france24.com": "France 24", "cbsnews.com": "CBS News",
    "alarabiya.net": "Al Arabiya", "pbs.org": "NHK World via PBS",
    "intoday.in": "India Today", "3catdirectes.cat": "3Cat",
    "beltelecom.by": "Beltelecom", "cctvplus.com": "CCTV+",
    "ktv.go.kr": "KTV Korea", "visir.is": "Vísir", "telewebion.ir": "Telewebion",
    "broadpeak-aas.com": "ERT",
}

# Operators that rebroadcast other channels but whose name we do know:
# Antik is a Slovak ISP, not the broadcaster of Euronews or TRT World.
RELAY_KNOWN = {"antik.sk": "Antik Telecom"}


def host_of(url):
    return (urlparse(url).hostname or "").lower()


def registrable(host):
    """Second-level domain, accounting for suffixes like .co.uk."""
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] in {"co", "com", "org", "net", "gov", "go", "ac"}:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def classify(stream, name, via):
    src = {"name": name}
    via = stream.get("via", via)      # a fallback added later may come from elsewhere
    host = host_of(stream["url"])
    dom = registrable(host)
    out = {"host": host, "via": via}

    for suffix, label in KNOWN.items():
        if host.endswith(suffix):
            return {**out, "kind": "broadcaster", "label": label}

    # Found on the broadcaster's own live page: published by them, whatever the CDN.
    if stream.get("page"):
        return {**out, "kind": "broadcaster", "label": registrable(host_of(stream["page"]))}

    for suffix, label in RELAY_KNOWN.items():
        if host.endswith(suffix):
            return {**out, "kind": "rebroadcast", "label": label}

    if RELAY.search(host):
        return {**out, "kind": "rebroadcast", "label": dom}

    # If the domain contains the channel name, it is the broadcaster itself.
    n = norm(src["name"])
    words = [w for w in re.split(r"[^A-Za-z0-9]+", src["name"]) if w]
    acronym = norm("".join(w[0] for w in words)) if len(words) > 1 else ""
    first = norm(words[0]) if words else ""
    nh, nd = norm(host), norm(dom)
    if (len(n) >= 4 and (n[:8] in nh or nd.startswith(n[:6]))
            or (len(first) >= 4 and nd.startswith(first))
            or (len(acronym) >= 3 and nd.startswith(acronym))):
        return {**out, "kind": "broadcaster", "label": dom}

    if CDN.search(host):
        return {**out, "kind": "cdn", "label": dom}

    return {**out, "kind": "unknown", "label": dom}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    data = json.loads((ROOT / "sources.json").read_text())
    counts = {}
    for src in data["sources"]:
        via = src.get("via", "curated")
        for stream in src["streams"]:
            stream["origin"] = classify(stream, src["name"], via)
            k = stream["origin"]["kind"]
            counts[k] = counts.get(k, 0) + 1

    for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {v:3}  {k}")

    if args.write:
        (ROOT / "sources.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        print("\nsources.json updated")
    else:
        print("\n(preview — run again with --write)")


if __name__ == "__main__":
    main()
