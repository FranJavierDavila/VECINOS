#!/usr/bin/env python3
"""VECINOS — plantillas de referencia para el arte de puertas e interiores.
Genera en public/art/reference/:
  1. plantilla_puerta_vivienda_768x1496.png  — plantilla de trabajo de la hoja de puerta
  2. ejemplo_composicion_puerta.png          — cómo encaja la hoja con el recercado 3D
  3. plantilla_mueble_1024.png               — plantilla de sprite de mobiliario (diorama)
Todo dibujado con PIL, determinista, sin dependencias de red.
"""
from PIL import Image, ImageDraw, ImageFont

F = "/usr/share/fonts/truetype/dejavu/"
def font(sz, bold=False):
    return ImageFont.truetype(F + ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"), sz)

WALL = (219, 216, 210)      # #dbd8d2 pared/zócalo superior de fachada
ZOCALO = (163, 161, 155)    # #a3a19b gris del zócalo (y del recercado)
ZOC_HI = (186, 184, 178)    # luz del recercado
ZOC_LO = (137, 135, 129)    # sombra del recercado
WOOD = (200, 154, 99)       # hoja de madera
WOOD_HI = (216, 178, 126)
WOOD_LO = (158, 113, 62)
GOLD = (255, 209, 102)      # #ffd166 tirador/candado
INK = (40, 36, 32)
GUIDE = (214, 69, 65)       # rojo guías
GUIDE2 = (222, 148, 24)     # ámbar guías
OUT = "public/art/reference/"

import os
os.makedirs(OUT, exist_ok=True)

# ─────────────────────────────────────────────────────────────────────────────
# 1. PLANTILLA DE PUERTA — 768 × 1496 (aspecto EXACTO del plano 0.95 × 1.85 m)
# ─────────────────────────────────────────────────────────────────────────────
S = 808.5  # px por metro (coincide en X e Y con 768/0.95 y 1496/1.85)
W, H = 768, 1496
img = Image.new("RGB", (W, H), WALL)
d = ImageDraw.Draw(img, "RGBA")

def cmx(m):  # metros desde el borde izq → px
    return int(round(m * S))
def cmy(m):  # metros desde ARRIBA → px
    return int(round(m * S))

# Fondo de zona útil: hoja sugerida (marco pintado hacia dentro 4.5 cm)
ins = cmx(0.045)
d.rectangle([ins, ins, W - ins, H - ins], outline=GUIDE2 + (255,), width=3)

# Guía de recorte si se entrega 768×1344 (se recortan 39 px por lado)
crop = (H - int(H * 0.95 / 1.85)) // 2  # no aplica: el recorte es horizontal
# target aspect = 0.95/1.85 → si entregas 768×1344: usado = 1344*0.5135 = 690 px de ancho
used_w = int(round(1344 * 0.95 / 1.85))  # 690
lost = (W - used_w) // 2                  # 39 px por lado
for x in (lost, W - lost):
    d.line([(x, 0), (x, H)], fill=GUIDE + (200,), width=2)
d.rectangle([0, 0, lost, H], fill=GUIDE + (28,))
d.rectangle([W - lost, 0, W, H], fill=GUIDE + (28,))

# Tirador (posición habitual del arte actual) + mirilla
hy = cmy(1.85 - 0.96)  # tirador a ~0.96 m del suelo (yFrac 0.52 del candado)
hx = cmx(0.22)
# candado del juego (runtime): dx 0.22 m a la derecha del centro, yFrac 0.52
lx, ly = W // 2 + cmx(0.22), cmy(1.85 - 1.85 * 0.52)
r = 26
d.ellipse([lx - r, ly - r, lx + r, ly + r], outline=GUIDE + (255,), width=3)
d.ellipse([lx - 8, ly - 14, lx + 8, ly + 2], outline=GUIDE + (255,), width=3)
d.text((lx - 128, ly - 8), "candado del juego", font=font(17, True), fill=GUIDE)
# mirilla a 1.5 m
py = cmy(1.85 - 1.5)
d.ellipse([W // 2 - 14, py - 14, W // 2 + 14, py + 14], outline=GUIDE2 + (255,), width=3)
d.text((W // 2 + 20, py - 10), "mirilla ≈ 1.5 m", font=font(17, True), fill=GUIDE2)
d.text((10, ins + 6), "marco pintado 4–5 cm", font=font(17, True), fill=GUIDE2)

# Regla superior (cm desde la izq.) y regla izquierda (cm desde el SUELO)
for i in range(0, 96, 10):
    x = cmx(i / 100)
    d.line([(x, 0), (x, 26 if i % 50 else 44)], fill=INK + (230,), width=2)
    if i % 20 == 0:
        d.text((x + 4, 30), f"{i}", font=font(20, True), fill=INK)
for j in range(0, 186, 10):
    y = H - cmy(j / 100)  # 0 cm = suelo (borde inferior)
    d.line([(0, y), (26 if j % 50 else 44, y)], fill=INK + (230,), width=2)
    if j % 20 == 0:
        d.text((30, y - 12), f"{j}", font=font(20, True), fill=INK)
d.text((H * 0.0 - 0, H // 2 - 220), "", font=font(18), fill=INK)

# Banda inferior con el resumen de especificación
d.rectangle([0, H - 132, W, H], fill=(255, 255, 255, 235))
d.line([(0, H - 132), (W, H - 132)], fill=INK, width=3)
txt = [
    "PLANTILLA HOJA DE PUERTA · VECINOS",
    "Plano: 0.95 m × 1.85 m  →  PNG 768 × 1496 px (aspecto exacto, sin recorte)",
    "A sangre (full-bleed, opaco). Marco pintado de la hoja: inset ≈ 4–5 cm (ámbar).",
    "Zonas rojas: se RECORTAN si entregas 768×1344 (39 px por lado).",
    "Círculo rojo: candado que el juego dibuja solo (no lo pintes). tirador/mirilla libres.",
]
yy = H - 124
for i, t in enumerate(txt):
    d.text((12, yy), t, font=font(19 if i else 22, i == 0), fill=INK)
    yy += 24
img.save(OUT + "plantilla_puerta_vivienda_768x1496.png")
print("OK plantilla_puerta_vivienda_768x1496.png")

# ─────────────────────────────────────────────────────────────────────────────
# 2. COMPOSICIÓN — cómo encaja la hoja con el recercado gris del zócalo
# ─────────────────────────────────────────────────────────────────────────────
S2 = 430  # px/m
CW, CH = 1250, 1470
img2 = Image.new("RGB", (CW, CH), (250, 249, 246))
d2 = ImageDraw.Draw(img2, "RGBA")

# Título
d2.text((40, 26), "CÓMO ENCAJA TU PUERTA — recercado del gris del zócalo", font=font(30, True), fill=INK)
d2.text((40, 64), "Hoja (tu PNG) + recercado 3D del juego. El gris enmarca y da volumen: adiós «pegotes».", font=font(20), fill=(90, 86, 80))

# Fachada: pared + zócalo cortado en la puerta
fx0, fy0 = 90, 130          # origen de la fachada
FW, FH = 1070, 1030         # 2.49 × 2.40 m de fachada dibujada
d2.rectangle([fx0, fy0, fx0 + FW, fy0 + FH], fill=WALL)
floorY = fy0 + FH           # línea de suelo
# zócalo 25 cm, CORTADO en la puerta
sk = int(0.25 * S2)
door_cx = fx0 + FW // 2
door_w = int(0.95 * S2)     # 409
door_h = int(1.85 * S2)     # 795
rec_w = door_w + 2 * int(0.10 * S2)   # recercado 10 cm por lado
rec_h = door_h + int(0.10 * S2)
rx0 = door_cx - rec_w // 2
ry1 = floorY
ry0 = ry1 - rec_h
# zócalo en dos tramos (como el juego: skirtingDoorGap)
d2.rectangle([fx0, floorY - sk, rx0 - 1, floorY], fill=ZOCALO)
d2.rectangle([rx0 + rec_w + 1, floorY - sk, fx0 + FW, floorY], fill=ZOCALO)
# calle bajo la línea de suelo
d2.rectangle([fx0, floorY, fx0 + FW, floorY + 60], fill=(154, 148, 140))

# RECERCADO: caja gris con bisel (luz arriba-izq, sombra abajo-der)
bev = int(0.022 * S2)
d2.rectangle([rx0, ry0, rx0 + rec_w, ry1], fill=ZOC_LO)
d2.rectangle([rx0, ry0, rx0 + rec_w - bev, ry1 - bev], fill=ZOC_HI)
d2.rectangle([rx0 + bev, ry0 + bev, rx0 + rec_w - bev, ry1 - bev], fill=ZOCALO)

# HOJA dentro del recercado (con marco pintado propio, como door_casa_a.png)
dx0 = door_cx - door_w // 2
dy1 = floorY
dy0 = dy1 - door_h
d2.rectangle([dx0, dy0, dx0 + door_w, dy1], fill=WOOD_LO)
mi = int(0.045 * S2)
d2.rectangle([dx0 + mi, dy0 + mi, dx0 + door_w - mi, dy1 - mi], fill=WOOD_HI)
d2.rectangle([dx0 + mi + 8, dy0 + mi + 8, dx0 + door_w - mi - 8, dy1 - mi - 8], fill=WOOD)
# 3 paneles con bisel
def panel(px0, py0, px1, py1):
    d2.rectangle([px0, py0, px1, py1], fill=WOOD)
    d2.line([(px0, py0), (px1, py0)], fill=WOOD_HI, width=5)
    d2.line([(px0, py0), (px0, py1)], fill=WOOD_HI, width=5)
    d2.line([(px0, py1), (px1, py1)], fill=WOOD_LO, width=5)
    d2.line([(px1, py0), (px1, py1)], fill=WOOD_LO, width=5)
    d2.rectangle([px0 + 14, py0 + 14, px1 - 14, py1 - 14], outline=WOOD_LO, width=3)
mx = dx0 + mi + 46
panel(mx, dy0 + mi + 40, dx0 + door_w - mi - 46, dy0 + mi + 380)
panel(mx, dy0 + mi + 460, dx0 + door_w - mi - 46, dy0 + mi + 560)
panel(mx, dy0 + mi + 640, dx0 + door_w - mi - 46, dy1 - mi - 44)
# tirador dorado
hxp = dx0 + int(0.16 * S2)
hyp = dy1 - int(0.96 * S2)
d2.rounded_rectangle([hxp - 12, hyp - 46, hxp + 12, hyp + 46], 10, fill=GOLD)
d2.ellipse([hxp + 6, hyp - 14, hxp + 30, hyp + 10], fill=GOLD)
# candado del juego (dibujado por el runtime sobre la hoja)
lxp = door_cx + int(0.22 * S2)
lyp = dy1 - int(1.85 * 0.52 * S2)
d2.rounded_rectangle([lxp - 20, lyp - 16, lxp + 20, lyp + 24], 6, fill=(120, 116, 110))
d2.arc([lxp - 13, lyp - 40, lxp + 13, lyp - 8], 180, 360, fill=(120, 116, 110), width=7)

# Cotas
ARROW = (60, 56, 52)
def dim_v(x, y0, y1, label, col=ARROW):
    d2.line([(x, y0), (x, y1)], fill=col, width=3)
    for yy in (y0, y1):
        d2.line([(x - 9, yy), (x + 9, yy)], fill=col, width=3)
    b = d2.textbbox((0, 0), label, font=font(19, True))
    d2.rectangle([x + 12, (y0 + y1) // 2 - 14, x + 22 + b[2], (y0 + y1) // 2 + 14], fill=(255, 255, 255, 230))
    d2.text((x + 16, (y0 + y1) // 2 - 12), label, font=font(19, True), fill=col)
def dim_h(y, x0, x1, label, col=ARROW):
    d2.line([(x0, y), (x1, y)], fill=col, width=3)
    for xx in (x0, x1):
        d2.line([(xx, y - 9), (xx, y + 9)], fill=col, width=3)
    b = d2.textbbox((0, 0), label, font=font(19, True))
    cxm = (x0 + x1) // 2
    d2.rectangle([cxm - b[2] // 2 - 8, y - 34, cxm + b[2] // 2 + 8, y - 6], fill=(255, 255, 255, 230))
    d2.text((cxm - b[2] // 2 - 4, y - 32), label, font=font(19, True), fill=col)

dim_v(rx0 - 26, ry0, ry1, "2.05 m")
dim_h(ry0 - 22, rx0, rx0 + rec_w, "1.15 m")
dim_v(dx0 + door_w + 26, dy0, dy1, "1.85 m")
dim_h(dy1 + 74, dx0, dx0 + door_w, "0.95 m")
# ancho del recercado (10 cm)
dim_h(ry0 - 60, rx0, dx0, "10 cm", (150, 60, 40))

# Notas
notes = [
    "· RECERCADO (lo dibuja el juego en 3D): jambas + dintel del MISMO gris que el zócalo (#a3a19b),",
    "  10 cm de ancho; sobresale ≈ 9 cm de la fachada y ≈ 6 cm por delante de tu hoja.",
    "  El zócalo se corta en la puerta y el recercado retoma el listón hacia arriba (continuidad).",
    "· TU PNG: SOLO la hoja (con su marco pintado de 4–5 cm), a sangre, opaco.",
    "  Nada de recercado pintado: lo pone el 3D. Plantilla: plantilla_puerta_vivienda_768x1496.png",
    "· El candado lo dibuja el juego (dx 0.22 m del centro, al 52 % de la altura).",
]
yy = floorY + 88
for i, t in enumerate(notes):
    d2.text((40, yy), t, font=font(21, i == 0), fill=(70, 66, 60) if i else INK)
    yy += 30
img2.save(OUT + "ejemplo_composicion_puerta.png")
print("OK ejemplo_composicion_puerta.png")

# ─────────────────────────────────────────────────────────────────────────────
# 3. PLANTILLA DE MUEBLE — 1024 × 1024, fondo blanco (se recorta solo)
# ─────────────────────────────────────────────────────────────────────────────
img3 = Image.new("RGB", (1024, 1024), (255, 255, 255))
d3 = ImageDraw.Draw(img3, "RGBA")

# Ejemplo: sillón simple centrado (silueta que ocupa ~60 %)
cx3 = 512
w3, h3 = 560, 620
x0, y0 = cx3 - w3 // 2, 1024 - 220 - h3
GR = (168, 164, 158)
GR_HI = (196, 192, 186)
GR_LO = (128, 124, 118)
# respaldo + brazos + asiento
d3.rounded_rectangle([x0 + 40, y0, x0 + w3 - 40, y0 + 420], 36, fill=GR)
d3.rounded_rectangle([x0 + 64, y0 + 24, x0 + w3 - 64, y0 + 380], 24, fill=GR_HI)
d3.rounded_rectangle([x0, y0 + 160, x0 + 120, y0 + 520], 28, fill=GR)
d3.rounded_rectangle([x0 + w3 - 120, y0 + 160, x0 + w3, y0 + 520], 28, fill=GR)
d3.rounded_rectangle([x0 + 30, y0 + 400, x0 + w3 - 30, y0 + 560], 24, fill=GR_LO)
for px in (x0 + 80, x0 + w3 - 110):
    d3.rounded_rectangle([px, y0 + 540, px + 30, y0 + 620], 8, fill=(90, 86, 80))
d3.rectangle([x0 + 20, y0 + 620, x0 + w3 - 20, y0 + 626], fill=(120, 116, 110, 120))  # sombra

# Guías
d3.rectangle([x0, y0, x0 + w3, y0 + h3], outline=GUIDE2 + (255,), width=3)
d3.line([(512, 0), (512, 1024)], fill=GUIDE + (120,), width=2)
d3.line([(0, 512), (1024, 512)], fill=GUIDE + (120,), width=2)

# Nota inferior
d3.rectangle([0, 1024 - 150, 1024, 1024], fill=(255, 255, 255, 235))
d3.line([(0, 1024 - 150), (1024, 1024 - 150)], fill=INK, width=3)
t3 = [
    "PLANTILLA MUEBLE (DIORAMA) · PNG 1024×1024 · FONDO BLANCO PURO #FFFFFF",
    "El juego RECORTA el blanco (tolerancia 0.15), encaja el recorte en la caja w×h declarada en",
    "interiors.json (metros reales, p. ej. sofá 1.7×0.95) y lo coloca en u,v (fracciones 0–1 de la estancia).",
]
yy = 1024 - 142
for i, t in enumerate(t3):
    d3.text((14, yy), t, font=font(20 if i == 0 else 18, i == 0), fill=INK)
    yy += 30
img3.save(OUT + "plantilla_mueble_1024.png")
print("OK plantilla_mueble_1024.png")
print("LISTO —", OUT)
