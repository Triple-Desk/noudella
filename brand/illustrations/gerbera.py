"""Original gerbera (daisy) line art for Noudella's event kit.

Everything is built as point geometry and transformed in Python, so every line keeps one
stroke weight (no squashed strokes on tilted flowers). Petals are filled with the ground
colour so front petals hide what is behind them.
"""
import math, random, sys, os

def fmt(v):
    s = f"{v:.2f}".rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s

class Aff:
    """2D affine transform: x' = a x + c y + e ; y' = b x + d y + f"""
    def __init__(self, a=1, b=0, c=0, d=1, e=0, f=0):
        self.m = (a, b, c, d, e, f)
    def __mul__(self, o):  # self after o
        a, b, c, d, e, f = self.m
        A, B, C, D, E, F = o.m
        return Aff(a*A + c*B, b*A + d*B, a*C + c*D, b*C + d*D, a*E + c*F + e, b*E + d*F + f)
    def p(self, x, y):
        a, b, c, d, e, f = self.m
        return (a*x + c*y + e, b*x + d*y + f)
    @staticmethod
    def T(x, y): return Aff(1, 0, 0, 1, x, y)
    @staticmethod
    def R(deg):
        r = math.radians(deg); return Aff(math.cos(r), math.sin(r), -math.sin(r), math.cos(r), 0, 0)
    @staticmethod
    def S(sx, sy=None): return Aff(sx, 0, 0, sx if sy is None else sy, 0, 0)

def path_d(cmds, M):
    """cmds: list of ('M',(x,y)) ('L',(x,y)) ('C',(x1,y1),(x2,y2),(x,y)) ('Q',(x1,y1),(x,y)) ('Z',)"""
    out = []
    for c in cmds:
        k = c[0]
        if k == 'Z':
            out.append('Z'); continue
        pts = [M.p(*q) for q in c[1:]]
        out.append(k + ' '.join(fmt(x) + ' ' + fmt(y) for x, y in pts))
    return ''.join(out)

def circle_cmds(cx, cy, r):
    k = 0.5523 * r
    return [('M', (cx + r, cy)),
            ('C', (cx + r, cy + k), (cx + k, cy + r), (cx, cy + r)),
            ('C', (cx - k, cy + r), (cx - r, cy + k), (cx - r, cy)),
            ('C', (cx - r, cy - k), (cx - k, cy - r), (cx, cy - r)),
            ('C', (cx + k, cy - r), (cx + r, cy - k), (cx + r, cy)), ('Z',)]

def petal_cmds(r0, r1, w, notch=True, bend=0.0):
    """Petal pointing along +x from radius r0 to r1, max width w. bend skews the tip sideways."""
    L = r1 - r0
    b = w * 0.32
    xm = r0 + 0.58 * L
    hw = w / 2
    tb = bend * w  # tip offset
    cmds = [('M', (r0, -b)),
            ('C', (r0 + L * 0.22, -b * 1.5), (xm - L * 0.18, -hw), (xm, -hw + tb * 0.3)),
            ('C', (xm + L * 0.22, -hw + tb * 0.5), (r1, -w * 0.34 + tb), (r1, -w * 0.11 + tb))]
    if notch:
        cmds.append(('Q', (r1 - w * 0.26, tb), (r1, w * 0.11 + tb)))
    else:
        cmds.append(('Q', (r1 + w * 0.12, tb), (r1, w * 0.11 + tb)))
    cmds += [('C', (r1, w * 0.34 + tb), (xm + L * 0.22, hw + tb * 0.5), (xm, hw + tb * 0.3)),
             ('C', (xm - L * 0.18, hw), (r0 + L * 0.22, b * 1.5), (r0, b)), ('Z',)]
    return cmds

