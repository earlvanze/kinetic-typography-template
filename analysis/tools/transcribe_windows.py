"""Draft a lyric sheet when there is none: whisper.cpp over SHORT overlapping windows of the Demucs vocal stem.
Whole-file passes on sung vocals often return only "♫" or loop on one phrase; short windows with --suppress-nst, no carried
context (-mc 0) and an optional prompt (names, key phrases) are far more reliable. Read the output as EVIDENCE: confirm every
line against the audio (verify_fa.py) — or better, get the original lyric text — before locking timing.
usage: WHISPER_MODEL=/path/ggml-medium.en.bin uv run python tools/transcribe_windows.py [--win 8] [--hop 6] [--prompt "..."] [--from 0 --to 200]
"""
import argparse, os, subprocess, tempfile
ap = argparse.ArgumentParser()
ap.add_argument('--vocals', default='work/vocals16.wav'); ap.add_argument('--win', type=float, default=8); ap.add_argument('--hop', type=float, default=6)
ap.add_argument('--prompt', default=''); ap.add_argument('--from', dest='t0', type=float, default=0); ap.add_argument('--to', dest='t1', type=float, default=None)
a = ap.parse_args()
model = os.environ.get('WHISPER_MODEL') or exit('set WHISPER_MODEL to a ggml whisper model (e.g. ggml-medium.en.bin)')
dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', a.vocals]))
t1 = a.t1 or dur
with tempfile.TemporaryDirectory() as tmp:
    t = a.t0
    while t < t1:
        clip = os.path.join(tmp, 'c.wav')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(t), '-t', str(a.win), '-i', a.vocals, clip], check=True)
        cmd = ['whisper-cli', '-m', model, '-f', clip, '-l', 'en', '--suppress-nst', '-mc', '0', '-bs', '6', '-otxt', '-of', os.path.join(tmp, 'o')]
        if a.prompt: cmd += ['--prompt', a.prompt]
        subprocess.run(cmd, capture_output=True)
        txt = open(os.path.join(tmp, 'o.txt')).read().replace('\n', ' ').strip() if os.path.exists(os.path.join(tmp, 'o.txt')) else ''
        print(f'{t:7.1f} | {txt}', flush=True)
        t += a.hop
