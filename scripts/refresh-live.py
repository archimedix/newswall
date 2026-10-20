#!/usr/bin/env python3
"""
Checks every HLS stream of every source and writes live.json:
HTTPS, reachability, CORS headers and a real manifest.

No API key, no external dependencies: standard library only.
Meant to run in a GitHub Action and commit live.json.
"""
import gzip, json, re, ssl, sys, urllib.request, urllib.error, zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
CTX = ssl.create_default_context()
TIMEOUT = 15


def fetch(url, headers, timeout=TIMEOUT):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        raw = r.read()
        # Some CDNs (NHK, for one) compress the manifest even when not asked
        # to: without this step they would look like broken streams.
        enc = (r.headers.get("Content-Encoding") or "").lower()
        if enc == "gzip" or raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        elif enc == "deflate":
            raw = zlib.decompress(raw, -zlib.MAX_WBITS)
        return r.status, r.headers, raw.decode("utf-8", "replace")


def check_hls(stream):
    """HTTPS + reachable + CORS: the three conditions for living in a static page."""
    url = stream["url"]
    if url.startswith("http://"):
        return {"ok": False, "reason": "plain http: blocked as mixed content"}
    try:
        status, headers, body = fetch(url, headers={"User-Agent": UA, "Origin": "https://example.org"})
    except urllib.error.HTTPError as e:
        return {"ok": False, "reason": f"HTTP {e.code}"}
    except Exception as e:
        return {"ok": False, "reason": f"unreachable ({type(e).__name__})"}

    if not headers.get("Access-Control-Allow-Origin"):
        return {"ok": False, "reason": "no CORS: would need a proxy"}
    if "#EXTM3U" not in body[:200]:
        return {"ok": False, "reason": "response is not an HLS manifest"}

    # Variant heights let the app lower the quality of secondary tiles.
    heights = sorted({int(h) for h in re.findall(r"RESOLUTION=\d+x(\d+)", body)})
    return {"ok": True, "heights": heights}


def check(job):
    sid, idx, stream = job
    return sid, idx, check_hls(stream)


def main():
    sources = json.loads((ROOT / "sources.json").read_text())["sources"]
    jobs = [(s["id"], i, st) for s in sources for i, st in enumerate(s["streams"])]

    with ThreadPoolExecutor(16) as ex:
        checked = list(ex.map(check, jobs))

    # Each source reports the state of all its streams: the app starts from
    # the first one that works, so a dead CDN does not take the channel down.
    per_source = {}
    for sid, idx, r in checked:
        per_source.setdefault(sid, {})[idx] = r

    entries = {}
    for s in sources:
        states = [per_source[s["id"]][i] for i in range(len(s["streams"]))]
        first_ok = next((i for i, r in enumerate(states) if r["ok"]), None)
        entries[s["id"]] = {
            "ok": first_ok is not None,
            "use": first_ok,
            "streams": states,
            "reason": None if first_ok is not None else states[0].get("reason"),
        }

    out = {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "entries": entries}
    (ROOT / "live.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")

    ok = [i for i, r in entries.items() if r["ok"]]
    fallback = [i for i, r in entries.items() if r["ok"] and r["use"] > 0]
    print(f"live.json updated — {len(ok)}/{len(entries)} sources live "
          f"({len(checked)} streams checked, {len(fallback)} served by a fallback)")
    for i, r in entries.items():
        if not r["ok"]:
            print(f"  ✗ {i}: {r['reason']}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
