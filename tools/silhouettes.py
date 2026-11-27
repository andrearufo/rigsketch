# Builds js/silhouettes.js from the public-domain guitar drawings in assets/art/.
# Run from the repo root after adding or changing a drawing: python3 tools/silhouettes.py
# Needs Pillow, potrace and Google Chrome (set CHROME= to its binary if not on macOS).
#
# Each drawing is rendered all black (line art is filled from the outside in), turned
# upright, traced with potrace into a smooth outline and scaled to the instrument's real
# length, so a bass is longer than a guitar. Output is in item pixels, ready to draw.
import json, math, os, re, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFilter, ImageOps

K = .45  # px per mm, as for every other asset
CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
# key: file, real length in mm, then optional: degrees to rotate (counter-clockwise),
# mirror, crop box (for the patent sheet), credit
SOURCES = {
    'st': ('st.svg', 990, 0, False, None, 'GDJ, Openclipart 242168'),
    't': ('t.svg', 970, 90, False, None, 'GDJ, Openclipart 256955'),
    'sc': ('sc.svg', 995, 0, False, None, 'GDJ, Openclipart 242167'),
    'sg': ('sg.svg', 990, 0, False, None, 'piemaster, Openclipart 16718'),
    'superstrat': ('superstrat.svg', 990, 0, False, None, 'J_Alves, Openclipart 171159'),
    'explorer': ('explorer.svg', 1010, 0, False, None, 'piemaster, Openclipart 16717'),
    'v': ('v.svg', 1000, 0, False, None, 'piemaster, Openclipart 16882'),
    'offset': ('offset.svg', 975, 0, False, None, 'piemaster, Wikimedia Commons (Fender Jagstang.svg)'),
    'jet': ('jet.svg', 1000, 0, False, None, 'piemaster, Openclipart 16714'),
    'jbass': ('jbass.svg', 1170, 0, False, None, 'piemaster, Wikimedia Commons (Fender Jazz Bass.svg)'),
    'pbass': ('pbass.png', 1160, 0, True, (395, 172, 615, 915), 'US design patent D169062, fig. 3, Wikimedia Commons'),
    'acoustic': ('acoustic.svg', 1030, 0, False, None, 'J_Alves, Openclipart 171161'),
}


def render(svg, out, width=1600):
    s = open(svg).read()
    s = s[s.index('<svg'):]
    root = re.match(r'<svg\b[^>]*>', s).group(0)
    vb = re.search(r'viewBox="([^"]+)"', root)
    vw, vh = ([float(v) for v in vb.group(1).replace(',', ' ').split()][2:] if vb else
              [float(re.search(rf'\b{k}="([\d.]+)', root).group(1)) for k in ('width', 'height')])
    height = round(width * vh / vw)
    new = re.sub(r'\s(width|height)="[^"]*"', '', root).replace('<svg', f'<svg width="{width}" height="{height}"' + ('' if vb else f' viewBox="0 0 {vw} {vh}"'), 1)
    html = out + '.html'
    open(html, 'w').write('<style>html,body{margin:0;background:#fff}svg *{fill:#000!important;stroke:#000!important}</style>' + s.replace(root, new, 1))
    subprocess.run([CHROME, '--headless', '--disable-gpu', '--hide-scrollbars', f'--screenshot={out}', f'--window-size={width},{height}', 'file://' + html],
                   check=True, capture_output=True)
    return Image.open(out)


def silhouette(im, close=3):
    """Dark pixels and everything they enclose: flood the outside, keep the rest."""
    ink = im.convert('L').point(lambda v: 255 if v < 140 else 0).filter(ImageFilter.MaxFilter(2 * close + 1))
    pad = ImageOps.expand(ink, 4, 0)
    ImageDraw.floodfill(pad, (0, 0), 128)
    body = pad.point(lambda v: 0 if v == 128 else 255).filter(ImageFilter.MinFilter(2 * close + 1))
    return body.crop((4, 4, body.width - 4, body.height - 4))


