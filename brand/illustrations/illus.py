import math
OUT = '/tmp/claude-0/-home-claude/1e802e8b-79a7-501e-b50d-f1c9d494fc7d/scratchpad/illus/'
INK = '#5A0C18'; RIB = '#8A242A'; RIBD = '#6D1833'; GOLD = '#C8944A'; BRONZE = '#9C724E'
TISSUE = '#FBF4E8'; IVORY = '#FCEFDC'; KRAFT = '#DDBE93'; KRAFT_S = '#C9A273'; KRAFT_T = '#E8D0AA'; KRAFT_IN = '#B8915F'
SHADOW = '#EFE6DA'; CELLO = '#F1F4F4'; CRINKLE = '#E2C08F'; ROSE = '#F3E5EA'

def P(d, fill='none', stroke=INK, sw=1.5):
    s = f'<path d="{d}" fill="{fill}"'
    if stroke: s += f' stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round" stroke-linecap="round"'
    return s + '/>'
def ellipse(cx, cy, rx, ry):
    return f'M{cx-rx} {cy}a{rx} {ry} 0 1 0 {2*rx} 0a{rx} {ry} 0 1 0 {-2*rx} 0Z'
def circle(cx, cy, r): return ellipse(cx, cy, r, r)
def xf(pts, ang, tx, ty):
    c, s = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    return [(tx + c*x - s*y, ty + s*x + c*y) for x, y in pts]
def poly(pts, close=True):
    return 'M' + ' L'.join(f'{x:.2f} {y:.2f}' for x, y in pts) + ('Z' if close else '')
def heart(cx, cy, s):
    # small heart centred at cx,cy, size s (width)
    k = s/24
    pts = 'M12 20.5C7 16.6 3.5 13.4 3.5 9.6 3.5 7.2 5.3 5.5 7.6 5.5c1.9 0 3.4 1.1 4.4 2.8 1-1.7 2.5-2.8 4.4-2.8 2.3 0 4.1 1.7 4.1 4.1 0 3.8-3.5 7-8.5 10.9z'
    # transform by scaling a copy: emit as a path with a transform-free conversion
    import re
    toks = re.findall(r'[A-Za-z]|-?\d*\.?\d+', pts)
    out = []; i = 0; cmd = None; rel = False; argi = 0
    # simple scaler: absolute coords scaled+translated, relative coords scaled
    res = []
    while i < len(toks):
        t = toks[i]
        if t.isalpha():
            cmd = t; res.append(t); i += 1; argi = 0; continue
        v = float(t)
        if cmd.isupper():
            v = v*k + (cx - 12*k if argi % 2 == 0 else cy - 13*k)
        else:
            v = v*k
        res.append(f'{v:.2f}'); argi += 1; i += 1
    return ' '.join(res)
def tag(cx, cy, ang, w=22, h=34, clip=5):
    pts = [(-w/2, clip), (-w/2+clip, 0), (w/2-clip, 0), (w/2, clip), (w/2, h), (-w/2, h)]
    T = xf(pts, ang, cx, cy)
    hole = xf([(0, clip+1.5)], ang, cx, cy)[0]
    hrt = xf([(0, h*0.62)], ang, cx, cy)[0]
    return [P(poly(T), IVORY, INK, 1.2), P(circle(hole[0], hole[1], 1.9), '#FFFFFF', GOLD, 1.0), P(heart(hrt[0], hrt[1], 7), RIB, None)], hole
def bow(cx, cy, scale=1.0):
    s = scale
    def p(x, y): return f'{cx + x*s:.2f} {cy + y*s:.2f}'
    loopL = f'M{p(0,0)} C{p(-12,-12)} {p(-26,-10)} {p(-22,0)} C{p(-18,8)} {p(-6,6)} {p(0,0)}Z'
    loopR = f'M{p(0,0)} C{p(12,-12)} {p(26,-10)} {p(22,0)} C{p(18,8)} {p(6,6)} {p(0,0)}Z'
    tailL = f'M{p(-3,3)} L{p(-10,22)} L{p(-6,20)} L{p(-4,24)} L{p(1,4)}Z'
    tailR = f'M{p(3,3)} L{p(11,20)} L{p(7,19)} L{p(6,23)} L{p(-1,4)}Z'
    knot = f'M{p(-4,-4)} L{p(4,-4)} L{p(4,4)} L{p(-4,4)}Z'
    return [P(tailL, RIB, INK, 1.1), P(tailR, RIB, INK, 1.1), P(loopL, RIB, INK, 1.2), P(loopR, RIB, INK, 1.2), P(knot, RIBD, INK, 1.1)]