class Art:
    def __init__(self, line, ground, sw):
        self.line, self.ground, self.sw = line, ground, sw
        self.parts = []
    def fill_path(self, d):
        self.parts.append(f'<path d="{d}" fill="{self.ground}" stroke="{self.line}" stroke-width="{fmt(self.sw)}" stroke-linejoin="round"/>')
    def line_path(self, d, scale=1.0):
        self.parts.append(f'<path d="{d}" fill="none" stroke="{self.line}" stroke-width="{fmt(self.sw * scale)}" stroke-linecap="round" stroke-linejoin="round"/>')
    def dot(self, x, y, r):
        self.parts.append(f'<circle cx="{fmt(x)}" cy="{fmt(y)}" r="{fmt(r)}" fill="{self.line}"/>')

    def flower(self, cx, cy, R, rot=0.0, tilt=1.0, n=20, seed=1, veins=True, pw=1.0):
        """Gerbera head. tilt<1 squashes it (seen at an angle); rot turns the whole head."""
        rnd = random.Random(seed)
        M = Aff.T(cx, cy) * Aff.R(rot) * Aff.S(1, tilt)
        step = 360.0 / n
        # back ring, half a step off, a little shorter
        for i in range(n):
            a = i * step + step / 2 + rnd.uniform(-2.5, 2.5)
            r1 = R * rnd.uniform(0.84, 0.92)
            Pm = M * Aff.R(a)
            self.fill_path(path_d(petal_cmds(R * 0.30, r1, R * rnd.uniform(0.15, 0.18) * pw, notch=rnd.random() < 0.6, bend=rnd.uniform(-0.15, 0.15)), Pm))
        # front ring
        for i in range(n):
            a = i * step + rnd.uniform(-2.0, 2.0)
            r1 = R * rnd.uniform(0.95, 1.03)
            Pm = M * Aff.R(a)
            self.fill_path(path_d(petal_cmds(R * 0.27, r1, R * rnd.uniform(0.17, 0.2) * pw, notch=rnd.random() < 0.7, bend=rnd.uniform(-0.12, 0.12)), Pm))
            if veins and i % 2 == 0:
                self.line_path(path_d([('M', (R * 0.42, 0)), ('L', (r1 - R * 0.2, 0))], Pm), 0.55)
        # disc: outer ring, stamen dots, inner ring, heart
        self.fill_path(path_d(circle_cmds(0, 0, R * 0.30), M))
        nd = max(5, min(26, int(2 * math.pi * R * 0.245 / (self.sw * 0.62 * 2 * 2.4))))
        for i in range(nd):
            a = math.radians(i * 360 / nd)
            x, y = M.p(math.cos(a) * R * 0.245, math.sin(a) * R * 0.245)
            self.dot(x, y, self.sw * 0.62)
        self.fill_path(path_d(circle_cmds(0, 0, R * 0.175), M))
        ni = max(0, min(12, int(2 * math.pi * R * 0.11 / (self.sw * 0.5 * 2 * 2.6))))
        for i in range(ni):
            a = math.radians(i * 360 / max(1, ni) + 15)
            x, y = M.p(math.cos(a) * R * 0.11, math.sin(a) * R * 0.11)
            self.dot(x, y, self.sw * 0.5)
        x, y = M.p(0, 0)
        self.dot(x, y, self.sw * 0.7)

    def bud(self, cx, cy, s, rot=0.0):
        """Closed bud pointing up (before rotation), base at (cx, cy)."""
        M = Aff.T(cx, cy) * Aff.R(rot)
        # petals peeking out
        self.fill_path(path_d([('M', (-s * 0.30, -s * 0.55)), ('C', (-s * 0.42, -s * 1.05), (-s * 0.12, -s * 1.38), (0, -s * 1.42)),
                               ('C', (s * 0.12, -s * 1.38), (s * 0.42, -s * 1.05), (s * 0.30, -s * 0.55)), ('Z',)], M))
        self.line_path(path_d([('M', (0, -s * 0.6)), ('C', (-s * 0.06, -s * 0.95), (-s * 0.02, -s * 1.2), (0, -s * 1.36))], M), 0.55)
        self.line_path(path_d([('M', (-s * 0.16, -s * 0.62)), ('C', (-s * 0.26, -s * 0.95), (-s * 0.2, -s * 1.15), (-s * 0.1, -s * 1.3))], M), 0.55)
        self.line_path(path_d([('M', (s * 0.16, -s * 0.62)), ('C', (s * 0.26, -s * 0.95), (s * 0.2, -s * 1.15), (s * 0.1, -s * 1.3))], M), 0.55)
        # calyx (green cup) with pointed sepals
        self.fill_path(path_d([('M', (0, 0)), ('C', (-s * 0.28, -s * 0.05), (-s * 0.5, -s * 0.35), (-s * 0.44, -s * 0.72)),
                               ('L', (-s * 0.28, -s * 0.5)), ('L', (-s * 0.16, -s * 0.78)), ('L', (0, -s * 0.52)),
                               ('L', (s * 0.16, -s * 0.78)), ('L', (s * 0.28, -s * 0.5)), ('L', (s * 0.44, -s * 0.72)),
                               ('C', (s * 0.5, -s * 0.35), (s * 0.28, -s * 0.05), (0, 0)), ('Z',)], M))

    def leaf(self, x, y, length, width, rot, curl=0.18, veins=4):
        """Long gerbera leaf from base (x, y) pointing along +x after rotation; gently lobed edge."""
        M = Aff.T(x, y) * Aff.R(rot)
        L, W = length, width / 2
        c = curl * L
        top = [('M', (0, 0)),
               ('C', (L * 0.12, -W * 0.9), (L * 0.28, -W * 1.05), (L * 0.42, -W * 0.92 + c * 0.2)),
               ('C', (L * 0.5, -W * 1.1 + c * 0.3), (L * 0.66, -W * 0.95 + c * 0.45), (L * 0.74, -W * 0.68 + c * 0.6)),
               ('C', (L * 0.82, -W * 0.7 + c * 0.7), (L * 0.95, -W * 0.25 + c * 0.9), (L, c)),
               ('C', (L * 0.9, W * 0.25 + c * 0.85), (L * 0.78, W * 0.62 + c * 0.6), (L * 0.66, W * 0.7 + c * 0.45)),
               ('C', (L * 0.56, W * 0.98 + c * 0.32), (L * 0.36, W * 1.05 + c * 0.15), (L * 0.28, W * 0.88)),
               ('C', (L * 0.16, W * 0.95), (L * 0.06, W * 0.5), (0, 0)), ('Z',)]
        self.fill_path(path_d(top, M))
        self.line_path(path_d([('M', (L * 0.03, 0)), ('C', (L * 0.35, c * 0.05), (L * 0.66, c * 0.42), (L * 0.88, c * 0.82))], M), 0.6)
        for i in range(veins):
            t = 0.22 + i * (0.56 / max(1, veins - 1))
            yy = c * (t ** 2) * 0.95
            prof = W * 0.62 * math.sin(math.pi * min(0.95, t + 0.08)) ** 0.7
            for sgn in (-1, 1):
                self.line_path(path_d([('M', (L * t, yy)), ('Q', (L * (t + 0.05), yy + sgn * prof * 0.7), (L * (t + 0.11), yy + sgn * prof + c * 0.04))], M), 0.45)

    def stem(self, pts):
        """pts: start, c1, c2, end (cubic)."""
        (x0, y0), c1, c2, e = pts
        self.line_path(path_d([('M', (x0, y0)), ('C', c1, c2, e)], Aff()), 1.0)

    def svg(self, w, h, label='Gerbera flowers'):
        body = '\n'.join(self.parts)
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(w)} {fmt(h)}" width="{fmt(w)}" height="{fmt(h)}" '
                f'role="img" aria-label="{label}">\n{body}\n</svg>\n')


