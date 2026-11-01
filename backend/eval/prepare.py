"""Build the eval set: ACI-Bench doctor-patient visits turned into audio.

ACI-Bench (Yim et al., 2023, CC BY 4.0) ships visit dialogues and clinician-written
reference notes, but no audio. Each dialogue is voiced locally with macOS `say`
(Indian English voice for the doctor, US English for the patient) and joined with
ffmpeg into one mono 16 kHz AAC file, the same kind of file the app uploads.

Usage (from backend/):  uv run python -m eval.prepare --n 20
Output: eval/.cache/cases.jsonl plus one .m4a per case.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import tempfile
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ACI_URL = (
    "https://raw.githubusercontent.com/wyim/aci-bench/main/"
    "data/challenge_data/clinicalnlp_taskB_test1.csv"
)
CACHE = Path(__file__).parent / ".cache"
VOICES = {"doctor": "Rishi", "patient": "Samantha", "patient_guest": "Moira"}
WORDS_PER_MINUTE = 200


def turns(dialogue: str) -> list[tuple[str, str]]:
    """Split "[doctor] hi , andrew ." lines into (speaker, text) with normal punctuation."""
    out: list[tuple[str, str]] = []
    for line in dialogue.splitlines():
        m = re.match(r"^\[(\w+)\]\s*(.*)$", line.strip())
        if m:
            out.append((m.group(1), m.group(2)))
        elif line.strip() and out:
            out[-1] = (out[-1][0], out[-1][1] + " " + line.strip())
    return [(spk, re.sub(r"\s+([,.?!;:])", r"\1", text)) for spk, text in out if text]


def synthesize(dialogue: str, out_path: Path) -> float:
    """Voice every turn, join them, and return the audio length in seconds."""
    with tempfile.TemporaryDirectory() as tmp:
        parts = []
        for i, (speaker, text) in enumerate(turns(dialogue)):
            part = Path(tmp) / f"{i:04d}.aiff"
            voice = VOICES.get(speaker, VOICES["patient"])
            subprocess.run(
                ["say", "-v", voice, "-r", str(WORDS_PER_MINUTE), "-o", str(part), text],
                check=True,
            )
            parts.append(part)
        listing = Path(tmp) / "parts.txt"
        listing.write_text("".join(f"file '{p}'\n" for p in parts))
        subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
             "-i", str(listing), "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "48k",
             str(out_path)],
            check=True,
        )
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
         str(out_path)],
        check=True, capture_output=True, text=True,
    )
    return round(float(probe.stdout.strip()), 1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=20, help="number of visits to prepare")
    ap.add_argument("--max-words", type=int, default=1400,
                    help="skip dialogues longer than this (Gemini handles ~9.5 min of audio)")
    args = ap.parse_args()

    CACHE.mkdir(exist_ok=True)
    csv_path = CACHE / "aci_test1.csv"
    if not csv_path.exists():
        urllib.request.urlretrieve(ACI_URL, csv_path)  # noqa: S310 (fixed https URL)
    rows = [r for r in csv.DictReader(csv_path.open())
            if len(r["dialogue"].split()) <= args.max_words][: args.n]

    def build(row: dict[str, str]) -> dict[str, object]:
        audio = CACHE / f"{row['encounter_id']}.m4a"
        duration = synthesize(row["dialogue"], audio)
        return {"id": row["encounter_id"], "audio": str(audio), "duration_s": duration,
                "dialogue": row["dialogue"], "reference_note": row["note"]}

    with ThreadPoolExecutor(max_workers=6) as pool:
        cases = list(pool.map(build, rows))
    with (CACHE / "cases.jsonl").open("w") as f:
        for c in cases:
            f.write(json.dumps(c) + "\n")
    minutes = sum(float(c["duration_s"]) for c in cases) / 60
    print(f"{len(cases)} cases, {minutes:.1f} min of audio -> {CACHE / 'cases.jsonl'}")


if __name__ == "__main__":
    main()
