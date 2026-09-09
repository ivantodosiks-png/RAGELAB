"""Rebuild operator HUD silhouette: tight joints, arms pulled in."""
from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] if False else Path.cwd()
SRC = ROOT / "assets" / "hud" / "ud.png"
OUT = ROOT / "client" / "public" / "hud" / "body"
ASSET_OUT = ROOT / "assets" / "hud" / "body"

src = Image.open(SRC).convert("RGBA")
a = np.array(src)
mask = (a[:, :, 3] > 40) & (a[:, :, :3].astype(np.int16).sum(axis=2) > 40)
h, w = mask.shape
vis = np.zeros_like(mask, dtype=bool)
comps: list[dict] = []
for y in range(h):
    for x in np.where(mask[y])[0]:
        if vis[y, x]:
            continue
        q = deque([(y, x)])
        vis[y, x] = True
        pixels: list[tuple[int, int]] = []
        while q:
            cy, cx = q.popleft()
            pixels.append((cy, cx))
            for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not vis[ny, nx]:
                    vis[ny, nx] = True
                    q.append((ny, nx))
        if len(pixels) < 80:
            continue
        ys = [p[0] for p in pixels]
        xs = [p[1] for p in pixels]
        comps.append(
            {
                "pixels": pixels,
                "xmin": min(xs),
                "xmax": max(xs),
                "ymin": min(ys),
                "ymax": max(ys),
                "cx": (min(xs) + max(xs)) // 2,
                "cy": (min(ys) + max(ys)) // 2,
                "n": len(pixels),
            }
        )

named: dict[str, dict] = {}
for c in comps:
    cx, cy, n = c["cx"], c["cy"], c["n"]
    if cy < 180 and 480 < cx < 740:
        named["head"] = c
    elif 200 < cy < 520 and 500 < cx < 720 and n > 40000:
        named["chest"] = c
    elif 560 < cy < 640 and 500 < cx < 720:
        named["belt"] = c
    elif 620 < cy < 850 and 500 < cx < 720 and n > 20000:
        named["stomach"] = c
    elif 250 < cy < 420 and cx < 450:
        named["armLu"] = c
    elif 250 < cy < 420 and cx > 750:
        named["armRu"] = c
    elif 450 < cy < 580 and cx < 350:
        named["armLf"] = c
    elif 450 < cy < 580 and cx > 850:
        named["armRf"] = c
    elif 600 < cy < 760 and cx < 320:
        named["armLg"] = c
    elif 600 < cy < 760 and cx > 900:
        named["armRg"] = c
    elif 820 < cy < 970 and cx < 600:
        named["legLt"] = c
    elif 820 < cy < 970 and cx > 600:
        named["legRt"] = c
    elif 970 < cy < 1120 and cx < 620:
        named["legLk"] = c
    elif 970 < cy < 1120 and cx > 620:
        named["legRk"] = c
    elif cy > 1120 and cx < 620:
        named["legLb"] = c
    elif cy > 1120 and cx > 620:
        named["legRb"] = c

missing = [k for k in [
    "head", "chest", "belt", "stomach",
    "armLu", "armLf", "armLg", "armRu", "armRf", "armRg",
    "legLt", "legLk", "legLb", "legRt", "legRk", "legRb",
] if k not in named]
if missing:
    raise SystemExit(f"missing parts: {missing}")


def extract(c: dict) -> Image.Image:
    pad = 2
    x0, y0 = max(0, c["xmin"] - pad), max(0, c["ymin"] - pad)
    x1, y1 = min(w - 1, c["xmax"] + pad), min(h - 1, c["ymax"] + pad)
    crop = a[y0 : y1 + 1, x0 : x1 + 1].copy()
    local = np.zeros((y1 - y0 + 1, x1 - x0 + 1), dtype=bool)
    for py, px in c["pixels"]:
        local[py - y0, px - x0] = True
    dil = local.copy()
    dil[1:, :] |= local[:-1, :]
    dil[:-1, :] |= local[1:, :]
    dil[:, 1:] |= local[:, :-1]
    dil[:, :-1] |= local[:, 1:]
    out = crop.copy()
    out[~dil, 3] = 0
    s = out[:, :, 0].astype(np.int16) + out[:, :, 1] + out[:, :, 2]
    out[(out[:, :, 3] > 0) & (s < 25), 3] = 0
    return Image.fromarray(out)


