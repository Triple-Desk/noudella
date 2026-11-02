"""Original botanical sprigs for Noudella: tapered stems, two-tone olive leaves, berry clusters. Units: mm."""
import math, random

PALETTES = {
    'ivory': dict(stem='#9C724E', leafA='#E6CDA4', leafB='#D2A66B', leafA2='#D9B582', leafB2='#C8944A', vein='#A57B52',
                  berry1='#6D1833', berry2='#8A242A', hi='#C98A8C', twig='#9C724E'),
    'wine':  dict(stem='#C8944A', leafA='#EBD3AA', leafB='#D3A866', leafA2='#DDBB86', leafB2='#C8944A', vein='#F5E6CB',
                  berry1='#A9363F', berry2='#BE4B4B', hi='#EDB3AA', twig='#C8944A'),
}

def bez(P, t):
    (x0,y0),(x1,y1),(x2,y2),(x3,y3) = P
    u = 1-t
    x = u*u*u*x0 + 3*u*u*t*x1 + 3*u*t*t*x2 + t*t*t*x3
    y = u*u*u*y0 + 3*u*u*t*y1 + 3*u*t*t*y2 + t*t*t*y3
    dx = 3*u*u*(x1-x0) + 6*u*t*(x2-x1) + 3*t*t*(x3-x2)
    dy = 3*u*u*(y1-y0) + 6*u*t*(y2-y1) + 3*t*t*(y3-y2)
    return (x, y), math.atan2(dy, dx)

def f(v): 
    s = f'{v:.3f}'.rstrip('0').rstrip('.')
    return s if s not in ('-0', '') else '0'

