#!/usr/bin/env python3
"""
VECINOS — generador de variantes de pared y suelo para los estudios diáfanos (v1.43).

Genera PNGs 1024×1024 full-bleed (sin fondo blanco que trocear: paredes/suelos son
NO-keyed en el pipeline de diorama.ts — drawImage directo a 512×512 + uScale/vScale).

La pared del estudio se tesela ×2 en horizontal (wallTiles = round(4.8/2.26) = 2) y el
suelo 2×2 (teselas de 2.40×2.40 m), así que TODOS los patrones son «seamless» (dibujados
con wrap) y las composiciones con motivo son simétricas para que la repetición lea como
ritmo de decoración, no como error.

Estilo: ilustración plana cálida (mismo lenguaje que wall_vacio_salon.png), paleta
española de barrio. Sin azul/índigo (norma de la casa).
"""
import math
import os
import random

from PIL import Image, ImageDraw

OUT = "/home/z/my-project/public/art/interiors/raw"
os.makedirs(OUT, exist_ok=True)
S = 1024


def canvas(color):
    im = Image.new("RGB", (S, S), color)
    return im, ImageDraw.Draw(im)


def vgrad(im, tint=(40, 30, 25), alpha_top=28, alpha_bottom=0):
    """Sombra sutil de arriba (más oscura) hacia abajo, como el arte de referencia."""
    ov = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    tr, tg, tb = tint
    for y in range(S):
        t = y / S
        a = int(alpha_top * (1 - t) + alpha_bottom * t)
        d.line([(0, y), (S, y)], fill=(tr, tg, tb, max(0, a)))
    im.paste(Image.alpha_composite(im.convert("RGBA"), ov).convert("RGB"), (0, 0))


def hexpt(d, cx, cy, r, fill, outline=None, w=0):
    return d.polygon(
        [(cx + r * math.sin(k * math.pi / 3), cy - r * math.cos(k * math.pi / 3)) for k in range(6)],
        fill=fill,
        outline=outline,
        width=w,
    )


def rgb(hexstr):
    hexstr = hexstr.lstrip("#")
    return tuple(int(hexstr[i : i + 2], 16) for i in (0, 2, 4))


def darker(hexstr, amt):
    return tuple(max(0, c - amt) for c in rgb(hexstr))


def frame(d, x0, y0, w, h, wood, matte="#f3efe6", art=None, shadow=True):
    if shadow:
        d.rectangle([x0 + 10, y0 + 12, x0 + w + 10, y0 + h + 12], fill=darker(wood, 60))
    d.rectangle([x0, y0, x0 + w, y0 + h], fill=wood)
    m = int(min(w, h) * 0.09)
    d.rectangle([x0 + m, y0 + m, x0 + w - m, y0 + h - m], fill=matte)
    if art:
        am = int(min(w, h) * 0.2)
        d.rectangle([x0 + am, y0 + am, x0 + w - am, y0 + h - am], fill=art)


