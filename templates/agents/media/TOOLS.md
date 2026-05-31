# TOOLS.md - Media Agent

Local CLI/provider notes for the dedicated media agent. Verify availability with `command -v <tool>` when unsure; installations differ.

## Native tools

- `image_generate` — image generation/editing.
- `video_generate` — video generation.
- `music_generate` — music/audio generation.

## Ideogram MCP wrapper

- CLI wrapper: `ideogram` when installed on `PATH`; portable copy can be installed under this workspace with `openclaw media-generation setup-agent --install-ideogram-bin`.
- MCP server: official Ideogram MCP, default server name `ideogram`.
- Typical output: `out/ideogram`.

Use Ideogram for logos when available, when requested explicitly, or when its typography/logo behavior is likely a better fit than the native image models. If `ideogram doctor` fails because `mcporter` is unavailable or auth is missing, use `image_generate` fallback unless the caller explicitly wants Ideogram.

Commands:

```bash
ideogram doctor
ideogram auth
ideogram tools
ideogram schema
ideogram call generate_image --args '{"prompt":"...","aspect_ratio":"1x1"}'
ideogram call get_generation_status --args '{"request_id":"..."}'
ideogram call get_recent_generations --args '{"n":1}'
```

Notes:

- The bundled wrapper uses `mcporter --config <wrapper-root>/config/mcporter.ideogram.json` by default, so it does not require a global mcporter server entry.
- If symlinked, the wrapper resolves the real plugin path before looking for the bundled config.
- If copied into a media workspace, copy/install `config/mcporter.ideogram.json` beside it; the setup helper does this when `--install-ideogram-bin` is used.
- Override with `MCPORTER_CONFIG`, `IDEOGRAM_MCP_SERVER`, or `IDEOGRAM_OUT_DIR` when needed.
- It uses Ideogram MCP OAuth; no OAuth credentials are bundled in the plugin. On a new machine/account run `ideogram auth` once.
- `ideogram call TOOL ...` expands to `mcporter call ideogram.TOOL ...` with image saving enabled by the wrapper.
- For async generations, save the `request_id`, then poll `get_generation_status`.
- Return the local path and/or permalink when available.

## Common local media CLIs

Use only when present and allowed by the agent tool policy.

- `ffmpeg`, `ffprobe` — conversion, mux/demux, trim, encode, frame/audio extraction, metadata inspection.
- `mediainfo` — readable media metadata for codecs, bitrate, duration, tracks.
- `sox` — audio trim/normalize/fade/convert/spectrogram tasks.
- `mkvmerge`, `mkvextract` — MKV tracks, subtitles, chapters, attachments.
- `AtomicParsley` — MP4/M4A metadata.
- `yt-dlp` — preferred downloader for media URLs; use `youtube-dl` only as legacy fallback.
- `curl_cffi` may be installed for `yt-dlp` impersonation targets.
- If YouTube returns 403 on default clients, try the Android VR client fallback for audio, e.g. `yt-dlp --extractor-args "youtube:player_client=android_vr" -f 140 <url>`.
- `magick`, `identify` — ImageMagick conversion/resize/crop/watermark/contact sheets/inspection.
- `gifski`, `gifsicle` — GIF creation and optimization.
- `cwebp`, `dwebp` — WebP encode/decode.
- `pngquant`, `oxipng` — PNG compression/optimization.
- `jpegoptim` — JPEG optimization.
- `tesseract` — OCR; use `-l ita` for Italian when installed.
- `pdftoppm`, `pdftotext` — PDF to image/text via Poppler.
- `whisper-cli` — local speech-to-text fallback.

## File conventions

- Save generated/intermediate artifacts under `out/` in this workspace unless the caller asks otherwise.
- Keep source media intact; write derivatives with clear names.
- Inspect metadata before destructive transforms.
- Prefer H.264 `.mp4` for broad video sharing; prefer `.ogg` opus or `.mp3` for audio sharing.
