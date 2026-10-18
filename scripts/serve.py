#!/usr/bin/env python3
"""Local static server for development: python's http.server, plus
`Cache-Control: no-cache`. Without it the browser keeps serving old ES
modules after an edit, even on reload (only the page itself is revalidated).

Usage: python3 scripts/serve.py [port]   (default 8080, bound to 127.0.0.1)
"""
import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    handler = functools.partial(NoCache, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Newswall  →  http://localhost:{port}")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