SCALE = 0.72


def resize(img: Image.Image) -> Image.Image:
    nw = max(1, int(img.width * SCALE))
    nh = max(1, int(img.height * SCALE))
    return img.resize((nw, nh), Image.Resampling.LANCZOS)


def stack_vertical(parts: list[str], side: str, overlap: int = 20) -> Image.Image:
    """Stack upper→lower with strong overlap so joints look continuous."""
    imgs = [resize(extract(named[p])) for p in parts]
    # Slight horizontal tuck so lower segments sit under the upper ones.
    max_w = max(im.width for im in imgs) + 16
    total_h = sum(im.height for im in imgs) - overlap * (len(imgs) - 1)
    canvas = Image.new("RGBA", (max_w, total_h + 2), (0, 0, 0, 0))
    y = 0
    for i, im in enumerate(imgs):
        tuck = i * 4
        if side == "L":
            x = (max_w - im.width) // 2 + tuck
        else:
            x = (max_w - im.width) // 2 - tuck
        canvas.alpha_composite(im, (x, y))
        y += im.height - overlap
    return canvas


arm_l = stack_vertical(["armLu", "armLf", "armLg"], "L", overlap=26)
arm_r = stack_vertical(["armRu", "armRf", "armRg"], "R", overlap=26)
leg_l = stack_vertical(["legLt", "legLk", "legLb"], "L", overlap=24)
leg_r = stack_vertical(["legRt", "legRk", "legRb"], "R", overlap=24)

head = resize(extract(named["head"]))
chest = resize(extract(named["chest"]))
belt = resize(extract(named["belt"]))
stom = resize(extract(named["stomach"]))

# Estimate canvas
cw = chest.width + arm_l.width + arm_r.width - 90
ch = head.height + chest.height + stom.height + max(leg_l.height, leg_r.height) - 40
cw = max(cw, 360)
ch = max(ch, 700)

full = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
zones = {
    z: Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    for z in ("head", "chest", "stomach", "armL", "armR", "legL", "legR")
}


def put(zone: str, img: Image.Image, pos: tuple[int, int]) -> None:
    full.alpha_composite(img, pos)
    zones[zone].alpha_composite(img, pos)


# Torso column centered
tx = (cw - chest.width) // 2
hy = 12
hx = (cw - head.width) // 2
put("head", head, (hx, hy))

cy = hy + head.height - 34
put("chest", chest, (tx, cy))
cb = cy + chest.height

by = cb - 34
put("stomach", belt, ((cw - belt.width) // 2, by))
bb = by + belt.height

sy = bb - 30
put("stomach", stom, ((cw - stom.width) // 2, sy))
sb = sy + stom.height

# Arms tucked hard into shoulder line of vest
aly = cy + 2
alx = tx - arm_l.width + 62
ary = cy + 2
arx = tx + chest.width - 62
put("armL", arm_l, (alx, aly))
put("armR", arm_r, (arx, ary))

# Legs under hips, slight gap closed
lly = sb - 34
llx = cw // 2 - leg_l.width - 1
lrx = cw // 2 + 1
put("legL", leg_l, (llx, lly))
put("legR", leg_r, (lrx, lly))

bb = full.getbbox()
assert bb
pad = 10
l, t, r, b = max(0, bb[0] - pad), max(0, bb[1] - pad), min(cw, bb[2] + pad), min(ch, bb[3] + pad)
full = full.crop((l, t, r, b))
for z in zones:
    zones[z] = zones[z].crop((l, t, r, b))

OUT.mkdir(parents=True, exist_ok=True)
ASSET_OUT.mkdir(parents=True, exist_ok=True)
full.save(OUT / "full.png")
full.save(ASSET_OUT / "full.png")
for z, im in zones.items():
    im.save(OUT / f"{z}.png")
    im.save(ASSET_OUT / f"{z}.png")
print("size", full.size)
