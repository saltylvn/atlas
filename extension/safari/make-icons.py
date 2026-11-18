"""Draws the Atlas Autofill icons: a rounded violet square with a white "A".

Plain Python (zlib and struct only), so it runs anywhere without installing anything:
    python3 extension/safari/make-icons.py
"""

import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
BG = (124, 92, 255)
FG = (255, 255, 255)


def inside_rounded(x, y, n, r):
    cx = min(max(x, r), n - 1 - r)
    cy = min(max(y, r), n - 1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def inside_triangle(px, py, a, b, c):
    def sign(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])

    d1, d2, d3 = sign((px, py), a, b), sign((px, py), b, c), sign((px, py), c, a)
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)


def pixel(x, y, n):
    """RGBA at (x, y), 4x supersampled for smooth edges."""
    s = 4
    cover_bg = cover_fg = 0
    for i in range(s):
        for j in range(s):
            fx, fy = x + (i + 0.5) / s, y + (j + 0.5) / s
            if not inside_rounded(fx, fy, n, n * 0.22):
                continue
            cover_bg += 1
            # The "A": an outer triangle, minus an inner one, plus a crossbar.
            top, base, half = n * 0.2, n * 0.8, n * 0.3
            outer = inside_triangle(fx, fy, (n / 2, top), (n / 2 - half, base), (n / 2 + half, base))
            t = n * 0.115
            inner = inside_triangle(fx, fy, (n / 2, top + t * 2.1), (n / 2 - half + t * 1.15, base + 1), (n / 2 + half - t * 1.15, base + 1))
            bar = n * 0.56 <= fy <= n * 0.56 + t * 0.85 and outer
            if (outer and not inner) or bar:
                cover_fg += 1
    total = s * s
    if cover_bg == 0:
        return (0, 0, 0, 0)
    f = cover_fg / cover_bg
    rgb = tuple(round(BG[k] * (1 - f) + FG[k] * f) for k in range(3))
    return rgb + (round(255 * cover_bg / total),)


def png(n):
    rows = b"".join(b"\x00" + b"".join(bytes(pixel(x, y, n)) for x in range(n)) for y in range(n))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    out = os.path.join(HERE, "icons")
    os.makedirs(out, exist_ok=True)
    for size in (16, 32, 48, 96, 128, 512):
        with open(os.path.join(out, f"icon-{size}.png"), "wb") as fh:
            fh.write(png(size))
    print("icons written to", out)
