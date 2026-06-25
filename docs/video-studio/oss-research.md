# OSS Research

## Compared projects

- name: Remotion
- url: https://github.com/remotion-dev/remotion and https://www.remotion.dev/docs/
- stars if available: about 51.2k on GitHub when checked on 2026-06-25
- last activity if available: latest release v4.0.482 on 2026-06-22 when checked
- license: custom Remotion license, with company-license requirements in some cases
- stack: TypeScript, React, browser rendering, programmatic composition
- useful ideas: composition objects, props-driven rendering, preview/render separation, reusable templates
- risks: too heavy for the first LocalAnt implementation and license constraints make direct dependency undesirable

- name: MoviePy
- url: https://github.com/Zulko/moviepy and https://zulko.github.io/moviepy/
- stars if available: GitHub project is a widely used Python video editing library
- last activity if available: active public repository when checked
- license: MIT
- stack: Python, FFmpeg-backed clip composition
- useful ideas: timeline-style clip composition, audio/video/text overlay separation, cross-platform fallback
- risks: adds Python runtime dependency and package installation surface to LocalAnt

- name: WhisperX
- url: https://github.com/m-bain/whisperX
- stars if available: public GitHub project
- last activity if available: active public repository when checked
- license: BSD-style license in repository
- stack: Python, Whisper, alignment models
- useful ideas: word-level timestamp structure, future speech-to-caption alignment, diarization-ready JSON
- risks: large ML/runtime dependencies; not suitable as required default

- name: FFmpeg
- url: https://ffmpeg.org/
- stars if available: not applicable
- last activity if available: active upstream project
- license: LGPL/GPL depending on build options
- stack: native CLI
- useful ideas: final render, audio muxing, ASS subtitle burn-in, thumbnail extraction, ffprobe validation
- risks: local install required; codec/filter availability varies by build

- name: Aegisub / ASS subtitle design
- url: https://github.com/TypesettingTools/Aegisub
- stars if available: public GitHub project
- last activity if available: active public repository when checked
- license: BSD-style license in repository
- stack: C++, ASS subtitle editor
- useful ideas: style/timing separation, safe area, outline/shadow readability, karaoke-style future extension
- risks: editor code is not needed; LocalAnt should emit ASS directly

- name: OpenShorts
- url: https://github.com/mutonby/openshorts
- stars if available: GitHub badge present; exact count can drift
- last activity if available: active enough to have current docs/site when checked
- license: MIT
- stack: self-hosted Docker app, short-video workflows
- useful ideas: clip generation, AI shorts, YouTube Studio style workflow grouping
- risks: full platform scope is larger than LocalAnt's first pass

- name: gyoridavid/short-video-maker
- url: https://github.com/gyoridavid/short-video-maker
- stars if available: public GitHub project
- last activity if available: active public repository when checked
- license: repository license should be checked before copying any code
- stack: MCP/REST, Kokoro TTS, Whisper, Pexels, Remotion
- useful ideas: text to TTS to captions to Remotion render pipeline, MCP-compatible public surface
- risks: Pexels/API-backed media search and ML dependencies are not acceptable as mandatory defaults here

## Design decisions for LocalAnt

- what to adopt: Remotion's scene/composition/props model, MoviePy's separation of clips/audio/overlays, WhisperX's word-timing JSON shape, FFmpeg as the required first renderer, ASS subtitles for readable Shorts/Reels captions, and a browser-upload-assist provider that stops before submit.
- what not to adopt: paid external video generation APIs, cloud text-to-video APIs, mandatory Remotion dependency, mandatory Python/ML stack, API-only publishers as the default path, or any copied OSS source.
- why: the product requirement is a free local fallback that can generate a real uploadable MP4 from ChatGPT/MCP. Optional paid or reviewed APIs can exist later, but they cannot be required for video generation.

## Implementation mapping

No source code copied. The implementation only adopts architecture patterns and file-format ideas from the projects above.

