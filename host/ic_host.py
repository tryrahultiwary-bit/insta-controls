#!/usr/local/bin/python3
"""Insta Controls transcript helper (Chrome native messaging host).
Message: {url, jar?} -> {text} | {error}
Downloads the video's audio with yt-dlp, then transcribes it on this Mac with whisper.cpp (whisper-cli).
"""
import json, os, re, shutil, struct, subprocess, sys, tempfile

os.environ["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + os.environ.get("PATH", "")
DATA = os.path.expanduser("~/Library/Application Support/InstaControls")
MODEL = os.path.join(DATA, "ggml-large-v3-turbo-q5_0.bin")
VAD = os.path.join(DATA, "ggml-silero-v5.1.2.bin")
MAX_SECONDS = 20 * 60  # longer videos: only the first 20 minutes
URL_RE = re.compile(r"^https://www\.instagram\.com/[A-Za-z0-9_./-]+$")
LOGIN_HINTS = ("cookies", "login", "log in", "sign in", "empty media response", "rate-limit", "private", "not available")


def send(obj):
    b = json.dumps(obj).encode()
    sys.stdout.buffer.write(struct.pack("<I", len(b)) + b)
    sys.stdout.buffer.flush()


def read():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        sys.exit(0)
    return json.loads(sys.stdin.buffer.read(struct.unpack("<I", raw)[0]))


def write_jar(jar, path):
    """Instagram cookies from the extension as a private cookies.txt (only used when Instagram asks for a login)."""
    with open(path, "w") as f:
        f.write("# Netscape HTTP Cookie File\n")
        for c in jar:
            sub = not c.get("hostOnly")
            d = c["domain"] if not sub or c["domain"].startswith(".") else "." + c["domain"]
            f.write("\t".join([d, "TRUE" if sub else "FALSE", c.get("path") or "/", "TRUE" if c.get("secure") else "FALSE",
                               str(int(c.get("expirationDate") or 0)), c["name"], c["value"]]) + "\n")
    os.chmod(path, 0o600)


def download(url, tmp, jar):
    cmd = ["yt-dlp", "-q", "--no-warnings", "--no-playlist", "-f", "ba/b", "-o", os.path.join(tmp, "a.%(ext)s")]
    p = subprocess.run([*cmd, "--", url], capture_output=True, text=True, timeout=180)
    if p.returncode and jar and any(h in p.stderr.lower() for h in LOGIN_HINTS):
        cj = os.path.join(tmp, "cookies.txt")
        write_jar(jar, cj)
        p = subprocess.run([*cmd, "--cookies", cj, "--", url], capture_output=True, text=True, timeout=180)
    files = [f for f in os.listdir(tmp) if f.startswith("a.")]
    if p.returncode or not files:
        lines = p.stderr.strip().splitlines()
        raise RuntimeError("Download failed: " + (lines[-1] if lines else "no audio")[:200])
    return os.path.join(tmp, files[0])


# Whisper's stock output for music or noise with no words in it.
HALLUCINATIONS = {"foreign", "you", "thank you", "thanks for watching", "thank you for watching", "bye", "music",
                  "subtitles by the amara.org community", "please subscribe"}


def clean(text):
    text = re.sub(r"\[[^\]]*\]|\([^)]*(music|applause|laugh|silence)[^)]*\)|[♪♫]", " ", text, flags=re.I)
    text = re.sub(r"[ \t]+", " ", re.sub(r"\s*\n\s*", " ", text)).strip()
    return "" if re.sub(r"[^\w ]", "", text).strip().lower() in HALLUCINATIONS else text


def transcribe(msg):
    url = str(msg.get("url", ""))
    if not URL_RE.match(url):
        raise ValueError("Not an Instagram link")
    for tool in ("yt-dlp", "ffmpeg", "whisper-cli"):
        if not shutil.which(tool):
            raise RuntimeError(f"{tool} is missing. Run install.sh again.")
    if not os.path.exists(MODEL):
        raise RuntimeError("Speech model is missing. Run install.sh again.")
    with tempfile.TemporaryDirectory() as tmp:
        src = download(url, tmp, msg.get("jar"))
        wav = os.path.join(tmp, "a.wav")
        f = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-t", str(MAX_SECONDS), "-vn", "-ar", "16000", "-ac", "1",
                            "-c:a", "pcm_s16le", wav], capture_output=True, text=True, timeout=120)
        if f.returncode:
            if "does not contain any stream" in f.stderr or "matches no streams" in f.stderr:
                return ""  # video has no sound track
            raise RuntimeError("Audio conversion failed: " + (f.stderr.strip().splitlines() or ["unknown"])[-1][:200])
        vad = ["--vad", "-vm", VAD] if os.path.exists(VAD) else []
        p = subprocess.run(["whisper-cli", "-m", MODEL, "-f", wav, "-l", "auto", "-nt", "-np", "-sns", *vad],
                           capture_output=True, text=True, timeout=900)
        if p.returncode:
            raise RuntimeError("Transcription failed: " + (p.stderr.strip().splitlines() or ["unknown error"])[-1][:200])
        return clean(p.stdout)


def main():
    msg = read()
    try:
        send({"text": transcribe(msg)})
    except Exception as e:  # report every failure to the extension instead of dying silently
        send({"error": str(e)})


if __name__ == "__main__":
    main()