class Sprig:
    def __init__(self, pal):
        self.p = PALETTES[pal]
        self.stems, self.leafA, self.leafB, self.veins = [], [], [], []
        self.twigs, self.berry1, self.berry2, self.hi = [], [], [], []
        self.leafA2, self.leafB2 = [], []
        self.nleaf = 0

    def stem(self, P, w0, w1, n=48):
        L, R = [], []
        for i in range(n+1):
            t = i/n
            (x, y), a = bez(P, t)
            w = (w0 + (w1-w0)*t)/2
            nx, ny = -math.sin(a), math.cos(a)
            L.append((x+nx*w, y+ny*w)); R.append((x-nx*w, y-ny*w))
        pts = L + R[::-1]
        d = 'M' + ' L'.join(f'{f(x)} {f(y)}' for x, y in pts) + 'Z'
        self.stems.append(d)

    def leaf(self, P, t, side, length, width, angle=42, bend=0.10, petiole=0.5, vein=True):
        (x, y), a = bez(P, t)
        th = a + math.radians(angle)*side
        # petiole: short line from stem to leaf base
        bx, by = x + math.cos(th)*petiole, y + math.sin(th)*petiole
        if petiole > 0:
            self.twigs.append((f'M{f(x)} {f(y)} L{f(bx)} {f(by)}', 0.16))
        self._leaf_at(bx, by, th, length, width, bend*side, vein)

    def _leaf_at(self, bx, by, th, Lg, W, bend, vein):
        c, s = math.cos(th), math.sin(th)
        def T(px, py):
            py = py + bend*Lg*(px/Lg)**2
            return (bx + c*px - s*py, by + s*px + c*py)
        up = [(0,0), (0.20*Lg, 0.60*W), (0.62*Lg, 0.56*W), (Lg, 0)]
        lo = [(Lg,0), (0.62*Lg, -0.50*W), (0.20*Lg, -0.54*W), (0,0)]
        mid = [(0,0), (0.33*Lg, 0), (0.66*Lg, 0), (Lg, 0)]
        U = [T(*p) for p in up]; Lw = [T(*p) for p in lo]; M = [T(*p) for p in mid]
        def cub(Q): return f'C{f(Q[1][0])} {f(Q[1][1])} {f(Q[2][0])} {f(Q[2][1])} {f(Q[3][0])} {f(Q[3][1])}'
        # half A: upper edge then back along the midline
        dA = f'M{f(U[0][0])} {f(U[0][1])}' + cub(U) + cub(M[::-1]) + 'Z'
        dB = f'M{f(Lw[0][0])} {f(Lw[0][1])}' + cub(Lw) + cub(M) + 'Z'
        # alternate two tone sets so the sprig reads like a soft watercolour
        self.nleaf += 1
        if self.nleaf % 3 == 0:
            self.leafA2.append(dA); self.leafB2.append(dB)
        else:
            self.leafA.append(dA); self.leafB.append(dB)
        if vein:
            v0 = T(0.06*Lg, 0); v1 = T(0.40*Lg, 0); v2 = T(0.70*Lg, 0); v3 = T(0.86*Lg, 0)
            self.veins.append(f'M{f(v0[0])} {f(v0[1])}C{f(v1[0])} {f(v1[1])} {f(v2[0])} {f(v2[1])} {f(v3[0])} {f(v3[1])}')

    def cluster(self, P, t, side, twig_len, angle, berries, r=1.0, spread=1.0, seed=0):
        rnd = random.Random(seed)
        (x, y), a = bez(P, t)
        th = a + math.radians(angle)*side
        ex, ey = x + math.cos(th)*twig_len, y + math.sin(th)*twig_len
        mx, my = (x+ex)/2 + math.cos(th+math.pi/2)*0.25*side, (y+ey)/2 + math.sin(th+math.pi/2)*0.25*side
        self.twigs.append((f'M{f(x)} {f(y)} Q{f(mx)} {f(my)} {f(ex)} {f(ey)}', 0.2))
        for i, (bang, bdist, br) in enumerate(berries):
            ang = th + math.radians(bang)*side
            cx, cy = ex + math.cos(ang)*bdist*spread, ey + math.sin(ang)*bdist*spread
            rr = r*br
            # stalk from twig end to berry edge
            sx, sy = cx - math.cos(ang)*rr*0.8, cy - math.sin(ang)*rr*0.8
            self.twigs.append((f'M{f(ex)} {f(ey)} L{f(sx)} {f(sy)}', 0.13))
            circ = self._circle(cx, cy, rr)
            (self.berry1 if i % 2 == 0 else self.berry2).append(circ)
            self.hi.append(self._circle(cx - rr*0.34, cy - rr*0.36, rr*0.2))

    def berry(self, x, y, r, k=0):
        (self.berry1 if k % 2 == 0 else self.berry2).append(self._circle(x, y, r))
        self.hi.append(self._circle(x - r*0.34, y - r*0.36, r*0.2))

    @staticmethod
    def _circle(cx, cy, r):
        return f'M{f(cx-r)} {f(cy)}a{f(r)} {f(r)} 0 1 0 {f(2*r)} 0a{f(r)} {f(r)} 0 1 0 {f(-2*r)} 0Z'

    def svg(self, vb, px_per_mm=3.7795):
        x0, y0, w, h = vb
        p = self.p
        out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{f(x0)} {f(y0)} {f(w)} {f(h)}" width="{f(w*px_per_mm)}" height="{f(h*px_per_mm)}" aria-hidden="true">']
        if self.twigs:
            for d, sw in sorted(set(self.twigs), key=lambda z: -z[1]):
                pass
            groups = {}
            for d, sw in self.twigs: groups.setdefault(sw, []).append(d)
            for sw, ds in groups.items():
                out.append(f'<path fill="none" stroke="{p["twig"]}" stroke-width="{f(sw)}" stroke-linecap="round" d="{"".join(ds)}"/>')
        out.append(f'<path fill="{p["stem"]}" d="{"".join(self.stems)}"/>')
        out.append(f'<path fill="{p["leafB"]}" d="{"".join(self.leafB)}"/>')
        out.append(f'<path fill="{p["leafA"]}" d="{"".join(self.leafA)}"/>')
        if self.leafB2: out.append(f'<path fill="{p["leafB2"]}" d="{"".join(self.leafB2)}"/>')
        if self.leafA2: out.append(f'<path fill="{p["leafA2"]}" d="{"".join(self.leafA2)}"/>')
        if self.veins:
            out.append(f'<path fill="none" stroke="{p["vein"]}" stroke-width="0.1" stroke-linecap="round" d="{"".join(self.veins)}"/>')
        if self.berry1: out.append(f'<path fill="{p["berry1"]}" d="{"".join(self.berry1)}"/>')
        if self.berry2: out.append(f'<path fill="{p["berry2"]}" d="{"".join(self.berry2)}"/>')
        if self.hi: out.append(f'<path fill="{p["hi"]}" d="{"".join(self.hi)}"/>')
        out.append('</svg>\n')
        return ''.join(out)