- Remotion mapping:
  - OSS idea: represent videos as parameterized compositions, separate preview/editing from final render, and reuse templates.
  - LocalAnt implementation: `VideoProject`, `VideoScene`, and render-plan JSON are props-driven scene/composition equivalents. Dashboard preview/review is separated from `video_studio_render_video`. The `generate_video` tool orchestrates reusable steps instead of hiding everything in a single opaque command.
  - Not adopted: Remotion runtime dependency, React rendering bundle, Lambda/Cloud Run rendering, or custom Remotion licensing exposure in the first implementation.

- MoviePy mapping:
  - OSS idea: think in clips and layers: image/video clip, audio clip, text overlay, final composition.
  - LocalAnt implementation: each scene becomes a generated visual clip, each narration segment becomes a WAV clip, captions are emitted as SRT/ASS/words, and FFmpeg composes the final MP4. The project directory keeps each layer in `assets/`, `audio/`, `captions/`, `render/`, and `output/`.
  - Not adopted: Python dependency, MoviePy runtime, or dynamic Python package installation.

- WhisperX mapping:
  - OSS idea: word-level timestamp data enables later subtitle alignment, highlighting, and diarization.
  - LocalAnt implementation: `captions/words.json` uses `{ word, start, end, sceneId }` entries so the initial deterministic caption splitter can later be replaced by true WhisperX-style alignment without changing downstream render/review APIs.
  - Not adopted: ML transcription, GPU requirements, diarization, or model downloads as mandatory defaults.

- FFmpeg mapping:
  - OSS idea: use CLI primitives for final rendering, audio muxing, thumbnail extraction, ffprobe validation, progress overlays, and optional subtitle filters.
  - LocalAnt implementation: built-in FFmpeg is the primary renderer; it concatenates scene clips, pads/muxes narration, draws a progress bar, extracts `thumbnail.jpg`, records `ffmpeg-command.txt`, and validates streams with ffprobe.
  - Compatibility decision: FFmpeg subtitle rendering requires libass-enabled builds. Since this Mac's FFmpeg build did not expose `ass/subtitles` filters, LocalAnt still writes `.ass` and `.srt`, but burns readable caption text into generated scene visuals so output remains uploadable on common free FFmpeg installs.

- Aegisub / ASS mapping:
  - OSS idea: keep subtitle style, safe area, outline, timing, and text content separate.
  - LocalAnt implementation: `output.ass` uses a dedicated style block with large white text, outline/shadow, bottom safe area, and per-scene dialogue events. The renderer can consume this directly later when libass is available.
  - Not adopted: Aegisub editor/runtime or UI code.

- OpenShorts / short-video-maker mapping:
  - OSS idea: creator-facing pipeline should be script -> scene plan -> TTS/audio -> captions -> render -> publish preparation, exposed through an automation API.
  - LocalAnt implementation: MCP tools follow that pipeline exactly and keep one-shot `video_studio_generate_video` as a wrapper over explicit steps. The browser publisher mirrors the practical OSS pattern of using local/browser upload flows when official APIs require review.
  - Not adopted: Pexels/media API search, paid model calls, mandatory Kokoro/Whisper/Remotion stack, or unreviewed third-party API posting as the default.

## Final architecture

- renderer: `builtin-ffmpeg` first. It creates scene images, burns ASS captions, muxes local narration when available, extracts a thumbnail, and validates with ffprobe.
- script generator: deterministic template generator that works without an LLM API.
- asset generator: free local generated visuals. It writes per-scene PNGs using FFmpeg color/image generation when available, with SVG placeholders retained for inspection.
- audio generator: free local narration. On macOS it uses `say`; otherwise FFmpeg silence is used when possible, with setup guidance only if neither local option works.
- caption system: SRT, ASS, and `words.json` are generated from scene timings, with the JSON shaped for future WhisperX word alignment.
- publisher system: browser upload assist and dry-run metadata first. Official APIs are readiness-checked but not required.
- dashboard integration: dashboard routes call the same MCP tools so ChatGPT and the local UI share one implementation.
