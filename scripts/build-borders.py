#!/usr/bin/env python3
"""Country outlines for the globe, from Natural Earth 1:50m (public domain).

Writes assets/earth/borders.json: {"GB": [[lon, lat, lon, lat, ...], ...], ...},
one flat ring per polygon, coordinates rounded to 0.01°. Run it again only to
move to a newer Natural Earth release.

The ground texture next to it is built by scripts/build-earth.py.
"""
import json
import pathlib
import urllib.request

SRC = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
       "v5.1.2/geojson/ne_50m_admin_0_countries.geojson")
OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "earth" / "borders.json"


def main():
    with urllib.request.urlopen(SRC, timeout=60) as r:
        data = json.load(r)
    out = {}
    for f in data["features"]:
        p = f["properties"]
        # ISO_A2 is "-99" for France and Norway; the "EH" variant fills those in.
        cc = next((c for c in (p.get("ISO_A2_EH"), p.get("ISO_A2")) if c and c != "-99"), None)
        if not cc:
            continue
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        rings = out.setdefault(cc, [])
        for poly in polys:
            ring = poly[0]       # outer ring only: holes are lakes and enclaves
            rings.append([round(v, 2) for pt in ring for v in pt])
    OUT.write_text(json.dumps(out, separators=(",", ":"), sort_keys=True))
    print(f"{len(out)} countries -> {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