# ---------------- compositions ----------------

def corner(line, ground, sw):
    """Square 100x100 cluster for the bottom-right corner of tags and cards; stems run off the edges."""
    a = Art(line, ground, sw)
    a.stem(((92, 24), (97, 52), (99, 76), (106, 100)))
    a.stem(((64, 64), (70, 80), (76, 94), (82, 106)))
    a.stem(((24, 86), (32, 94), (40, 100), (48, 108)))
    a.leaf(90, 106, 40, 13, -96, curl=0.16, veins=3)
    a.leaf(50, 104, 36, 12, -162, curl=-0.12, veins=3)
    a.bud(92, 26, 9.5, 12)
    a.flower(24, 86, 17, rot=-20, tilt=0.74, n=13, seed=7, veins=False, pw=1.3)
    a.flower(64, 62, 27, rot=6, tilt=1.0, n=15, seed=3, veins=False, pw=1.3)
    return a.svg(100, 100)

def spray(line, ground, sw):
    """Tall bouquet 240x320: three heads, two buds, leaves; stems gathered at the bottom centre."""
    a = Art(line, ground, sw)
    base = (122, 330)
    a.stem(((70, 140), (78, 210), (104, 270), base))
    a.stem(((168, 92), (160, 170), (136, 250), base))
    a.stem(((150, 205), (144, 250), (132, 290), base))
    a.stem(((46, 64), (60, 120), (92, 230), (118, 332)))
    a.stem(((204, 168), (196, 220), (150, 280), (126, 332)))
    a.leaf(118, 300, 78, 22, -150, curl=0.12, veins=4)
    a.leaf(126, 296, 84, 24, -28, curl=-0.14, veins=4)
    a.leaf(120, 318, 60, 18, -112, curl=0.1, veins=3)
    a.bud(46, 66, 15, -14)
    a.bud(204, 170, 13, 24)
    a.flower(150, 205, 30, rot=-18, tilt=0.7, n=18, seed=11, veins=False)
    a.flower(70, 140, 40, rot=12, tilt=1.0, n=22, seed=5)
    a.flower(168, 92, 44, rot=-6, tilt=1.0, n=22, seed=9)
    return a.svg(240, 330)

