#!/usr/bin/env python3
"""The globe's ground, packed into one JPEG per size (public domain sources).

Writes assets/earth/earth-8k.jpg (8192x4096, desktops) and earth-4k.jpg
(4096x2048, phones and small GPUs): three maps, one per colour channel, since
the shader needs one number from each. Next to them day-8k.jpg and day-4k.jpg,
the Blue Marble's own colours for the lit side.

  R  ground tone: 0 on water, 16..255 = brightness of the land
     Blue Marble Next Generation, December 2004, no bathymetry
     https://eoimages.gsfc.nasa.gov/images/imagerecords/74000/74218/world.200412.3x21600x10800.jpg
  G  elevation, 0..255 (the shader shades the relief with the real sun)
     GEBCO 2008 via NASA Visible Earth
     https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73934/gebco_08_rev_elev_21600x10800.png
  B  city lights
     Black Marble 2016, 3 km
     https://eoimages.gsfc.nasa.gov/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg

Saved with 4:4:4 chroma, or the channels would bleed into each other.

A one-off, run by hand to rebuild the assets: unlike the other scripts it
needs Pillow and numpy (`pip install pillow numpy`), and the Action never
runs it. Usage: build-earth.py DIR, where DIR holds the three downloads.
"""

import pathlib
import sys

import numpy as np
from PIL import Image, ImageFilter

Image.MAX_IMAGE_PIXELS = None
OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "earth"
SIZES = {"8k": 8192, "4k": 4096}


def load(path, w, mode, blur=0):
    img = Image.open(path).convert(mode).resize((w, w // 2), Image.LANCZOS)
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    return np.asarray(img, dtype=np.float32) / 255


def main(src):
    src = pathlib.Path(src)
    for size, w in SIZES.items():
        day = load(src / "world.200412.3x21600x10800.jpg", w, "RGB")
        # The colours as they are: a picture, so ordinary 4:2:0 chroma will do.
        out = OUT / f"day-{size}.jpg"
        Image.fromarray((day * 255).round().astype(np.uint8), "RGB").save(out, quality=84, optimize=True, progressive=True)
        print(f"{out.name}: {w}x{w // 2}, {out.stat().st_size / 1e6:.1f} MB")
        r, g, b = day[..., 0], day[..., 1], day[..., 2]
        lum = 0.3 * r + 0.59 * g + 0.11 * b
        # Blue Marble oceans are blue and dark: water is where blue wins.
        water = np.clip((b - np.maximum(r, g) - 0.005) / 0.03, 0, 1)
        land = (16 + 239 * np.clip(lum * 1.15, 0, 1)) * (1 - water)
        # Softened a little: its 256 steps would ripple the shading of the plains.
        elev = load(src / "gebco_08_rev_elev_21600x10800.png", w, "L", blur=w / 4096) * 255
        # The dark sea is not black in the Black Marble: its floor goes.
        lights = np.clip(load(src / "BlackMarble_2016_3km.jpg", w, "L") - 0.04, 0, 1) / 0.96 * 255
        packed = np.stack([land, elev, lights], axis=-1).round().clip(0, 255).astype(np.uint8)
        out = OUT / f"earth-{size}.jpg"
        Image.fromarray(packed, "RGB").save(out, quality=86, subsampling=0, optimize=True, progressive=True)
        print(f"{out.name}: {w}x{w // 2}, {out.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