def plant(d, cx, base_y, scale=1.0, pot="#b4643f", leaf="#6f8f5a", leaf2="#89a86e"):
    pw, ph = int(120 * scale), int(90 * scale)
    d.polygon(
        [(cx - pw // 2, base_y - ph), (cx + pw // 2, base_y - ph), (cx + int(pw * 0.38), base_y), (cx - int(pw * 0.38), base_y)],
        fill=pot,
    )
    d.rectangle([cx - int(pw * 0.52), base_y - ph - 14, cx + int(pw * 0.52), base_y - ph + 6], fill=darker(pot, 25))
    for dx, dy, r, col in [(-46, -200, 62, leaf), (40, -230, 70, leaf2), (0, -280, 78, leaf), (-64, -130, 50, leaf2), (58, -140, 54, leaf)]:
        d.ellipse([cx + int(dx * scale) - int(r * scale), base_y + int(dy * scale) - int(r * scale), cx + int(dx * scale) + int(r * scale), base_y + int(dy * scale) + int(r * scale)], fill=col)


def books(d, x0, y0, h, n, seed):
    rnd = random.Random(seed)
    cols = ["#b5654d", "#8a8f6a", "#c98d7e", "#7a6a53", "#a8b5a0", "#d9a441", "#8f7f6d"]
    x = x0
    for i in range(n):
        bw = rnd.randint(26, 44)
        bh = h - rnd.randint(0, 40)
        c = cols[rnd.randrange(len(cols))]
        d.rectangle([x, y0 + (h - bh), x + bw, y0 + h], fill=c)
        d.rectangle([x, y0 + (h - bh) + int(bh * 0.22), x + bw, y0 + (h - bh) + int(bh * 0.22) + 8], fill=(255, 250, 240))
        x += bw + 4


def jar(d, cx, base_y, w, h, fill):
    d.rounded_rectangle([cx - w // 2, base_y - h, cx + w // 2, base_y], radius=w // 5, fill=fill, outline="#7a6a53", width=6)
    d.rectangle([cx - w // 2 - 8, base_y - h - 16, cx + w // 2 + 8, base_y - h + 4], fill="#c9a86a")


# ─────────────────────────── PAREDES (12) ───────────────────────────


def w_terracota():
    im, d = canvas("#b5654d")
    vgrad(im)
    # Zócalo alto de paneles blancos (repite sin costura: paneles equiespaciados)
    y0 = 700
    d.rectangle([0, y0, S, S], fill="#ece5d8")
    d.rectangle([0, y0 - 26, S, y0 - 6], fill="#f4efe4")
    pw = S // 4
    for i in range(4):
        x = i * pw + 52
        d.rectangle([x, y0 + 60, x + pw - 104, S - 90], outline="#d8cfc0", width=10)
    d.rectangle([0, S - 64, S, S], fill="#d8cfc0")
    im.save(f"{OUT}/wall_estudio_terracota.png")


def w_salvia():
    im, d = canvas("#a8b5a0")
    vgrad(im)
    d.rectangle([0, 150, S, 170], fill="#f4efe4")  # carril de cuadros
    frame(d, 120, 250, 300, 300, "#8a6a4a", art="#e0d6c4")
    frame(d, 604, 250, 300, 300, "#8a6a4a", art="#c9d4c0")
    # zócalo
    d.rectangle([0, 950, S, S], fill="#efe9dc")
    d.rectangle([0, 936, S, 950], fill="#d8cfc0")
    im.save(f"{OUT}/wall_estudio_salvia.png")


def w_ladrillo():
    im, d = canvas("#a35d4a")
    bh, bw, gap = 64, 190, 10
    rnd = random.Random(7)
    for row, y in enumerate(range(0, S, bh + gap)):
        off = (bw // 2) if row % 2 else 0
        for x in range(-bw, S + bw, bw + gap):
            xx = x + off
            c = 255
            shade = rnd.randint(-18, 14)
            col = tuple(max(0, min(255, c0 + shade)) for c0 in (163, 93, 74))
            d.rounded_rectangle([xx, y, xx + bw, y + bh], radius=8, fill=col)
    vgrad(im, (36, 26, 22), alpha_top=34)
    d.rectangle([0, S - 70, S, S], fill="#8f8578")  # solera de hormigón
    im.save(f"{OUT}/wall_estudio_ladrillo.png")


def w_mostaza():
    im, d = canvas("#d9a441")
    vgrad(im)
    # tablero inferior de lamas verticales crema (patrón seamless)
    y0 = 620
    d.rectangle([0, y0, S, S], fill="#efe6d2")
    for x in range(0, S, 64):
        d.rectangle([x + 4, y0 + 30, x + 58, S - 60], fill="#e6dabe")
        d.rectangle([x + 4, y0 + 30, x + 12, S - 60], fill="#d9cba6")
    d.rectangle([0, y0 - 22, S, y0 - 4], fill="#f6f0e0")
    d.rectangle([0, S - 52, S, S], fill="#c9b98e")
    im.save(f"{OUT}/wall_estudio_mostaza.png")


def w_estanteria():
    im, d = canvas("#9aa892")
    vgrad(im)
    # estante a todo el ancho (la repetición ×2 lo lee como estantería corrida)
    y = 560
    objs = [(60, "plant"), (240, "books"), (470, "jar1"), (600, "books2"), (830, "jar2")]
    for ox, kind in objs:
        if kind == "plant":
            plant(d, ox + 60, y, 0.62)
        elif kind == "books":
            books(d, ox, y - 190, 180, 7, ox)
        elif kind == "jar1":
            jar(d, ox + 40, y, 110, 150, "#d9c9a3")
        elif kind == "books2":
            books(d, ox, y - 170, 160, 6, ox + 3)
        elif kind == "jar2":
            jar(d, ox + 40, y, 95, 120, "#a8b5a0")
    d.rectangle([0, y, S, y + 34], fill="#8a6a4a")
    d.rectangle([0, y + 34, S, y + 44], fill="#6f5439")
    d.rectangle([0, 950, S, S], fill="#efe9dc")
    d.rectangle([0, 936, S, 950], fill="#d8cfc0")
    im.save(f"{OUT}/wall_estudio_estanteria.png")


def w_arcos():
    im, d = canvas("#efe6d8")
    vgrad(im, (30, 22, 18))
    # dos arcos pintados simétricos (al repetir ×2 → ritmo de 4 arcos)
    for cx in (S // 4, 3 * S // 4):
        d.pieslice([cx - 150, 240, cx + 150, 540], 180, 360, fill="#c98d7e")
        d.rectangle([cx - 150, 390, cx + 150, 700], fill="#c98d7e")
        d.pieslice([cx - 110, 280, cx + 110, 500], 180, 360, fill="#b5654d")
        d.rectangle([cx - 110, 390, cx + 110, 660], fill="#b5654d")
        d.ellipse([cx - 40, 440, cx + 40, 520], fill="#f4efe4")
    d.rectangle([0, 940, S, S], fill="#e0d6c4")
    d.rectangle([0, 926, S, 940], fill="#d0c4b0")
    im.save(f"{OUT}/wall_estudio_arcos.png")


def w_oliva_lunares():
    im, d = canvas("#8a8f6a")
    vgrad(im)
    r, step = 26, 148
    for row, y in enumerate(range(80, S - 120, step)):
        off = (step // 2) if row % 2 else 0
        for x in range(-step, S + step, step):
            d.ellipse([x + off - r, y - r, x + off + r, y + r], fill="#9aa07e")
    d.rectangle([0, 940, S, S], fill="#efe9dc")
    d.rectangle([0, 926, S, 940], fill="#d0c4b0")
    im.save(f"{OUT}/wall_estudio_oliva.png")


def w_arcilla():
    im, d = canvas("#c98d7e")
    vgrad(im)
    # baldosa diamante en la mitad baja (cocina americana) — patrón seamless
    y0 = 560
    d.rectangle([0, y0, S, S], fill="#efe6d8")
    t = 64
    for yy in range(y0 - t, S + t, t):
        for xx in range(-t, S + t, t):
            pts = [(xx + t // 2, yy), (xx + t, yy + t // 2), (xx + t // 2, yy + t), (xx, yy + t // 2)]
            col = "#d9a441" if ((xx // t + yy // t) % 2 == 0) else "#b5654d"
            d.polygon(pts, fill=col)
    d.rectangle([0, y0 - 24, S, y0 - 6], fill="#f6f0e0")
    im.save(f"{OUT}/wall_estudio_arcilla.png")


def w_cemento():
    im, d = canvas("#b9b4ac")
    rnd = random.Random(11)
    for _ in range(900):  # veteado de hormigón
        x, y = rnd.randrange(S), rnd.randrange(S)
        g = rnd.randint(-14, 10)
        d.point((x, y), fill=(185 + g, 180 + g, 172 + g))
    # dos carteles simétricos (cine de barrio)
    for cx in (S // 4, 3 * S // 4):
        d.rectangle([cx - 120, 200, cx + 120, 560], fill="#efe6d8", outline="#7a6a53", width=8)
        d.rectangle([cx - 92, 232, cx + 92, 400], fill="#c98d7e")
        d.ellipse([cx - 60, 250, cx + 60, 370], fill="#8a8f6a")
        d.rectangle([cx - 92, 430, cx + 92, 456], fill="#7a6a53")
        d.rectangle([cx - 70, 480, cx + 70, 500], fill="#c0b6a6")
    d.rectangle([0, S - 64, S, S], fill="#8f8578")
    im.save(f"{OUT}/wall_estudio_cemento.png")


def w_dado():
    im, d = canvas("#efe6d8")
    vgrad(im, (24, 18, 14))
    d.rectangle([0, 620, S, S], fill="#8a8f6a")  # guarda inferior oliva
    d.rectangle([0, 606, S, 620], fill="#6f745a")  # moldura
    d.rectangle([0, 946, S, S], fill="#efe9dc")
    d.rectangle([0, 932, S, 946], fill="#d8cfc0")
    # moldura cuadro superior
    d.rectangle([0, 170, S, 186], fill="#e0d6c4")
    im.save(f"{OUT}/wall_estudio_dado.png")


def w_listones():
    im, d = canvas("#c9b18a")
    lw = 74
    for i, x in enumerate(range(0, S, lw)):
        tone = 255 if i % 2 == 0 else 244
        d.rectangle([x, 0, x + lw - 6, S], fill=(tone, int(tone * 0.87), int(tone * 0.68)))
        d.rectangle([x + lw - 6, 0, x + lw, S], fill=(150, 120, 88))
    vgrad(im, (30, 22, 16))
    d.rectangle([0, 940, S, S], fill="#8a6a4a")
    im.save(f"{OUT}/wall_estudio_listones.png")


def w_mosaico():
    im, d = canvas("#b7aeb6")
    vgrad(im, (26, 20, 20))
    # banda de hexágonos a media altura (patrón seamless)
    y0, r, w_ = 430, 46, 4
    row_h = int(r * 1.5)
    for row in range(3):
        yy = y0 + row * row_h
        off = (r * math.sqrt(3)) if row % 2 else 0
        for xx in range(-int(r * 2), S + int(r * 2), int(r * math.sqrt(3))):
            hexpt(d, xx + off, yy, r - 3, fill="#d9c9a3" if (row + xx) % 2 else "#b5654d", outline="#8f8578", w=w_)
    d.rectangle([0, 940, S, S], fill="#efe9dc")
    d.rectangle([0, 926, S, 940], fill="#d0c4b0")
    im.save(f"{OUT}/wall_estudio_mosaico.png")


def w_mirador():
    im, d = canvas("#d9c9a3")
    vgrad(im)
    # ventana falsa simétrica con macetas (el clásico mirador de vecindad)
    for cx in (S // 4, 3 * S // 4):
        d.rectangle([cx - 170, 220, cx + 170, 700], fill="#f6f0e0", outline="#8a6a4a", width=16)
        d.rectangle([cx - 140, 250, cx + 140, 560], fill="#c9d4c0")
        d.line([(cx, 250), (cx, 560)], fill="#8a6a4a", width=10)
        d.line([(cx - 140, 405), (cx + 140, 405)], fill="#8a6a4a", width=10)
        d.rectangle([cx - 190, 700, cx + 190, 740], fill="#b5654d")
        plant(d, cx - 100, 700, 0.5)
        plant(d, cx + 100, 700, 0.5)
    d.rectangle([0, 950, S, S], fill="#efe9dc")
    d.rectangle([0, 936, S, 950], fill="#d8cfc0")
    im.save(f"{OUT}/wall_estudio_mirador.png")


# ─────────────────────────── SUELOS (5, seamless) ───────────────────────────


def f_madera_clara():
    im, d = canvas("#d9b98a")
    ph, gap = 128, 8
    rnd = random.Random(3)
    for row, y in enumerate(range(0, S, ph)):
        off = rnd.choice([0, 213, 426, 639])  # juntas desplazadas (wrap por muestreo mod)
        d.rectangle([0, y, S, y + ph], fill=(217 + rnd.randint(-10, 8), 185 + rnd.randint(-10, 8), 138 + rnd.randint(-10, 8)))
        for x in range(off, S + S, 512):
            xx = x % S
            d.line([(xx, y), (xx, y + ph)], fill="#b99a6e", width=6)
        d.line([(0, y + ph - gap // 2), (S, y + ph - gap // 2)], fill="#c2a276", width=gap)
    im.save(f"{OUT}/floor_madera_clara.png")


def f_hidraulico():
    im, d = canvas("#e6ddcc")
    t = 256
    for gy in range(0, S, t):
        for gx in range(0, S, t):
            cx, cy = gx + t // 2, gy + t // 2
            d.rectangle([gx + 6, gy + 6, gx + t - 6, gy + t - 6], fill="#efe8da", outline="#c9bfa8", width=6)
            hexpt(d, cx, cy, 92, fill="#b5654d")
            hexpt(d, cx, cy, 56, fill="#e6ddcc")
            d.ellipse([cx - 22, cy - 22, cx + 22, cy + 22], fill="#8a8f6a")
    im.save(f"{OUT}/floor_hidraulico.png")


def f_terrazo():
    im, d = canvas("#e6ddd2")
    rnd = random.Random(5)
    cols = ["#b5654d", "#8a8f6a", "#c9b18a", "#7a6a53", "#d9a441"]
    for _ in range(1500):
        x, y = rnd.randrange(S), rnd.randrange(S)
        r = rnd.randint(3, 12)
        c = cols[rnd.randrange(len(cols))]
        d.ellipse([x - r, y - r, x + r, y + r], fill=c)
    im.save(f"{OUT}/floor_terrazo.png")


def f_damero():
    im, d = canvas("#e0d6c4")
    t = 256
    for gy in range(0, S, t):
        for gx in range(0, S, t):
            if (gx // t + gy // t) % 2 == 0:
                d.rectangle([gx, gy, gx + t, gy + t], fill="#c98d7e")
            else:
                d.rectangle([gx, gy, gx + t, gy + t], fill="#efe8da")
    im.save(f"{OUT}/floor_damero.png")


def f_nogal():
    im, d = canvas("#8a6a4a")
    pw, gap = 106, 6
    rnd = random.Random(9)
    for row, y in enumerate(range(0, S, pw)):
        off = rnd.choice([0, 318, 636])
        d.rectangle([0, y, S, y + pw], fill=(138 + rnd.randint(-12, 10), 106 + rnd.randint(-10, 8), 74 + rnd.randint(-8, 8)))
        for x in range(off, S + S, 480):
            xx = x % S
            d.line([(xx, y), (xx, y + pw)], fill="#6f5439", width=6)
        d.line([(0, y + pw - gap // 2), (S, y + pw - gap // 2)], fill="#75593d", width=gap)
    im.save(f"{OUT}/floor_nogal.png")


if __name__ == "__main__":
    w_terracota()
    w_salvia()
    w_ladrillo()
    w_mostaza()
    w_estanteria()
    w_arcos()
    w_oliva_lunares()
    w_arcilla()
    w_cemento()
    w_dado()
    w_listones()
    w_mosaico()
    w_mirador()
    f_madera_clara()
    f_hidraulico()
    f_terrazo()
    f_damero()
    f_nogal()
    print("OK —", len(os.listdir(OUT)), "archivos en", OUT)