def svg(parts, w=220, h=170):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="24 26 172 140" width="344" height="280" aria-hidden="true">' + ''.join(parts) + '</svg>\n'

# 1. tissue pouch
p1 = [P(ellipse(110, 158, 48, 5), SHADOW, None)]
p1 += [P('M94 74 C72 88 60 108 63 128 C66 148 88 156 110 156 C132 156 154 148 157 128 C160 108 148 88 126 74Z', TISSUE, INK, 1.6)]
p1 += [P('M100 80 C95 100 93 120 96 142', 'none', '#C7AE90', 1.0), P('M121 80 C126 100 127 120 124 142', 'none', '#C7AE90', 1.0), P('M110 84 C109 104 110 126 111 150', 'none', '#D9C6AE', 0.9)]
p1 += [P('M94 74 C88 62 80 54 70 47 C77 46 83 48 88 52 C88 45 90 39 94 32 C98 39 100 45 101 52 C104 45 108 38 113 32 C115 39 116 45 116 52 C120 46 126 42 134 40 C131 47 129 53 127 59 C132 56 138 54 146 54 C139 60 132 66 126 74Z', TISSUE, INK, 1.5)]
p1 += [P('M92 71 C102 75 118 75 128 71 L128 77 C118 81 102 81 92 77Z', RIB, INK, 1.2)]
p1 += bow(110, 74, 0.95)
p1 += [P(circle(110, 122, 13.5), IVORY, GOLD, 1.4), P(circle(110, 122, 10.5), 'none', GOLD, 0.7), P(heart(110, 122.5, 8), RIB, None)]
t1, hole1 = tag(150, 96, -14)
p1 += [P(f'M113 78 C124 84 136 90 {hole1[0]:.1f} {hole1[1]:.1f}', 'none', BRONZE, 1.0)] + t1
open(OUT + 'pack-1-wrap.svg', 'w').write(svg(p1))

# 2. closed kraft box with ribbon and seal sticker
p2 = [P(ellipse(110, 151, 76, 6), SHADOW, None)]
p2 += [P('M40 82 L138 82 L138 146 L40 146Z', KRAFT, INK, 1.5), P('M138 82 L174 62 L174 126 L138 146Z', KRAFT_S, INK, 1.5), P('M40 82 L76 62 L174 62 L138 82Z', KRAFT_T, INK, 1.5)]
p2 += [P('M40 94 L138 94 L174 74', 'none', INK, 1.1)]
p2 += [P('M83 82 L95 82 L95 146 L83 146Z', RIB, INK, 1.2), P('M83 82 L95 82 L131 62 L119 62Z', RIB, INK, 1.2)]
p2 += bow(107, 72, 1.0)
p2 += [P('M103 108 L135 108 Q137 108 137 110 L137 122 Q137 124 135 124 L103 124 Q101 124 101 122 L101 110 Q101 108 103 108Z', IVORY, GOLD, 1.2),
       P('M109 114 L130 114', 'none', RIBD, 1.6), P('M111 119 L128 119', 'none', BRONZE, 0.9), P(heart(105.5, 116.2, 4.5), RIB, None)]
open(OUT + 'pack-2-box.svg', 'w').write(svg(p2))

