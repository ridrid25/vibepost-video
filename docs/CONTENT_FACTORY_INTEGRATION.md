# Content Factory integration boundary

Canonical direction lives in `content-factory-personal/CROSS_REPO_CONTENT_FACTORY_ROADMAP.md` in the Text Factory repository.

Generator is the existing media-production boundary. It owns the accepted Idea input, owner-tuned prompts, manual Gemini/Flow, provider/model/generation parameters, camera/motion/reference behavior, duration/FPS/resolution/aspect ratio, voice/audio, Whisper, subtitles, FFmpeg, post-production, rendering/export and current VibePost delivery behavior.

Factory Core does not own or normalize those values. Cross-repository work enters through narrow versioned adapters and preserves the existing Generator input byte-semantically. No new renderer, encoder, subtitle engine, compositor, media processor, queue, recovery layer or video engine is built here without a separate owner decision.

## P1–P9 relationship

- **P1:** consume POST-01 handoff through the existing Idea contract; VibePost stores `creative_id` mapping. Generator settings stay unchanged.
- **P2/P3:** feedback and platform learning belong to existing VibePost memory, not Generator.
- **P4:** market evidence arrives only as approved abstract adapter input; source content is not copied.
- **P5/P6:** parent/mutation lineage and owner preferences belong to the shared identity/memory boundary.
- **P7/P8:** evaluators and lesson freshness belong to VibePost analytics.
- **P9:** business attribution is future external linkage.

POST-03 changes no Generator production file, prompt, config, path or runtime. Only this document and its README link are approved.
