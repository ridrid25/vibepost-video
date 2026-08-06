#!/usr/bin/env python3
"""Распознаёт речь в ролике и пишет тайминги в формате whisper.cpp -oj.

Зачем отдельный файл: whisper.cpp на Windows надо собирать из исходников,
а faster-whisper ставится одной строкой. Формат JSON у него другой, поэтому
здесь он приводится к тому, что ждёт subs_v8.py:

    {"transcription": [{"text": " слово", "offsets": {"from": мс, "to": мс}}]}

Ведущий пробел в text обязателен — по нему subs_v8.py отличает начало нового
слова. Без него слова склеятся.

    python raspoznat.py видео.mp4 [words.json]
"""
import json
import sys
from pathlib import Path

from faster_whisper import WhisperModel

МОДЕЛЬ = "small"          # для русского хватает; large точнее, но втрое дольше


def распознать(видео: Path, куда: Path) -> None:
    model = WhisperModel(МОДЕЛЬ, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        str(видео),
        language="ru",
        word_timestamps=True,
        vad_filter=True,          # отсекает тишину и уличный шум
    )

    слова = []
    for seg in segments:
        for w in (seg.words or []):
            текст = w.word
            if not текст.strip():
                continue
            # faster-whisper уже даёт ведущий пробел у всех слов, кроме первого.
            слова.append({
                "text": текст,
                "offsets": {
                    "from": int(round(w.start * 1000)),
                    "to": int(round(w.end * 1000)),
                },
            })

    if not слова:
        raise SystemExit("Речь не распознана — проверь, есть ли в ролике звук")

    куда.write_text(
        json.dumps({"transcription": слова}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    сплошняк = "".join(w["text"] for w in слова).strip()
    print(f"слов: {len(слова)}   длительность речи: {слова[-1]['offsets']['to'] / 1000:.1f} с")
    print(f"текст: {сплошняк}")
    print(f"записано: {куда}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("Укажи видео: python raspoznat.py видео.mp4 [words.json]")
    видео = Path(sys.argv[1])
    куда = Path(sys.argv[2]) if len(sys.argv) > 2 else видео.with_suffix(".words.json")
    распознать(видео, куда)
