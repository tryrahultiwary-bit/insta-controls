#!/bin/bash
# Optional: installs the transcript helper (yt-dlp + ffmpeg + whisper.cpp, all local) and registers it with Chrome.
# The video controls work without this; only "Copy link + transcript" falls back to the link alone.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
NAME="com.instacontrols.host"
ID="ffabmibhcmglnidcbcmkhidjikbngpdg"   # fixed by the "key" in manifest.json
DATA="$HOME/Library/Application Support/InstaControls"
HF="https://huggingface.co"

command -v brew >/dev/null || { echo "Install Homebrew first: https://brew.sh"; exit 1; }
command -v yt-dlp >/dev/null || brew install yt-dlp
command -v ffmpeg >/dev/null || brew install ffmpeg
command -v whisper-cli >/dev/null || brew install whisper-cpp
command -v python3 >/dev/null || brew install python

mkdir -p "$DATA"
get() { [ -s "$DATA/$1" ] || { echo "Downloading $1…"; curl -fL --retry 3 -o "$DATA/$1.part" "$2" && mv "$DATA/$1.part" "$DATA/$1"; }; }
get ggml-large-v3-turbo-q5_0.bin "$HF/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin"   # ~575 MB, multilingual
get ggml-silero-v5.1.2.bin "$HF/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin"                 # ~1 MB, skips music/silence

# Chrome starts hosts with a bare PATH: pin the interpreter.
PY=$(command -v python3)
sed -i '' "1s|.*|#!$PY|" "$DIR/host/ic_host.py"
chmod +x "$DIR/host/ic_host.py"

HOSTS="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$HOSTS"
cat > "$HOSTS/$NAME.json" <<EOF
{
  "name": "$NAME",
  "description": "Insta Controls transcript helper",
  "path": "$DIR/host/ic_host.py",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$ID/"]
}
EOF

echo "Done. Transcript helper registered for extension $ID."
echo "If you move this folder, run install.sh again."
