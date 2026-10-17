# -*- coding: utf-8 -*-
"""Turn the fonts into glyph atlases (path data + advances + kerning) for the profile's SVG renderer.
Text in the SVGs becomes outlines, so it looks identical everywhere (GitHub's image proxy blocks web fonts).

Only needed to change fonts or add characters:  pip install fonttools uharfbuzz && python scripts/make_atlas.py"""
import io, json, os, sys, urllib.request
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
import uharfbuzz as hb

HERE = os.path.dirname(os.path.abspath(__file__))
DL = os.path.join(HERE, '.fonts')
OUT = os.path.join(HERE, 'glyphs')
SRC = 'https://raw.githubusercontent.com/google/fonts/main/ofl/'
FILES = {'bricolage.ttf': 'bricolagegrotesque/BricolageGrotesque%5Bopsz%2Cwdth%2Cwght%5D.ttf',
         'spacemono-regular.ttf': 'spacemono/SpaceMono-Regular.ttf', 'spacemono-bold.ttf': 'spacemono/SpaceMono-Bold.ttf',
         'inter.ttf': 'inter/Inter%5Bopsz%2Cwght%5D.ttf',
         'fraunces.ttf': 'fraunces/Fraunces%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf',
         'fraunces-italic.ttf': 'fraunces/Fraunces-Italic%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf'}
os.makedirs(DL, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
for name, url in FILES.items():
    if not os.path.exists(os.path.join(DL, name)):
        urllib.request.urlretrieve(SRC + url, os.path.join(DL, name))
CHARS = ''.join(chr(c) for c in range(32, 127)) + 'éÉ·—–’•→↗★✦♥'


def build(src, name, location=None):
    font = TTFont(os.path.join(DL, src))
    if location:
        axes = {a.axisTag: (a.minValue, a.maxValue) for a in font['fvar'].axes}
        print(name, 'axes', axes)
        font = instancer.instantiateVariableFont(font, location)
    buf = io.BytesIO(); font.save(buf); data = buf.getvalue()
    cmap = font.getBestCmap(); gs = font.getGlyphSet(); hmtx = font['hmtx']
    upm = font['head'].unitsPerEm; os2 = font['OS/2']
    glyphs = {}
    for ch in CHARS:
        gname = cmap.get(ord(ch))
        if not gname:
            continue
        pen = SVGPathPen(gs, ntos=lambda v: ('%d' % round(v)))
        gs[gname].draw(pen)
        glyphs[ch] = {'d': pen.getCommands(), 'w': hmtx[gname][0]}
    # Kerning: shape every pair with HarfBuzz and keep the difference from the plain advances.
    hbfont = hb.Font(hb.Face(data))
    def adv(text):
        b = hb.Buffer(); b.add_str(text); b.guess_segment_properties()
        hb.shape(hbfont, b, {'liga': False, 'calt': False})
        return sum(p.x_advance for p in b.glyph_positions)
    single = {c: adv(c) for c in glyphs}
    kern = {}
    for a in glyphs:
        for b in glyphs:
            k = adv(a + b) - single[a] - single[b]
            if k:
                kern[a + b] = k
    atlas = {'name': name, 'upm': upm, 'ascender': os2.sTypoAscender, 'descender': os2.sTypoDescender,
             'capHeight': getattr(os2, 'sCapHeight', 0), 'xHeight': getattr(os2, 'sxHeight', 0),
             'glyphs': glyphs, 'kern': kern}
    path = os.path.join(OUT, name + '.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(atlas, f, ensure_ascii=False, separators=(',', ':'))
    print(name, len(glyphs), 'glyphs,', len(kern), 'kern pairs,', os.path.getsize(path) // 1024, 'KB', 'missing:',
          ''.join(c for c in CHARS if c not in glyphs))


build('bricolage.ttf', 'display', {'wght': 800, 'opsz': 96, 'wdth': 100})
build('spacemono-regular.ttf', 'mono')
build('spacemono-bold.ttf', 'mono-bold')
build('inter.ttf', 'sans', {'wght': 400, 'opsz': 14})
build('inter.ttf', 'sans-semi', {'wght': 600, 'opsz': 14})
build('fraunces.ttf', 'serif', {'wght': 650, 'opsz': 72, 'SOFT': 50, 'WONK': 0})
build('fraunces-italic.ttf', 'serif-it', {'wght': 600, 'opsz': 72, 'SOFT': 100, 'WONK': 1})
