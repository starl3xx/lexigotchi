"""Assemble the self-contained icon source page: SVG tile + Söhne letter + grain data URI."""
import base64

with open("grain.png", "rb") as fh:
    grain_b64 = base64.b64encode(fh.read()).decode()

html = """<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 512px; height: 512px; background: #f4ead2; position: relative; overflow: hidden; }
  #letter { position: absolute; left: 106px; top: 106px; width: 294px; height: 294px;
            font-family: "Söhne"; font-weight: 800; font-size: 200px; line-height: 294px;
            text-align: center; color: #111827; }
  #grain { position: absolute; left: 0; top: 0; width: 512px; height: 512px; opacity: 0.07; }
</style></head><body>
<svg width="416" height="448" viewBox="48 24 416 448" style="position:absolute; left:48px; top:24px;">
  <defs>
    <linearGradient id="woodG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#b69c72"/><stop offset="1" stop-color="#a1865c"/>
    </linearGradient>
    <linearGradient id="ringG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#cdddfe"/><stop offset="1" stop-color="#a9c1f6"/>
    </linearGradient>
    <linearGradient id="blueG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4f95ff"/><stop offset="1" stop-color="#2e6fdd"/>
    </linearGradient>
    <linearGradient id="faceG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef1f6"/>
    </linearGradient>
  </defs>
  <path d="M 436.9 122.2 L 441.9 132.2 A 101.5 101.5 0 0 1 452.6 177.6 L 452.6 362.8 A 101.5 101.5 0 0 1 351.1 464.3 L 165.9 464.3 A 101.5 101.5 0 0 1 75.1 408.2 L 70.1 398.2 A 101.5 101.5 0 0 1 59.4 352.8 L 59.4 167.6 A 101.5 101.5 0 0 1 160.9 66.1 L 346.1 66.1 A 101.5 101.5 0 0 1 436.9 122.2 Z" fill="url(#woodG)"/>
  <rect x="59.4" y="66.1" width="388.2" height="388.2" rx="101.5" fill="url(#ringG)"/>
  <rect x="80.4" y="87.1" width="346.2" height="346.2" rx="80.5" fill="url(#blueG)"/>
  <rect x="106.4" y="113.1" width="294.2" height="294.2" rx="54.5" fill="url(#faceG)"/>
  <circle cx="198.5" cy="108" r="45" fill="#ffffff" stroke="#2a1e1a" stroke-width="7.3"/>
  <circle cx="308.5" cy="108" r="45" fill="#ffffff" stroke="#2a1e1a" stroke-width="7.3"/>
  <circle cx="201.5" cy="123" r="23" fill="#2a1e1a"/>
  <circle cx="311.5" cy="123" r="23" fill="#2a1e1a"/>
  <circle cx="190" cy="101.5" r="6" fill="#ffffff"/>
  <circle cx="300" cy="101.5" r="6" fill="#ffffff"/>
  <path d="M 177.5 45.5 Q 198.5 30.5 219.6 45.5" stroke="#2a1e1a" stroke-width="9" fill="none" stroke-linecap="round"/>
  <path d="M 287.5 50 Q 308.5 36 329.6 50" stroke="#2a1e1a" stroke-width="9" fill="none" stroke-linecap="round"/>
</svg>
<div id="letter">L</div>
<img id="grain" src="data:image/png;base64,GRAIN_B64">
</body></html>
"""

html = html.replace("GRAIN_B64", grain_b64)
with open("source.html", "w") as fh:
    fh.write(html)
print("wrote source.html", len(html), "bytes")