def single(line, ground, sw):
    """One head with a short stem and leaf, 80x110."""
    a = Art(line, ground, sw)
    a.stem(((40, 40), (42, 70), (38, 92), (40, 112)))
    a.leaf(40, 96, 30, 10, -40, curl=-0.1, veins=2)
    a.flower(40, 38, 28, rot=4, tilt=1.0, n=20, seed=21)
    return a.svg(80, 110)

def head(line, ground, sw):
    """A single head, no stem, 60x60 (for dividers and small marks)."""
    a = Art(line, ground, sw)
    a.flower(30, 30, 28, rot=0, tilt=1.0, n=20, seed=21)
    return a.svg(60, 60)

if __name__ == '__main__':
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    IVORY, BURG, GOLD = '#FBF4E8', '#6D1833', '#C8944A'
    sets = {
        # name: (fn, line, ground, stroke)
        'gerbera-corner-ivory': (corner, BURG, IVORY, 1.5),
        'gerbera-corner-burgundy': (corner, GOLD, BURG, 1.5),
        'gerbera-spray-ivory': (spray, BURG, IVORY, 1.25),
        'gerbera-spray-burgundy': (spray, GOLD, BURG, 1.25),
        'gerbera-single-ivory': (single, BURG, IVORY, 0.9),
        'gerbera-single-burgundy': (single, GOLD, BURG, 0.9),
        'gerbera-head-burgundy': (head, GOLD, BURG, 0.9),
        'gerbera-head-ivory': (head, BURG, IVORY, 0.9),
    }
    for name, (fn, line, ground, sw) in sets.items():
        with open(os.path.join(out, name + '.svg'), 'w') as f:
            f.write(fn(line, ground, sw))
    print('ok', len(sets))
