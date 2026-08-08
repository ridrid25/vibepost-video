#!/usr/bin/env python3
"""loop_v2.py — бесшовная петля БЕЗ потери концовки.

Ролик проигрывается целиком, затем дорисовывается короткий хвост:
последний кадр держится, потом растворяется в первый кадр ролика.
Последние кадры результата = первый кадр, поэтому при повторе стык не виден.

    python loop_v2.py video.mp4 [длина_хвоста] [-o выход.mp4]

Длина хвоста по умолчанию 0.80 с — проверенное значение: таблички и мелкий
текст в финале успевают прочитаться, но не надоедают.

ВАЖНО: звук не перекодируется по содержанию, только дополняется тишиной на
длину хвоста. Реплики не трогаются.
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"ffmpeg упал:\n{r.stderr[-1200:]}")
    return r


def probe(path, entries, stream=False):
    cmd = ["ffprobe", "-v", "error"]
    if stream:
        cmd += ["-select_streams", "v:0"]
    cmd += ["-show_entries", entries, "-of", "json", str(path)]
    return json.loads(run(cmd).stdout)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("tail", nargs="?", type=float, default=0.80,
                    help="длина хвоста в секундах (по умолчанию 0.80)")
    ap.add_argument("-o", "--out")
    a = ap.parse_args()

    src = Path(a.video)
    if not src.exists():
        sys.exit(f"не найден: {src}")
    out = Path(a.out) if a.out else src.with_name(src.stem + "_loop.mp4")

    dur = float(probe(src, "format=duration")["format"]["duration"])
    st = probe(src, "stream=width,height,r_frame_rate", stream=True)["streams"][0]
    w, h = st["width"], st["height"]
    num, den = (st["r_frame_rate"].split("/") + ["1"])[:2]
    fps = round(float(num) / float(den))

    # запас в конце обязателен: растворение должно ЗАВЕРШИТЬСЯ до конца хвоста,
    # иначе последние кадры — ещё смесь, а не чистый первый кадр, и петля не сойдётся
    reserve = 0.18
    rest = max(0.2, a.tail - reserve)
    diss = round(rest * 0.5, 2)
    hold = round(rest - diss, 2)
    print(f"{src.name}: {w}x{h}, {fps} fps, {dur:.2f}с")
    print(f"хвост {a.tail}с — пауза {hold}, растворение {diss}, запас {reserve}")

    tmp = Path(tempfile.mkdtemp())
    first, last = tmp / "first.png", tmp / "last.png"

    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
         "-frames:v", "1", "-update", "1", str(first)])
    # последний кадр: -sseof надёжнее, но иногда промахивается — есть запасной путь
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-sseof", "-0.15", "-i", str(src),
         "-frames:v", "1", "-update", "1", str(last)])
    if not last.exists():
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
             "-ss", f"{max(0, dur - 0.20):.3f}", "-i", str(src),
             "-frames:v", "1", "-update", "1", str(last)])
    if not last.exists():
        sys.exit("не удалось извлечь последний кадр")

    fc = (
        f"[1:v]scale={w}:{h},fps={fps},format=yuva420p[hold];"
        f"[2:v]scale={w}:{h},fps={fps},format=yuva420p,"
        f"fade=t=in:st={hold}:d={diss}:alpha=1[to0];"
        f"[hold][to0]overlay=format=auto[tail];"
        f"[0:v]fps={fps},format=yuva420p[main];"
        f"[main][tail]concat=n=2:v=1:a=0[v];"
        f"[0:a]apad=pad_dur={a.tail}[a]"
    )
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-i", str(src),
         "-loop", "1", "-t", str(a.tail), "-i", str(last),
         "-loop", "1", "-t", str(a.tail), "-i", str(first),
         "-filter_complex", fc, "-map", "[v]", "-map", "[a]",
         "-t", f"{dur + a.tail:.3f}",
         "-c:v", "libx264", "-preset", "slow", "-crf", "18",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
         "-movflags", "+faststart", str(out)])

    # проверка: последний кадр результата должен совпасть с первым
    try:
        import numpy as np
        from PIL import Image
        chk = tmp / "chk.png"
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
             "-sseof", "-0.15", "-i", str(out), "-frames:v", "1",
             "-update", "1", str(chk)])
        if not chk.exists():
            run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                 "-ss", f"{dur + a.tail - 0.20:.3f}", "-i", str(out),
                 "-frames:v", "1", "-update", "1", str(chk)])
        arr = [np.asarray(Image.open(p).convert("L"), float) for p in (first, chk)]
        d = float(abs(arr[0] - arr[1]).mean())
        print(f"стык петли: {d:.2f}  " +
              ("петля сошлась" if d < 6 else "стык виден — увеличь хвост"))
    except ImportError:
        print("(проверка пропущена: нет numpy/pillow)")

    print("Готово:", out)


if __name__ == "__main__":
    main()
