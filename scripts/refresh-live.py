#!/usr/bin/env python3
"""
Checks every HLS stream of every source and writes live.json:
HTTPS, reachability, CORS for our origin (redirects and the first variant
included) and a real manifest.

Each stream gets one of three states. "dead" is only for faults the browser
would hit too, wherever it is: plain http, no CORS, not a manifest, a URL
that is gone. "unverified" is for answers that say nothing about the viewer:
the checker runs in one region (403/451 are often a geoblock) and a timeout
or a 5xx can be momentary. The page hides dead streams and tries the others.

A fault is dead only once it has lasted a day: until then the stream stays
unverified, with `failing_since`. One working check makes it ok again.

live.json is rewritten only when a state changes, so an unchanged catalog
makes no commit: `generated` is when the status last changed. The reason
alone does not count (a failing stream can time out one hour and answer 503
the next): it is the one seen at the last change.

No API key, no external dependencies: standard library only.
Meant to run in a GitHub Action and commit live.json.
"""
import gzip, json, re, socket, ssl, sys, urllib.error, urllib.parse, urllib.request, zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
CTX = ssl.create_default_context()
TIMEOUT = 15
# HTTP codes that mean the URL itself is wrong or gone, for everyone. The
# others (401/403/451, 429, 5xx) depend on who asks and when.
GONE = {400, 404, 405, 410}
# CDNs have bad moments too: a stream fails for this long before it is dead.
HOLD = timedelta(hours=24)
# CORS is checked for the page's own origin: some CDNs allow only listed sites.
ORIGIN = "https://tv.archimedix.net"


class NoCors(Exception):
    pass


def allows(headers):
    """Would the browser hand this answer to the page? `*` or our own origin."""
    return headers.get("Access-Control-Allow-Origin") in ("*", ORIGIN)


class CorsRedirects(urllib.request.HTTPRedirectHandler):
    """The browser checks CORS on every redirect, not only on the last answer."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allows(headers):
            raise NoCors(f"redirect {code} without CORS")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = urllib.request.build_opener(CorsRedirects, urllib.request.HTTPSHandler(context=CTX))


def fetch(url, headers, timeout=TIMEOUT):
    req = urllib.request.Request(url, headers=headers)
    with OPENER.open(req, timeout=timeout) as r:
        raw = r.read()
        # Some CDNs (NHK, for one) compress the manifest even when not asked
        # to: without this step they would look like broken streams.
        enc = (r.headers.get("Content-Encoding") or "").lower()
        if enc == "gzip" or raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        elif enc == "deflate":
            raw = zlib.decompress(raw, -zlib.MAX_WBITS)
        return r.url, r.headers, raw.decode("utf-8", "replace")


def dead(reason):
    return {"state": "dead", "reason": reason}


def unverified(reason):
    return {"state": "unverified", "reason": reason}


def load(url):
    """One manifest as the page would load it: (verdict, None) on failure,
    else (None, (final url, body))."""
    try:
        final, headers, body = fetch(url, headers={"User-Agent": UA, "Origin": ORIGIN})
    except NoCors as e:
        return dead(f"no CORS: {e}"), None
    except urllib.error.HTTPError as e:
        return (dead if e.code in GONE else unverified)(f"HTTP {e.code}"), None
    except urllib.error.URLError as e:
        # A name that does not resolve or a bad certificate fails in every
        # browser; a refused or reset connection may be a regional firewall.
        kind = dead if isinstance(e.reason, (socket.gaierror, ssl.SSLCertVerificationError)) else unverified
        return kind(f"unreachable ({type(e.reason).__name__})"), None
    except Exception as e:
        return unverified(f"unreachable ({type(e).__name__})"), None

    if not allows(headers):
        return dead("no CORS for this site: would need a proxy"), None
    if "#EXTM3U" not in body[:200]:
        return dead("response is not an HLS manifest"), None
    return None, (final, body)


def first_variant(final, body):
    """The first variant playlist of a master manifest, or None for a media one."""
    lines = [l.strip() for l in body.splitlines()]
    tag = next((i for i, l in enumerate(lines) if l.startswith("#EXT-X-STREAM-INF")), None)
    if tag is None:
        return None
    uri = next((l for l in lines[tag + 1:] if l and not l.startswith("#")), None)
    return uri and urllib.parse.urljoin(final, uri)


def check_hls(stream):
    """HTTPS + reachable + CORS: the three conditions for living in a static page.
    The first variant is loaded too: some CDNs open the master to everyone and
    keep the variants for their own site."""
    url = stream["url"]
    if url.startswith("http://"):
        # The URL itself says so: no reason to wait for HOLD.
        return {**dead("plain http: blocked as mixed content"), "final": True}
    fail, got = load(url)
    if fail:
        return fail
    final, body = got
    variant = first_variant(final, body)
    if variant:
        fail, _ = load(variant)
        if fail:
            return {**fail, "reason": f"variant: {fail['reason']}"}

    # Variant heights let the app lower the quality of secondary tiles.
    heights = sorted({int(h) for h in re.findall(r"RESOLUTION=\d+x(\d+)", body)})
    return {"state": "ok", "heights": heights}


def settle(r, prev, now):
    """This run's verdict, weighed against the stream's previous one."""
    if r["state"] == "ok":
        return r
    final = r.pop("final", False)
    since = (prev or {}).get("failing_since") or now.isoformat(timespec="seconds")
    r["failing_since"] = since
    if r["state"] == "dead" and not final and now - datetime.fromisoformat(since) < HOLD:
        r["state"] = "unverified"
    return r


def summarize(states):
    """A source is as good as its best stream; `use` is the one to start from."""
    for want in ("ok", "unverified"):
        use = next((i for i, r in enumerate(states) if r["state"] == want), None)
        if use is not None:
            return {"state": want, "use": use, "streams": states,
                    "reason": states[use].get("reason")}
    return {"state": "dead", "use": None, "streams": states, "reason": states[0]["reason"]}


def check(job):
    sid, idx, stream = job
    return sid, idx, check_hls(stream)


def verdicts(entries):
    """What a commit is worth: everything but the reasons."""
    strip = lambda r: {k: v for k, v in r.items() if k != "reason"}
    return {sid: {**strip(e), "streams": [strip(r) for r in e["streams"]]} for sid, e in entries.items()}


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

    path = ROOT / "live.json"
    try:
        before = json.loads(path.read_text()).get("entries", {})
    except (OSError, ValueError):
        before = {}

    # The history is kept by position: after reordering a source's streams in
    # sources.json, a failing stream may inherit another one's failing_since.
    now = datetime.now(timezone.utc)
    entries = {}
    for s in sources:
        prev = before.get(s["id"], {}).get("streams", [])
        states = [settle(per_source[s["id"]][i], prev[i] if i < len(prev) else None, now)
                  for i in range(len(s["streams"]))]
        entries[s["id"]] = summarize(states)

    count = {k: sum(r["state"] == k for r in entries.values()) for k in ("ok", "unverified", "dead")}
    print(f"{count['ok']} live, {count['unverified']} unverified, {count['dead']} dead "
          f"of {len(entries)} sources ({len(checked)} streams checked)")
    for i, r in entries.items():
        if r["state"] != "ok":
            print(f"  {'?' if r['state'] == 'unverified' else '✗'} {i}: {r['reason']}")

    if verdicts(before) == verdicts(entries):
        print("live.json unchanged")
    else:
        out = {"generated": now.isoformat(timespec="seconds"),
               "entries": entries}
        path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
        print("live.json updated")
    return 0 if count["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
