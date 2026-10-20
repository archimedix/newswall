#!/usr/bin/env python3
"""
Checks every HLS stream of every source and writes live.json:
HTTPS, reachability, CORS for our origin (redirects included) and a real
manifest, down to a first media segment and a playlist that moves: what the
browser would load in its first seconds.

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
import gzip, json, re, socket, ssl, sys, time, urllib.error, urllib.parse, urllib.request, zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
CTX = ssl.create_default_context()
TIMEOUT = 15
# A segment is read only this far: enough to know it is there.
PEEK = 4096
# The playlist is read again after one target duration (capped at this),
# up to MOVES times: some servers are late, some add segments in bursts.
MAX_WAIT = 20
MOVES = 3
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


def fetch(url, headers, timeout=TIMEOUT, limit=None):
    req = urllib.request.Request(url, headers=headers)
    with OPENER.open(req, timeout=timeout) as r:
        if limit:
            return r.url, r.headers, r.read(limit)
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


def get(url, limit=None):
    """One request as the page would make it: (verdict, None) on failure,
    else (None, (final url, body))."""
    try:
        final, headers, body = fetch(url, headers={"User-Agent": UA, "Origin": ORIGIN}, limit=limit)
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
    return None, (final, body)


def load(url):
    """A playlist: like get(), and it must be one."""
    fail, got = get(url)
    if not fail and "#EXTM3U" not in got[1][:200]:
        fail = dead("response is not an HLS manifest")
    return fail, got


def uris(body):
    """The URIs of a playlist, in order: the first plain line after each
    variant or segment tag (as hls.js reads them, so a malformed tag line
    elsewhere is not taken for one)."""
    out, want = [], False
    for l in (l.strip() for l in body.splitlines()):
        if l.startswith(("#EXT-X-STREAM-INF", "#EXTINF")):
            want = True
        elif want and l and not l.startswith("#"):
            out.append(l)
            want = False
    return out


def position(body):
    """Where a live playlist is: its media sequence and its last segment."""
    seq = re.search(r"#EXT-X-MEDIA-SEQUENCE:\s*(\d+)", body)
    return (seq and seq.group(1), (uris(body) or [None])[-1])


def labelled(fail, what):
    return {**fail, "reason": f"{what}: {fail['reason']}"}


def check_hls(stream):
    """HTTPS + reachable + CORS: the three conditions for living in a static page.
    Checked all the way down, because some CDNs open the master playlist to
    everyone and keep the variants or the segments for their own site, and a
    stream can answer while standing still."""
    url = stream["url"]
    if url.startswith("http://"):
        # The URL itself says so: no reason to wait for HOLD.
        return {**dead("plain http: blocked as mixed content"), "final": True}
    fail, got = load(url)
    if fail:
        return fail
    final, master = got

    # A master playlist points to variants; a media playlist is its own.
    media_url, media = final, master
    if "#EXT-X-STREAM-INF" in master:
        variant = (uris(master) or [None])[0]
        if not variant:
            return dead("master playlist without variants")
        fail, got = load(urllib.parse.urljoin(final, variant))
        if fail:
            return labelled(fail, "variant")
        media_url, media = got

    # The segment hls.js starts from: three before the live edge. The first
    # may have expired already, the last may not be on the CDN yet.
    segments = uris(media)
    if not segments:
        return dead("playlist without segments")
    segment = segments[max(0, len(segments) - 3)]
    fail, _ = get(urllib.parse.urljoin(media_url, segment), limit=PEEK)
    if fail:
        return labelled(fail, "segment")

    # A live playlist moves on every target duration; a finished one
    # (ENDLIST) is a recording and stands still by design.
    if "#EXT-X-ENDLIST" not in media:
        td = re.search(r"#EXT-X-TARGETDURATION:\s*(\d+)", media)
        wait = min(int(td.group(1)) + 1 if td else 7, MAX_WAIT)
        for _ in range(MOVES):
            time.sleep(wait)
            fail, got = load(media_url)
            if fail:
                return labelled(fail, "variant")
            if position(got[1]) != position(media):
                break
        else:
            return dead("playlist not moving: the stream is stuck")

    # Variant heights let the app lower the quality of secondary tiles.
    heights = sorted({int(h) for h in re.findall(r"RESOLUTION=\d+x(\d+)", master)})
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

    # Most of a check is waiting for the playlist to move: many at once.
    with ThreadPoolExecutor(48) as ex:
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
