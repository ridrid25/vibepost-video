#!/usr/bin/env python3
"""Замер динамики ролика: среднее, худшая секунда, склейки."""
import glob, os, shutil, subprocess, sys
import numpy as np
from PIL import Image

v = sys.argv[1]
tmp = "_m"
shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", v,
                "-vf", "fps=12,scale=240:-1", f"{tmp}/%03d.png"], check=True)
fr = [np.asarray(Image.open(f).convert("L"), float) for f in sorted(glob.glob(f"{tmp}/*.png"))]
d = [np.abs(fr[i+1] - fr[i]).mean() for i in range(len(fr) - 1)]
sec = [float(np.mean(d[s*12:(s+1)*12])) for s in range(len(d)//12)]
cuts = [round(i/12, 1) for i, x in enumerate(d) if x > 45]

for i, m in enumerate(sec):
    print(f"{i}-{i+1}с  {m:5.1f}  {'#' * int(m*2)}")
print(f"\nсреднее      {np.mean(d):5.2f}   (ориентир 20+)")
print(f"худшая сек   {min(sec):5.2f}   (цель: не ниже 10)")
print(f"склеек       {len(cuts):5d}   {cuts}")
worst = sec.index(min(sec))
print(f"\nпереписывать сегмент {worst}.0-{worst+1}.0 — там провал")
shutil.rmtree(tmp, ignore_errors=True)
