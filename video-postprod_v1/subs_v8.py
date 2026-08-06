#!/usr/bin/env python3
"""subs.py — титры по фактической речи. Ест любой вывод whisper.cpp."""
import json, os, re, subprocess, sys, tempfile
from pathlib import Path

F = dict(font=os.getenv("CAP_FONT", "Noto Sans"), size=int(os.getenv("CAP_SIZE", 68)),
         mv=int(os.getenv("CAP_MARGIN_V", 420)), chars=int(os.getenv("CAP_MAX_CHARS", 26)),
         dur=float(os.getenv("CAP_MAX_DUR", 2.2)), gap=float(os.getenv("CAP_MAX_GAP", 0.45)),
         fdir=os.getenv("CAP_FONTSDIR", ""))

# Заголовок в кадре. Раньше делался разово через drawtext и в конвейер не
# входил — ролики выходили без него. Теперь живёт рядом с титрами: одно место,
# один шрифт, одна проверка отрисовки.
HOOK = os.getenv("CAP_HOOK", "").strip()
HOOK_DUR = float(os.getenv("CAP_HOOK_DUR", "3.0"))
HOOK_SIZE = int(os.getenv("CAP_HOOK_SIZE", "76"))
HOOK_MV = int(os.getenv("CAP_HOOK_MV", "260"))    # отступ сверху, ниже зоны интерфейса
HOOK_CHARS = int(os.getenv("CAP_HOOK_CHARS", "18"))


def wrap_hook(text, chars):
    """Перенос по словам: в ASS автоперенос выключен (WrapStyle 2)."""
    строки, тек = [], ""
    for слово in text.split():
        проба = (тек + " " + слово).strip()
        if len(проба) > chars and тек:
            строки.append(тек)
            тек = слово
        else:
            тек = проба
    if тек:
        строки.append(тек)
    return "\\N".join(строки)


def run(c):
    r = subprocess.run(c, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"ffmpeg: {r.stderr[-800:]}")
    return r


def load_words(p):
    """whisper.cpp -oj: токены с ведущим пробелом. Склеиваем в слова."""
    d = json.loads(Path(p).read_text(encoding="utf-8"))
    items = d.get("transcription") or d.get("segments") or []
    out = []
    for it in items:
        raw = it.get("text", "")
        if not raw.strip():
            continue
        o = it.get("offsets") or {}
        a = float(o.get("from", it.get("start", 0) * 1000)) / 1000
        b = float(o.get("to", it.get("end", 0) * 1000)) / 1000
        t = raw.strip()
        if raw[:1].isspace() or not out:
            out.append([t, a, b])
        else:
            out[-1][0] += t
            out[-1][2] = b
    if not out:
        sys.exit("whisper ничего не вернул")
    # страховка: если пробелов не было и всё слиплось в одно слово — режем по джсону как есть
    if len(out) == 1 and len(items) > 3:
        out = [[it["text"].strip(), it["offsets"]["from"] / 1000, it["offsets"]["to"] / 1000]
               for it in items if it.get("text", "").strip()]
    return out


# Правки распознанных слов. Модель Veo глотает конечную гласную в «отказа»,
# и титр повторял ошибку звука. Звук чиним отдельно, титр — здесь.
FIX = {"бомбук": "бамбук", "бамбуг": "бамбук", "Бомбук": "Бамбук",
       "отказ": "отказа", "Отказ": "Отказа"}


def group(ws):
    cues, cur = [], []
    for w in ws:
        if cur:
            line = " ".join(x[0] for x in cur)
            if (len(line) + 1 + len(w[0]) > F["chars"] or w[2] - cur[0][1] > F["dur"]
                    or w[1] - cur[-1][2] > F["gap"] or cur[-1][0][-1:] in ".!?…"):
                cues.append(cur); cur = []
        cur.append(w)
    if cur:
        cues.append(cur)
    return cues


def ts(t):
    return f"{int(t//3600)}:{int(t%3600//60):02d}:{t%60:05.2f}"


STAMP = os.getenv("CAP_STAMP", "РОССИЯ")
TRIG = os.getenv("CAP_STAMP_WORD", "живу")
ANG = os.getenv("CAP_STAMP_ANGLE", "30")


def stamp_time(ws):
    """Момент печати = конец слова-триггера. Пишем в файл рядом с выходом,
    чтобы наложение картинки шло по тем же данным, что и титры."""
    for (t, a_, b_) in ws:
        if TRIG in t.lower().strip(".,!?"):
            return b_ + 0.06
    return None


def stamp_lines(cues):
    return []