# 3. gift set: open box, crinkle, three candles, card
p3 = [P(ellipse(110, 153, 82, 6), SHADOW, None)]
p3 += [P('M34 104 L70 82 L186 82 L150 104Z', KRAFT_IN, INK, 1.4)]
# back inner wall line
p3 += [P('M70 82 L70 92', 'none', INK, 0.9)]
# card at back right
p3 += [P('M156 88 L163 52 L195 57 L188 93Z', IVORY, INK, 1.3), P(heart(176, 66, 6), RIB, None), P('M168 76 L184 78.5', 'none', BRONZE, 0.9), P('M167 81 L181 83', 'none', BRONZE, 0.9)]
# tree candle
p3 += [P('M80 46 L71 66 L75 66 L67 84 L71 84 L62 102 L98 102 L89 84 L93 84 L85 66 L89 66Z', TISSUE, INK, 1.4)]
# pillar candle + flame
p3 += [P('M104 64 L126 64 L126 102 L104 102Z', ROSE, INK, 1.4), P('M115 64 L115 58', 'none', INK, 1.0), P('M115 47 C119 52 119.5 55 115 58.5 C110.5 55 111 52 115 47Z', GOLD, None)]
# ribbed round candle
p3 += [P('M134 102 C131 88 138 76 146 76 C154 76 161 88 158 102Z', TISSUE, INK, 1.4), P('M140 101 C139 90 142 82 146 79 M152 101 C153 90 150 82 146 79', 'none', '#C7AE90', 0.9)]
# small tags on candles
p3 += [P('M88 74 C94 76 98 80 99 86', 'none', BRONZE, 0.8)]
t3, _ = tag(101, 84, -8, w=12, h=17, clip=3)
p3 += t3
# crinkle paper in front of items
crk = 'M34 104 L38 97 L43 102 L47 94 L52 101 L57 93 L62 100 L67 92 L72 99 L77 91 L82 99 L87 92 L92 100 L97 92 L102 99 L107 91 L112 99 L117 92 L122 100 L127 92 L132 99 L137 91 L142 98 L147 90 L152 97 L157 89 L162 95 L167 88 L172 94 L177 86 L182 91 L186 82 L186 90 L150 104Z'
p3 += [P(crk, CRINKLE, BRONZE, 1.0)]
# tissue corners
p3 += [P('M34 104 L44 90 L54 104Z', '#FFFFFF', INK, 1.0), P('M150 104 L156 88 L166 98Z', '#FFFFFF', INK, 1.0)]
# box faces
p3 += [P('M34 104 L150 104 L150 148 L34 148Z', KRAFT, INK, 1.5), P('M150 104 L186 82 L186 126 L150 148Z', KRAFT_S, INK, 1.5)]
p3 += [P('M80 118 L104 118 Q106 118 106 120 L106 130 Q106 132 104 132 L80 132 Q78 132 78 130 L78 120 Q78 118 80 118Z', IVORY, GOLD, 1.1), P('M84 123 L101 123', 'none', RIBD, 1.4), P('M86 127.5 L99 127.5', 'none', BRONZE, 0.8)]
open(OUT + 'pack-3-gift.svg', 'w').write(svg(p3))

# 4. clear cellophane bag
p4 = [P(ellipse(110, 158, 44, 5), SHADOW, None)]
p4 += [P('M74 156 L74 80 C74 72 80 68 88 64 L98 58 L122 58 L132 64 C140 68 146 72 146 80 L146 156Z', CELLO, BRONZE, 1.3)]
p4 += [P('M110 84 L100 104 L104 104 L95 124 L99 124 L90 146 L130 146 L121 124 L125 124 L116 104 L120 104Z', TISSUE, INK, 1.4), P('M96 151 L124 151', 'none', '#C7AE90', 1.0)]
p4 += [P('M81 92 L81 142', 'none', '#FFFFFF', 2.6), P('M139 88 L139 116', 'none', '#FFFFFF', 2.2), P('M84 84 C86 79 90 75 95 72', 'none', '#FFFFFF', 1.8)]
p4 += [P('M98 58 L92 43 L99 48 L104 37 L110 47 L116 37 L121 48 L128 43 L122 58Z', CELLO, BRONZE, 1.2)]
p4 += [P('M96 55 L124 55 L124 61 L96 61Z', RIB, INK, 1.1)]
p4 += bow(110, 58, 0.9)
t4, hole4 = tag(156, 78, -12)
p4 += [P(f'M114 60 C126 64 140 70 {hole4[0]:.1f} {hole4[1]:.1f}', 'none', BRONZE, 1.0)] + t4
open(OUT + 'pack-4-bag.svg', 'w').write(svg(p4))
print('ok')
