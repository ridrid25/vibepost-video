#!/usr/bin/env python3
"""check.py — приёмка ролика по стандарту серии.

    python check.py video.mp4
    python check.py video.mp4 --json     # машинный вывод для агента

Возвращает код 0, если ролик принят, и 1, если нет.
Агент НЕ показывает результат человеку, пока код возврата не 0.

Проверяет только то, что измеримо. Смешно или нет — не проверяет,
это остаётся человеку.
"""
import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

STANDARD = {
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "min_dur": 8.0,
    "max_dur": 14.0,
    "loudness_min": -16.0,
    "loudness_max": -12.0,
    "motion_avg_min": 18.0,      # средняя динамика
    "motion_worst_min": 9.0,     # худшая секунда — главный критерий
    "cuts_max": 4,
    "loop_seam_max": 6.0,        # расхождение первого и последнего кадра
    "captions_min_hits": 3,      # точек из 4, где найдены титры
}


def sh(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r


def probe(path, entries, stream=False):
    cmd = ["ffprobe", "-v", "error"]
    if stream:
        cmd += ["-select_streams", "v:0"]
    cmd += ["-show_entries", entries, "-of", "json", str(path)]
    out = sh(cmd).stdout
    return json.loads(out) if out.strip() else {}


def frames(path, tmp, fps=12, w=240, crop_top=True):
    """crop_top — берём верхние 70% кадра: там нет титров и печати,
    иначе их появление считается монтажной склейкой."""
    d = Path(tmp) / ("f_top" if crop_top else "f_all")
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    vf = f"fps={fps},scale={w}:-1"
    if crop_top:
        vf = f"fps={fps},crop=iw:ih*0.70:0:0,scale={w}:-1"
    sh(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(path),
        "-vf", vf, f"{d}/%04d.png"])
    return sorted(glob.glob(f"{d}/*.png"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--no-loop", action="store_true",
                    help="ролик без петли — не проверять стык")
    ap.add_argument("--no-captions", action="store_true",
                    help="ролик без титров — не проверять их наличие")
    a = ap.parse_args()

    v = Path(a.video)
    if not v.exists():
        sys.exit(f"не найден: {v}")

    try:
        import numpy as np
        from PIL import Image
    except ImportError:
        sys.exit("нужны numpy и pillow")

    tmp = tempfile.mkdtemp()
    res = []          # (пункт, ок?, факт, требование)

    # --- формат
    st = probe(v, "stream=width,height,r_frame_rate", stream=True).get("streams", [{}])[0]
    w, h = st.get("width"), st.get("height")
    num, den = (st.get("r_frame_rate", "0/1").split("/") + ["1"])[:2]
    fps = round(float(num) / float(den)) if float(den) else 0
    res.append(("размер", (w, h) == (STANDARD["width"], STANDARD["height"]),
                f"{w}x{h}", "1080x1920"))
    res.append(("частота кадров", fps == STANDARD["fps"], f"{fps} fps", "30 fps"))

    dur = float(probe(v, "format=duration").get("format", {}).get("duration", 0))
    res.append(("длительность", STANDARD["min_dur"] <= dur <= STANDARD["max_dur"],
                f"{dur:.2f}с", f"{STANDARD['min_dur']}–{STANDARD['max_dur']}с"))

    # --- звук
    ln = sh(["ffmpeg", "-hide_banner", "-i", str(v), "-af",
             "loudnorm=print_format=summary", "-f", "null", "-"]).stderr
    lufs = None
    for line in ln.splitlines():
        if "Input Integrated" in line:
            try:
                lufs = float(line.split(":")[1].strip().split()[0])
            except (ValueError, IndexError):
                pass
    if lufs is None:
        res.append(("громкость", False, "не измерена", "-14 LUFS"))
    else:
        res.append(("громкость",
                    STANDARD["loudness_min"] <= lufs <= STANDARD["loudness_max"],
                    f"{lufs:.1f} LUFS", "-16…-12 LUFS"))

    # --- динамика
    fs = frames(v, tmp)
    if len(fs) < 24:
        res.append(("динамика", False, "мало кадров", "—"))
        sec, cuts = [], []
    else:
        ar = [np.asarray(Image.open(f).convert("L"), float) for f in fs]
        d = [np.abs(ar[i + 1] - ar[i]).mean() for i in range(len(ar) - 1)]
        sec = [float(np.mean(d[s * 12:(s + 1) * 12])) for s in range(len(d) // 12)]
        # склейка = резкий выброс относительно фона, а не просто быстрое движение
        med = float(np.median(d))
        thr = max(45.0, med * 2.8)
        cuts = [round(i / 12, 1) for i, x in enumerate(d) if x > thr]
        avg = float(np.mean(d))
        worst = min(sec) if sec else 0
        wi = sec.index(worst) if sec else 0
        res.append(("динамика средняя", avg >= STANDARD["motion_avg_min"],
                    f"{avg:.2f}", f"≥{STANDARD['motion_avg_min']}"))
        res.append((f"худшая секунда ({wi}-{wi+1}с)", worst >= STANDARD["motion_worst_min"],
                    f"{worst:.2f}", f"≥{STANDARD['motion_worst_min']}"))
        res.append(("склеек", len(cuts) <= STANDARD["cuts_max"],
                    f"{len(cuts)} {cuts}", f"≤{STANDARD['cuts_max']}"))

    def grab(path, args, out):
        sh(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"] + args +
           ["-i", str(path), "-frames:v", "1", "-update", "1", out])
        return Path(out).exists()

    # --- петля
    if not a.no_loop:
        f0, fl = f"{tmp}/a.png", f"{tmp}/b.png"
        ok0 = grab(v, [], f0)
        okl = grab(v, ["-sseof", "-0.15"], fl) or grab(v, ["-ss", f"{dur-0.2:.2f}"], fl)
        if ok0 and okl:
            x, y = [np.asarray(Image.open(p).convert("L"), float) for p in (f0, fl)]
            seam = float(np.abs(x - y).mean())
            res.append(("стык петли", seam <= STANDARD["loop_seam_max"],
                        f"{seam:.2f}", f"≤{STANDARD['loop_seam_max']}"))
        else:
            res.append(("стык петли", False, "кадры не извлеклись", "—"))

    # --- титры
    if not a.no_captions:
        hits = 0
        zone = slice(1920 - 420 - 300, 1920 - 420 + 180)
        for frac in (0.2, 0.4, 0.6, 0.85):
            p = f"{tmp}/c.png"
            if not grab(v, ["-ss", f"{dur*frac:.2f}"], p):
                continue
            im = np.asarray(Image.open(p).convert("RGB").resize((1080, 1920)), float)
            z = im[zone]
            # титры белые/жёлтые с чёрной обводкой — ищем яркие пиксели в зоне
            bright = ((z[:, :, 0] > 200) & (z[:, :, 1] > 190)).sum()
            hits += bright > 1500
        res.append(("титры видны", hits >= STANDARD["captions_min_hits"],
                    f"{hits} из 4 точек", f"≥{STANDARD['captions_min_hits']}"))

    shutil.rmtree(tmp, ignore_errors=True)

    passed = all(ok for _, ok, _, _ in res)

    if a.json:
        print(json.dumps({
            "passed": passed,
            "checks": [{"name": n, "ok": ok, "actual": f, "required": r}
                       for n, ok, f, r in res],
            "worst_second": (sec.index(min(sec)) if sec else None),
        }, ensure_ascii=False, indent=1))
    else:
        print(f"\n=== ПРИЁМКА: {v.name} ===")
        for n, ok, f, r in res:
            print(f"  {'OK  ' if ok else 'НЕТ '} {n:26} {f:20} нужно {r}")
        print()
        if passed:
            print("ПРИНЯТ — можно показывать человеку")
        else:
            print("НЕ ПРИНЯТ — исправить и прогнать снова")
            if sec and min(sec) < STANDARD["motion_worst_min"]:
                wi = sec.index(min(sec))
                print(f"  провал в сегменте {wi}.0-{wi+1}.0 — переписать ТОЛЬКО его")

    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
