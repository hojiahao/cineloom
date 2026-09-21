---
name: final-cut-assembly
version: "0.1.0"
description: Assemble approved clips into the final advertisement with ffmpeg - shot order, uniform size and frame rate, subtitles, music bed - and write the delivery report. Use when all clips of a project exist, or when the user asks to re-cut, add or change subtitles or music, or export the final video.
license: MIT
metadata:
  author: 方舟团队 (Team Ark)
  tags:
    - ffmpeg
    - editing
    - delivery
---

# Final cut assembly

## Workflow

1. Confirm every storyboard shot has a clip: `cineloom project status --id <id>`.
2. Build subtitles from the script's voiceover as `projects/<id>/cut/subtitles.srt`. One cue per beat, timed to the beat's window, at most 14 characters per line. On-screen text that failed the quality gate belongs here instead of in the image.
3. Assemble:

   ```bash
   cineloom cut --project <id> --subtitles projects/<id>/cut/subtitles.srt --audio projects/<id>/refs/music.mp3
   ```

   Clips are ordered by shot number, scaled and padded to the project ratio at 24 fps, joined, then subtitles are burned in and the music bed mixed at -10 dB. `--audio` and `--subtitles` are optional. Only use music the user supplied or has rights to.
4. Check the printed duration against the brief. A mismatch means a missing or extra clip, not a rounding problem.
5. Write `projects/<id>/reports/delivery.md`.

## delivery.md

- What was made: title, duration, ratio, link to `cut/final.mp4`.
- Per shot: prompt summary, generation seconds for frame and clip, quality-gate score, regenerations.
- Totals: measured wall time per stage, peak memory from `cineloom mem status`, quality-gate pass rate.
- Where each asset was produced (local or cloud) and which model produced it.
- Open issues: shots kept despite a failed gate, compliance items that need human confirmation.
- Label for publication: the film is AI-generated and must be marked as such on platforms that require it.
