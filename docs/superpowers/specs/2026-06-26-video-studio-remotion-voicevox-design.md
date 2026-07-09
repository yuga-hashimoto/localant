# LocalAnt Video Studio Remotion + VOICEVOX Design

## Goal

LocalAnt Video Studio generates presentation-style short videos for OSS introductions, app introductions, and product introductions. It does not call paid external text-to-video APIs. The primary path is local Remotion rendering with local VOICEVOX narration.

## Primary Pipeline

1. Create a script and scene manifest.
2. Detect VOICEVOX Engine at `http://127.0.0.1:50021` or configured endpoint.
3. Fetch `/speakers` and select a speaker/style.
4. For each scene, call `/audio_query`, then `/synthesis`, and write a scene WAV.
5. Probe each scene WAV with `ffprobe`; scene durations and total project duration are derived from actual audio.
6. Generate captions from audio-derived timings: `output.srt`, `output.ass`, and `words.json`.
7. Write `render/render-props.json` and `render/motion-plan.json`.
8. Render `output/output.mp4` and `output/thumbnail.jpg` with Remotion.
9. Review with `ffprobe`; fail if the rendered video is shorter than the narration audio.

## Fallbacks

Remotion is the primary renderer. The existing static ffmpeg slide renderer remains a fallback only when Remotion is unavailable. VOICEVOX is the primary Japanese TTS. macOS `say` is preview fallback only, and ffmpeg silence is the last local fallback for automated tests.

## Dashboard

The Dashboard Video Studio card shows the primary renderer, fallback renderer, VOICEVOX endpoint, speaker count, selected speaker, voice quality, and render readiness. Project rows continue exposing Generate, Review, Prepare Publish, Browser Upload Assist, and Publish.

## Verification

`pnpm build`, `pnpm test`, and `pnpm video-studio:e2e` must pass. The E2E output must contain `output.mp4`, `thumbnail.jpg`, `output.srt`, `output.ass`, `words.json`, `render-props.json`, and `motion-plan.json`. When VOICEVOX is running, E2E must use VOICEVOX; otherwise it must clearly report fallback audio in the result while keeping the primary status visible.
