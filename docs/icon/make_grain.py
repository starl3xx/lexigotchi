"""Final masked paper grain, 1024 native.

Grain remains ONLY on the cream field and the white tile face (incl. the printed L).
Excluded: the full tile hull outside the face (pale ring + blue frame + wood edge),
the eyes, and the (asymmetric) brows. Geometry = 512-space v6 layout x2.
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

def quad_points(p0, c, p1, n=40):
    pts = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        pts.append((mt * mt * p0[0] + 2 * t * mt * c[0] + t * t * p1[0],
                    mt * mt * p0[1] + 2 * t * mt * c[1] + t * t * p1[1]))
    return pts

brows = (quad_points((177.5 * S, 45.5 * S), (198.5 * S, 30.5 * S), (219.6 * S, 45.5 * S))
         + quad_points((287.5 * S, 50 * S), (308.5 * S, 36 * S), (329.6 * S, 50 * S)))
BROW_R2 = (7.0 * S) ** 2
EYES = ((198.5 * S, 108.0 * S), (308.5 * S, 108.0 * S))
EYE_R2 = (49.0 * S) ** 2

alpha = bytearray(255 for _ in range(W * H))
bx0, bx1 = 168 * S, 340 * S
by0, by1 = 24 * S, 60 * S
for py in range(H):
    fy = py + 0.5
    for px in range(W):
        fx = px + 0.5
        excl = False
        if in_hull(fx, fy) and not in_rr(fx, fy, *FACE):
            excl = True
        if not excl:
            for ex, ey in EYES:
                if (fx - ex) ** 2 + (fy - ey) ** 2 <= EYE_R2:
                    excl = True
                    break
        if not excl and bx0 <= fx <= bx1 and by0 <= fy <= by1:
            for bpx, bpy in brows:
                if (fx - bpx) ** 2 + (fy - bpy) ** 2 <= BROW_R2:
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
