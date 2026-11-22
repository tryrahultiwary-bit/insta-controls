# Insta Controls

YouTube-style video controls for Instagram (Reels, feed, posts, Stories) in Chrome.

Hover any video for a control bar: play/pause, scrub bar with time, volume and mute, copy link + transcript, speed (0.25×–2×), loop, picture-in-picture and fullscreen. Up/down buttons on the right side of the video jump to the next or previous Reel or post.

## Install

1. Unzip `Insta-Controls.zip` (or use the `insta-controls` folder).
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `insta-controls` folder.
4. Pin it from the puzzle-piece menu and reload any open Instagram tabs.
5. Optional, for transcripts: in Terminal, run `./install.sh` from the `insta-controls` folder (see below).

## Shortcuts

| Key | Action |
| --- | --- |
| Space / K | Play / pause |
| J / L | Back / forward 10 s |
| ← / → | Back / forward 5 s (in Stories, arrows keep switching stories) |
| ↑ / ↓ | Volume |
| M | Mute |
| F | Fullscreen |
| I | Picture-in-picture |
| < / > | Slower / faster |
| 0–9 | Jump to 0–90 % |
| , / . | Frame step (when paused) |
| T | Copy link + transcript |
| N or Shift+↓ | Next Reel / post |
| P or Shift+↑ | Previous Reel / post |

Shortcuts are ignored while typing in comments, search or DMs.

## Settings (toolbar popup)

- **Control bar on hover**: show or hide the bar. Shortcuts still work with it hidden.
- **Default speed**: 0.5× to 2×.
- **Loop videos**: on by default, like Instagram.
- **Auto-scroll**: go to the next Reel when one ends.
- **Remember choices**: keep volume, mute and speed across videos. Instagram's own re-muting is undone. Unmuting waits until you have clicked the page once, because Chrome pauses videos that unmute before that.
- **Click video to pause**: a click on the video pauses or plays it, instead of Instagram's click-to-mute. Buttons, links and Stories taps are left alone.
- **Keyboard shortcuts**: on or off.

## Copy link + transcript

The transcript button (lines with a down arrow) or **T** copies:

```
https://www.instagram.com/reel/<code>/

<transcript text>
```

A spinner toast shows "Transcribing…", then "Copied link + transcript". If the video has no words (music only, or no sound), it shows "No speech found · link copied" and copies just the link.

Where the text comes from, in order:

1. **Instagram's own captions.** If Instagram's page data includes a caption file for the video (`video_subtitles_uri`, usually auto-captions on Reels when you're logged in), that file is used. It's instant and matches what Instagram shows. Logged out, Instagram doesn't send caption files, so this step usually finds nothing.
2. **Speech-to-text on your Mac.** Otherwise a small local helper downloads the video's audio with yt-dlp and transcribes it with whisper.cpp (model `large-v3-turbo`, with Silero voice detection). It needs no API key or account, and nothing is sent anywhere except the download from Instagram. If Instagram asks for a login, the helper uses your Instagram cookies from Chrome for that one download.

Limits of the speech-to-text helper:

- **Setup:** run `./install.sh` once. It installs `yt-dlp`, `ffmpeg` and `whisper-cpp` with Homebrew and downloads about 575 MB of model files to `~/Library/Application Support/InstaControls`. Without it, T copies the link only and says "run install.sh for transcripts". If you move the folder, run `install.sh` again.
- **Speed:** a 1-minute Reel takes about 5 seconds on Apple Silicon. Intel Macs are several times slower.
- **Length:** only the first 20 minutes are transcribed.
- **Languages:** about 100 languages, detected automatically. English is very accurate. Hindi is good, but Hinglish may come out in Devanagari or mixed scripts. The transcript stays in the spoken language and isn't translated.
- **Accuracy:** speech over loud music, or song lyrics, may be partly wrong or skipped. Music-only videos give "No speech found". There's no punctuation guarantee and no speaker names.

## Notes

- Videos are found by their `<video>` tag, not Instagram's class names, so Instagram's layout changes shouldn't break it.
- While the bar shows, its mute button sits over Instagram's own speaker icon and does the same job.
- Picture-in-picture can pause when you scroll the video off screen, because Instagram pauses videos that leave the screen.
- Without the helper, no data leaves your browser. With it, audio is downloaded from Instagram and transcribed on your Mac. Permissions: `storage` (settings), `nativeMessaging` (the helper), `cookies` (Instagram login for the helper's download), `clipboardWrite` (copying, since Instagram blocks the page clipboard).
