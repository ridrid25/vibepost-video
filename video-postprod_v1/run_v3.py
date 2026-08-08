#!/usr/bin/env python3
"""run_v3.py — весь конвейер одной командой.

    python run_v3.py video.mp4

Что делает по шагам:
  1. вытаскивает звук в 16 кГц моно;
  2. распознаёт речь через whisper.cpp (-oj), получает пословный тайминг;
  3. subs_v8.py — вжигает титры по фактической речи и считает момент печати;
  4. stamp_v1.py — рисует печать картинкой (один раз, потом берёт готовую);
  5. накладывает печать в окно после слова-триггера;
  6. loop_v2.py — бесшовная петля.

Настройки читаются из .env рядом со скриптом. Путь к whisper.cpp задаётся
переменной WHISPER_BIN, к модели — WHISPER_MODEL_PATH.

Если whisper.cpp не установлен, шаг 2 можно пропустить и передать готовый
JSON: python run_v3.py video.mp4 --wjson words.json
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).parent


def load_env():
    f = HERE / ".env"
    if not f.exists():
        return
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("'\""))


load_env()


def run(cmd, quiet=True):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(r.stderr[-1500:], file=sys.stderr)
        sys.exit(f"упало: {' '.join(map(str, cmd))[:160]}")
    if not quiet and r.stdout:
        print(r.stdout.rstrip())
    return r


def find_whisper():
    env = os.getenv("WHISPER_BIN")
    if env and Path(env).exists():
        return env
    for c in ("whisper-cli", "whisper.cpp/build/bin/whisper-cli",
              "whisper.cpp/build/bin/main", "whisper.cpp/main", "main"):
        p = shutil.which(c) or (HERE / c if (HERE / c).exists() else None)
        if p:
            return str(p)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--wjson", help="готовый JSON от whisper.cpp, пропустить распознавание")
    ap.add_argument("--tail", type=float, default=float(os.getenv("CAP_TAIL", 0.80)))
    ap.add_argument("--no-loop", action="store_true")
    ap.add_argument("--no-stamp", action="store_true")
    a = ap.parse_args()

    src = Path(a.video).resolve()
    if not src.exists():
        sys.exit(f"не найден: {src}")
    tmp = Path(tempfile.mkdtemp())
    out_dir = src.parent

    # --- 1-2. речь -> пословный тайминг
    if a.wjson:
        wjson = Path(a.wjson)
        print(f"[1/5] тайминги из {wjson.name}")
    else:
        print("[1/5] звук 16 кГц моно")
        wav = tmp / "a.wav"
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
             "-vn", "-ac", "1", "-ar", "16000", str(wav)])

        wb = find_whisper()
        if not wb:
            sys.exit("whisper.cpp не найден. Укажи WHISPER_BIN в .env "
                     "или передай готовый JSON через --wjson")
        model = os.getenv("WHISPER_MODEL_PATH", "whisper.cpp/models/ggml-small.bin")
        print("[2/5] распознавание")
        run([wb, "-m", model, "-f", str(wav), "-l", "ru", "-ml", "1",
             "-oj", "-of", str(tmp / "w")])
        wjson = tmp / "w.json"
        if not wjson.exists():
            sys.exit("whisper не создал json")

    # --- 3. титры
    print("[3/5] титры")
    subbed = tmp / "subs.mp4"
    run([sys.executable, str(HERE / "subs_v8.py"), str(src), str(wjson), str(subbed)],
        quiet=False)

    cur = subbed

    # --- 4-5. печать
    stamp_file = subbed.with_suffix(".stamp")
    if not a.no_stamp and stamp_file.exists():
        png = HERE / "stamp.png"
        if not png.exists():
            print("[4/5] рисую печать")
            run([sys.executable, str(HERE / "stamp_v1.py"),
                 os.getenv("CAP_STAMP", "РОССИЯ"), str(png),
                 os.getenv("CAP_STAMP_ANGLE", "-12"),
                 os.getenv("CAP_STAMP_FONT", "")], quiet=False)
        else:
            print("[4/5] печать уже нарисована")

        st, en = stamp_file.read_text(encoding="utf-8").split()
        print(f"[5/5] накладываю печать {st}–{en}с")
        stamped = tmp / "stamped.mp4"
        y = os.getenv("CAP_STAMP_Y", "1300")
        wdt = os.getenv("CAP_STAMP_W", "620")
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
             "-i", str(cur), "-i", str(png),
             "-filter_complex",
             f"[1:v]scale={wdt}:-1[s];[0:v][s]overlay=x=(W-w)/2:y={y}-h/2:"
             f"enable='between(t,{st},{en})'[v]",
             "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-preset", "slow",
             "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", str(stamped)])
        cur = stamped
    else:
        print("[4-5/5] печать пропущена")

    # --- петля
    final = out_dir / f"{src.stem}_ready.mp4"
    if a.no_loop:
        shutil.copy(cur, final)
    else:
        run([sys.executable, str(HERE / "loop_v2.py"), str(cur), str(a.tail),
             "-o", str(final)], quiet=False)

    shutil.rmtree(tmp, ignore_errors=True)
    print("\nГОТОВО:", final)


if __name__ == "__main__":
    main()
