"""Side-by-side comparison of a design artboard and a screenshot, for eyeballing differences.

    python tests/visual/compare.py docs/design/1x/01-today.png scratch/shots/today.png scratch/shots/today-compare.png [--crop x0,y0,x1,y1] [--zoom 2]

Left: design, middle: screenshot, right: 50% overlay. Both are read at 1 image px = 1 CSS px
(the docs/design/1x images are 1440 px wide). --crop takes CSS px; --zoom scales the output.
"""
import sys
from PIL import Image, ImageChops

args = sys.argv[1:]
design_path, shot_path, out_path = args[0], args[1], args[2]
crop = None
zoom = 1.0
if '--crop' in args:
    crop = tuple(int(v) for v in args[args.index('--crop') + 1].split(','))
if '--zoom' in args:
    zoom = float(args[args.index('--zoom') + 1])

design = Image.open(design_path).convert('RGB')
shot = Image.open(shot_path).convert('RGB')
if crop:
    design = design.crop(crop)
    shot = shot.crop(crop)
height = max(design.height, shot.height)
width = max(design.width, shot.width)
pad = lambda im: (lambda canvas: (canvas.paste(im, (0, 0)), canvas)[1])(Image.new('RGB', (width, height), 'white'))
d, s = pad(design), pad(shot)
overlay = Image.blend(d, s, 0.5)
diff = ImageChops.difference(d, s).convert('L')
changed = sum(1 for v in diff.getdata() if v > 40) / (width * height)
out = Image.new('RGB', (width * 3 + 40, height), (255, 0, 255))
out.paste(d, (0, 0))
out.paste(s, (width + 20, 0))
out.paste(overlay, (width * 2 + 40, 0))
if zoom != 1.0:
    out = out.resize((int(out.width * zoom), int(out.height * zoom)), Image.LANCZOS)
out.save(out_path)
print(f'saved {out_path}; {changed:.1%} of pixels differ noticeably')
