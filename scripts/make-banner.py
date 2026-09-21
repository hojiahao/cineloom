#!/usr/bin/env python3
"""Render the README banner: ANSI Shadow lettering drawn as vector shapes.

Block and box-drawing characters are converted to rectangles and polylines, so the
banner looks the same everywhere instead of depending on the viewer's monospace font.

    pip install pyfiglet && python scripts/make-banner.py > docs/assets/banner.svg
"""

import pyfiglet

CELL_W, CELL_H = 15, 28
PAD_X, TOP = 48, 78
# Which cell edges a box-drawing character connects to its centre.
ARMS = {"═": "lr", "║": "tb", "╔": "rb", "╗": "lb", "╚": "rt", "╝": "lt"}

rows = [line for line in pyfiglet.figlet_format("CINELOOM", font="ansi_shadow", width=200).splitlines() if line.strip()]
cols = max(len(row) for row in rows)
width = cols * CELL_W + PAD_X * 2
height = TOP + len(rows) * CELL_H + 92

blocks, shadows = [], []
for y, row in enumerate(rows):
    x = 0
    while x < len(row):
        char = row[x]
        if char == "█":
            run = x
            while run < len(row) and row[run] == "█":
                run += 1
            # One rect per run of blocks, overlapped by half a pixel to hide seams.
            blocks.append(f'<rect x="{PAD_X + x * CELL_W}" y="{TOP + y * CELL_H}" width="{(run - x) * CELL_W + 0.5}" height="{CELL_H + 0.5}"/>')
            x = run
            continue
        if char in ARMS:
            cx, cy = PAD_X + x * CELL_W + CELL_W / 2, TOP + y * CELL_H + CELL_H / 2
            ends = {"l": (cx - CELL_W / 2, cy), "r": (cx + CELL_W / 2, cy), "t": (cx, cy - CELL_H / 2), "b": (cx, cy + CELL_H / 2)}
            first, second = (ends[arm] for arm in ARMS[char])
            shadows.append(f"M{first[0]} {first[1]}L{cx} {cy}L{second[0]} {second[1]}")
        x += 1

path = "".join(shadows)
print(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" aria-label="CineLoom">
  <defs>
    <linearGradient id="ink" gradientUnits="userSpaceOnUse" x1="{PAD_X}" y1="0" x2="{width - PAD_X}" y2="0">
      <stop offset="0" stop-color="#f6e2b0"/><stop offset="0.55" stop-color="#d9a441"/><stop offset="1" stop-color="#e0724f"/>
    </linearGradient>
  </defs>
  <rect width="{width}" height="{height}" rx="14" fill="#0e0f13"/>
  <rect x="0.75" y="0.75" width="{width - 1.5}" height="{height - 1.5}" rx="13.5" fill="none" stroke="#272a35" stroke-width="1.5"/>
  <circle cx="30" cy="30" r="6.5" fill="#ef6f6f"/><circle cx="52" cy="30" r="6.5" fill="#e6c15a"/><circle cx="74" cy="30" r="6.5" fill="#6fcf97"/>
  <text x="{width / 2}" y="35" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14" fill="#5d6070">cineloom - dgx-spark</text>
  <!-- double-line shadow: a wide dim stroke with a background-coloured stroke inside it -->
  <path d="{path}" fill="none" stroke="#7a5f2c" stroke-width="7" stroke-linejoin="miter"/>
  <path d="{path}" fill="none" stroke="#0e0f13" stroke-width="2.6" stroke-linejoin="miter"/>
  <g fill="url(#ink)">{"".join(blocks)}</g>
  <text x="{PAD_X}" y="{height - 52}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="19" fill="#d9b26a">$ <tspan fill="#e9e7e1">影织 · 把一句创意，织成一支成片</tspan></text>
  <text x="{PAD_X}" y="{height - 24}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="15" fill="#6b6e7d">agentic ad-film studio · runs on one NVIDIA DGX Spark<tspan fill="#d9b26a"> ▍</tspan></text>
</svg>''')
