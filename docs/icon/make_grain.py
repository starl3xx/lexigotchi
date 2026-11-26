"""Final masked paper grain, 1024 native.

Grain remains ONLY on the cream field and the white tile face (incl. the printed L).
Excluded: the full tile hull outside the face (pale ring + blue frame + wood edge) and
the eyes. Geometry = the logo's 512 space x2: the numbers below are LOGO_A's
(src/lib/cardArt/logo.ts). If the tile or the eyes move there, move them here
(tests/logo.test.ts compares the two).
"""
import zlib, struct, random

S = 2
W = H = 512 * S
random.seed(7)

fine = [random.randint(0, 255) for _ in range(W * H)]
coarse = [random.randint(0, 255) for _ in range(W * H)]
for _ in range(2):
    out = coarse[:]
    for y in range(H):
        for x in range(W):
            s = 0
            for dy in (-1, 0, 1):
                yy = min(max(y + dy, 0), H - 1)
                base = yy * W
                for dx in (-1, 0, 1):
                    xx = min(max(x + dx, 0), W - 1)
                    s += coarse[base + xx]
            out[y * W + x] = s // 9
    coarse = out
gray = [min(255, max(0, (f * 2 + c * 3) // 5)) for f, c in zip(fine, coarse)]

def in_rr(px, py, x, y, w, h, r):
    dx = max(abs(px - (x + w / 2)) - (w / 2 - r), 0.0)
    dy = max(abs(py - (y + h / 2)) - (h / 2 - r), 0.0)
    return dx * dx + dy * dy <= r * r

# hull = ring rect swept along the extrusion offset (5,10)*S
RING = (59.4 * S, 66.1 * S, 388.2 * S, 388.2 * S, 101.5 * S)
FACE = (106.4 * S, 113.1 * S, 294.2 * S, 294.2 * S, 54.5 * S)
DX, DY = 5 * S, 10 * S
TS = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]

def in_hull(px, py):
    x, y, w, h, r = RING
    for t in TS:
        if in_rr(px, py, x + DX * t, y + DY * t, w, h, r):
            return True
    return False

# the eyes: tall ovals (the letters' own, since the letter review), cleared a little past their line
EYES = ((200.5 * S, 106.0 * S), (306.5 * S, 106.0 * S))
EYE_RX, EYE_RY = 48.0 * S, 55.0 * S

alpha = bytearray(255 for _ in range(W * H))
for py in range(H):
    fy = py + 0.5
    for px in range(W):
        fx = px + 0.5
        excl = False
        if in_hull(fx, fy) and not in_rr(fx, fy, *FACE):
            excl = True
        if not excl:
            for ex, ey in EYES:
                if ((fx - ex) / EYE_RX) ** 2 + ((fy - ey) / EYE_RY) ** 2 <= 1.0:
                    excl = True
                    break
        if excl:
            alpha[py * W + px] = 0

rows = []
for y in range(H):
    row = bytearray([0])
    base = y * W
    for x in range(W):
        row.append(gray[base + x])
        row.append(alpha[base + x])
    rows.append(bytes(row))
raw = b"".join(rows)

def chunk(t, d):
    return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 4, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(raw, 9))
png += chunk(b"IEND", b"")
with open("grain.png", "wb") as fh:
    fh.write(png)
print("wrote grain.png", len(png), "bytes")
