---
name: spark-local-media-generation
version: "0.1.0"
description: Generate advertisement frames and video clips on the local DGX Spark with the cineloom CLI (ComfyUI running Qwen-Image, Qwen-Image-Edit and Wan2.2) instead of a cloud API. Use when storyboard frames, product or character shots, or shot clips must be produced, when material is confidential or unreleased, or when choosing between local and cloud generation.
license: MIT
metadata:
  author: 方舟团队 (Team Ark)
  tags:
    - dgx-spark
    - comfyui
    - qwen-image
    - wan2.2
---

# Spark local media generation

Frames first, clips second. A clip is generated from its approved frame, so product
identity is decided at the frame stage where a retry costs seconds, not minutes.

## Workflow

1. Check memory with `spark-model-scheduler` before the first frame and before the first clip.
2. Generate each storyboard frame. References switch the request to the edit model:

   ```bash
   cineloom image --project <id> --shot 1 --size 1080x1920 \
     --prompt "<image_prompt>" --ref projects/<id>/refs/can_front.png
   ```

   Sizes above the native budget (1328x1328 pixels in total) are generated natively and upscaled; the output says `upscaled: true`.
3. Run `shot-quality-gate` on every frame. Only approved frames move on.
4. Generate each clip from its approved frame:

   ```bash
   cineloom video --project <id> --shot 1 --duration 5 --ratio 9:16 --resolution 720p \
     --prompt "<video_prompt>" --first-frame projects/<id>/frames/shot_001.png
   ```

   Durations are multiples of 5 s. Ten seconds is two segments, the second continued from the first one's last frame. Add `--keep-loaded` on every clip except the last so the video model stays in memory between shots.
5. Every command prints measured `seconds` and records the asset in the project with `execution: local-dgx-spark`. Keep these numbers for the delivery report.

## Prompting the local models

- Qwen-Image renders Chinese and English text. Quote the exact text and say where it sits.
- With references, name them in order: "image 1 is the product, image 2 is the model". Product first; more than three are ignored.
- Wan2.2 wants one camera move and one action per segment, described plainly. It produces no audio.

## When something fails

- `ComfyUI rejected the workflow` or a missing model file: run `cineloom doctor`. It compares the workflow templates with the running ComfyUI and lists unknown nodes and missing weights.
- Connection refused: ComfyUI is not up. See `deploy/spark/`.
- Out of memory or heavy swapping: run `cineloom mem free`, then follow `spark-model-scheduler`.

Model files and graphs behind each route: `references/workflows.md`.