def potrace(body, tmp):
    pbm, svg = os.path.join(tmp, 'b.pbm'), os.path.join(tmp, 'b.svg')
    ImageOps.invert(body).convert('1').save(pbm)
    subprocess.run(['potrace', '-s', '-t', '30', '-a', '1.1', '-O', '0.5', '-o', svg, pbm], check=True)
    s = open(svg).read()
    H = float(re.search(r'translate\(0\.0+,([\d.]+)\)', s).group(1))
    subs = []
    for d in re.findall(r' d="([^"]+)"', s):
        t = re.findall(r'[MmLlCcZz]|-?\d+(?:\.\d+)?', d)
        i, x, y, cmd, cur = 0, 0., 0., None, None
        while i < len(t):
            if t[i].isalpha():
                cmd = t[i]; i += 1
            if cmd in 'zZ':
                subs.append(cur); continue
            n = 6 if cmd in 'cC' else 2
            v = [float(a) for a in t[i:i + n]]; i += n
            rel = cmd.islower()
            pts = [(v[j] + (x if rel else 0), v[j + 1] + (y if rel else 0)) for j in range(0, n, 2)]
            x, y = pts[-1]
            if cmd in 'mM':
                cur = [pts[0]]; cmd = 'l' if rel else 'L'
            else:
                cur.append(pts)
    # potrace draws y up in tenths of a pixel
    return [[(sp[0][0] / 10, H - sp[0][1] / 10)] + [[(a / 10, H - b / 10) for a, b in seg] for seg in sp[1:]] for sp in subs]


out, credits = {}, {}
with tempfile.TemporaryDirectory() as tmp:
    for key, (src, length, rot, mirror, box, credit) in SOURCES.items():
        path = os.path.join('assets/art', src)
        im = render(path, os.path.join(tmp, key + '.png')) if src.endswith('.svg') else Image.open(path)
        if box:
            im = im.convert('L').crop(box).resize(((box[2] - box[0]) * 8, (box[3] - box[1]) * 8), Image.LANCZOS)
        body = silhouette(im, 2 if box else 3)
        if box:
            body = body.filter(ImageFilter.GaussianBlur(12)).point(lambda v: 255 if v >= 128 else 0)
        if rot:
            body = body.rotate(rot, expand=True, fillcolor=0)
        if mirror:
            body = ImageOps.mirror(body)
        # the largest outline is the instrument; labels and specks are dropped
        bbox = lambda sp: (lambda xs, ys: (min(xs), min(ys), max(xs), max(ys)))(*zip(*[sp[0]] + [q for seg in sp[1:] for q in seg]))
        sp = max(potrace(body, tmp), key=lambda sp: (lambda b: (b[2] - b[0]) * (b[3] - b[1]))(bbox(sp)))
        x0, y0, x1, y1 = bbox(sp)
        s = length * K / (y1 - y0)
        w, h = math.ceil(((x1 - x0) * s + 8) / 20) * 20, math.ceil((length * K + 8) / 20) * 20
        tx, ty = (w - (x1 - x0) * s) / 2 - x0 * s, (h - length * K) / 2 - y0 * s
        P = lambda p: f'{round(p[0] * s + tx, 1):g} {round(p[1] * s + ty, 1):g}'
        d = 'M' + P(sp[0]) + ''.join(('C' if len(seg) == 3 else 'L') + ' '.join(map(P, seg)) for seg in sp[1:]) + 'Z'
        # output jack: on the right edge of the body, on a grid line about 5/6 down
        px = body.load()
        for y in sorted(range(20, h, 20), key=lambda y: abs(y - h * .84)):
            row = round((y - ty) / s)
            xs = [x for x in range(int(x0), min(body.width, int(x1) + 1)) if 0 <= row < body.height and px[x, row]]
            if xs:
                jack = {'x': round(max(xs) * s + tx), 'y': y}
                break
        out[key] = {'w': w, 'h': h, 'd': d, 'jack': jack}
        credits[key] = credit
        print(f'{key:11} {w}x{h}  {len(d)}B  jack {jack}')

open('js/silhouettes.js', 'w').write(
    '// Generated by tools/silhouettes.py from the public-domain drawings in assets/art/.\n'
    '// Sources (all CC0 or public domain): ' + '; '.join(f'{k}: {c}' for k, c in credits.items()) + '.\n'
    'export const SILHOUETTES = ' + json.dumps(out, indent=1) + ';\n')
