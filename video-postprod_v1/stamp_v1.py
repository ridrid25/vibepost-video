#!/usr/bin/env python3
"""stamp_v1.py — рисует прямоугольный оттиск печати в PNG с прозрачным фоном.
    python stamp_v1.py "РОССИЯ" stamp.png [угол] [шрифт.ttf]
Потёртость делается вычитанием шумовой маски из альфа-канала, как у настоящего
оттиска, где чернила ложатся неровно.
"""
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

TEXT = sys.argv[1] if len(sys.argv) > 1 else "РОССИЯ"
OUT = sys.argv[2] if len(sys.argv) > 2 else "stamp.png"
ANGLE = float(sys.argv[3]) if len(sys.argv) > 3 else -12
FONT = sys.argv[4] if len(sys.argv) > 4 else "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
COLOR = (60, 62, 170)          # сине-фиолетовый, как у штемпельной краски
S = 4                          # рисуем крупнее и уменьшаем — края чище

W, H = 900 * S, 300 * S
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

pad, bw = 40 * S, 11 * S
# двойная рамка
d.rectangle([pad, pad, W - pad, H - pad], outline=COLOR + (255,), width=bw)
d.rectangle([pad + bw * 2, pad + bw * 2, W - pad - bw * 2, H - pad - bw * 2],
            outline=COLOR + (255,), width=bw // 2)

size = 118 * S
while size > 20:
    try:
        f = ImageFont.truetype(FONT, size)
    except OSError:
        f = ImageFont.load_default()
        break
    box = d.textbbox((0, 0), TEXT, font=f)
    if box[2] - box[0] < W - pad * 2 - bw * 6:
        break
    size -= 4 * S
box = d.textbbox((0, 0), TEXT, font=f)
d.text(((W - (box[2] - box[0])) / 2 - box[0], (H - (box[3] - box[1])) / 2 - box[1]),
       TEXT, font=f, fill=COLOR + (255,))

# ---- потёртость: шумовая маска выгрызает часть краски
random.seed(7)
noise = Image.new("L", (W // (S * 2), H // (S * 2)))
noise.putdata([random.randint(0, 255) for _ in range(noise.width * noise.height)])
noise = noise.resize((W, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(3 * S))
noise = noise.point(lambda v: 255 if v > 118 else int(v * 1.4))

a = img.getchannel("A")
a = Image.composite(a, Image.new("L", (W, H), 0), noise.point(lambda v: 255 if v > 96 else 0))

# рваный край: редкие крупные выкусы
scratch = Image.new("L", (W, H), 255)
sd = ImageDraw.Draw(scratch)
for _ in range(26):
    x, y = random.randint(0, W), random.randint(0, H)
    r = random.randint(6 * S, 20 * S)
    sd.ellipse([x - r, y - r, x + r, y + r], fill=0)
scratch = scratch.filter(ImageFilter.GaussianBlur(2 * S))
a = Image.composite(a, Image.new("L", (W, H), 0), scratch.point(lambda v: 255 if v > 140 else 0))

img.putalpha(a.point(lambda v: int(v * 0.88)))
img = img.rotate(ANGLE, resample=Image.BICUBIC, expand=True)
img = img.resize((img.width // S, img.height // S), Image.LANCZOS)
img.save(OUT)
print(f"{OUT}: {img.width}x{img.height}, угол {ANGLE}")