def build_ass(cues, w=1080, h=1920):
    head = (f"[Script Info]\nScriptType: v4.00+\nPlayResX: {w}\nPlayResY: {h}\nWrapStyle: 2\n"
            "ScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,"
            "SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,"
            "Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n"
            f"Style: P,{F['font']},{F['size']},&H0000E5FF,&H00FFFFFF,&H00000000,&H90000000,-1,0,0,0,"
            f"100,100,1,0,1,6,3,2,90,90,{F['mv']},204\n"
            # H — заголовок: выравнивание 8 (верх по центру). Фон ПРОЗРАЧНЫЙ:
            # BorderStyle 1 — обводка с тенью, как у нижних титров. Раньше
            # стояла плашка (BorderStyle 3), и чёрный прямоугольник закрывал
            # верх кадра. Читаемость держат толстая обводка и тень.
            f"Style: H,{F['font']},{HOOK_SIZE},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,"
            f"100,100,2,0,1,6,3,8,60,60,{HOOK_MV},204\n\n[Events]\nFormat: Layer,Start,End,Style,Name,"
            "MarginL,MarginR,MarginV,Effect,Text\n")
    lines = []
    if HOOK:
        # Как в панде — первом ролике серии: заголовок сверху первые три
        # секунды, субтитры снизу по речи. Обе надписи вместе, это норма.
        lines.append(f"Dialogue: 0,{ts(0)},{ts(HOOK_DUR)},H,,0,0,0,,"
                     + r"{\fad(0,200)}" + wrap_hook(HOOK.upper(), HOOK_CHARS))
    for c in cues:
        parts = []
        for i, (t, a, b) in enumerate(c):
            if i:
                g = round((a - c[i - 1][2]) * 100)
                if g > 3:
                    parts.append(rf"{{\k{g}}} ")
            parts.append(rf"{{\k{max(1, round((b - a) * 100))}}}{t}" + (" " if i < len(c) - 1 else ""))
        lines.append(f"Dialogue: 0,{ts(c[0][1])},{ts(c[-1][2] + 0.15)},P,,0,0,0,,"
                     + r"{\fad(120,120)}" + "".join(parts))
    return head + "\n".join(lines + stamp_lines(cues)) + "\n"


def main():
    if len(sys.argv) < 4:
        sys.exit("subs.py <видео> <words.json> <выход.mp4> [озвучка]")
    video, wj, out = sys.argv[1:4]
    vo = sys.argv[4] if len(sys.argv) > 4 else None

    ws = load_words(wj)
    for w in ws:
        if w[0].strip(".,!?") in FIX:
            w[0] = FIX[w[0].strip(".,!?")] + w[0][len(w[0].strip(".,!?")):]
    print("РАСПОЗНАНО:", " ".join(w[0] for w in ws)[:300])
    cues = group(ws)
    print(f"слов: {len(ws)}   титров: {len(cues)}")
    print(f"заголовок: «{HOOK}», первые {HOOK_DUR:g} с" if HOOK else "заголовок: не задан")

    stt = stamp_time(ws) if os.getenv("CAP_STAMP_ON") else None
    if stt:
        dur = float(os.getenv("CAP_STAMP_DUR", "1.0"))
        Path(out).with_suffix(".stamp").write_text(f"{stt:.2f} {stt+dur:.2f}", encoding="utf-8")
        print(f"печать: {stt:.2f}–{stt+dur:.2f}с (после слова «{TRIG}»)")
    ap = Path(out).with_suffix(".ass")
    ap.write_text(build_ass(cues), encoding="utf-8")

    # Путь внутрь фильтра ffmpeg: двоеточие диска — разделитель настроек,
    # обратный слэш — экранирование. Без подмены абсолютный путь разваливается
    # («Unable to parse original_size»), и титры молча не рисуются.
    def для_фильтра(p):
        return str(p).replace("\\", "/").replace(":", "\\:")

    af = f"ass='{для_фильтра(ap)}'" + (
        f":fontsdir='{для_фильтра(F['fdir'])}'" if F["fdir"] else "")
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", video]
    if vo:
        cmd += ["-i", vo]
    cmd += ["-vf", f"scale=1080:1920:flags=lanczos,fps=30,{af}",
            "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
            "-af", "loudnorm=I=-14:TP=-1:LRA=11", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"]
    if vo:
        cmd += ["-map", "0:v:0", "-map", "1:a:0", "-shortest"]
    cmd += ["-movflags", "+faststart", out]
    run(cmd)

    tmp = Path(tempfile.mkdtemp())
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", video, "-vf",
         "scale=1080:1920,fps=30", "-frames:v", "1", "-update", "1", str(tmp / "a.png")])
    ok = True
    try:
        import numpy as np
        from PIL import Image
        d = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                  "-of", "csv=p=0", out], capture_output=True, text=True).stdout)
        hit = 0
        for f in (0.2, 0.4, 0.6, 0.85):
            for src, n in ((video, "p"), (out, "s")):
                run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{d*f:.2f}",
                     "-i", src, "-vf", "scale=1080:1920", "-frames:v", "1", "-update", "1",
                     str(tmp / f"{n}.png")])
            a, b = [np.asarray(Image.open(tmp / x).convert("L"), float) for x in ("p.png", "s.png")]
            m = abs(a - b)[1920 - F["mv"] - 260:1920 - F["mv"] + 160].max()
            hit += m > 90
        ok = hit >= 2
        print(f"проверка титров: {hit} из 4 точек")
    except ImportError:
        pass
    ap.unlink(missing_ok=True)
    print("Готово:", out if ok else "ТИТРЫ НЕ ОТРИСОВАЛИСЬ — проверь CAP_FONTSDIR")


main()
