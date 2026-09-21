---
name: storyboard-design
version: "0.1.0"
description: Convert an approved ad script into a shot-by-shot storyboard with image prompts, video motion prompts and reference assignments that the local image and video models can execute. Use after the script passes compliance, when a reference breakdown must be mapped onto a new product, or when the user asks to change shots, framing, camera moves or pacing.
license: MIT
metadata:
  author: 方舟团队 (Team Ark)
  tags:
    - advertising
    - storyboard
    - prompting
---

# Storyboard design

The storyboard is the contract between the script and the generators. Each shot must be
specific enough that a model with no memory of the other shots still produces a frame
that belongs to the same film.

## Workflow

1. Read `script/script.md` and `brief.md`. One script beat becomes one shot of 5 s (or 10 s for a slow hero shot; longer is two chained segments and drifts more).
2. Write a style line once - palette, light, lens, texture - and repeat it verbatim in every image prompt. Consistency comes from repetition, not from hoping the model remembers.
3. For each shot decide framing (extreme close-up, close-up, medium, wide), one camera move (static, push-in, pull-out, pan, orbit, tilt), subject and action, and which references apply.
4. Write the image prompt in English: subject first, then action, setting, light, framing, the style line. Put on-screen text in double quotes with its position ("top centre, bold white sans-serif"). Chinese text inside the quotes is fine - the image model renders it.
5. Write the video prompt separately: what moves, how the camera moves, and what stays still. Do not restate the look; the first frame carries it.
6. Assign references. Product photos go to every shot that shows the product, product first in the list. At most three references per shot.
7. If a reference breakdown exists, keep its shot count, durations, framing and camera moves; replace subject, product and scene.
8. Save `projects/<id>/storyboard/storyboard.json`.

## Output format

```json
{
  "style": "soft morning light, pastel teal and coral, 50mm, shallow depth of field, clean commercial look",
  "shots": [
    {"shot": 1, "seconds": 5, "beat": "hook", "framing": "extreme close-up", "camera": "slow push-in",
     "image_prompt": "...", "video_prompt": "...", "on_screen_text": "冰爽一夏",
     "refs": ["refs/can_front.png"], "must_show": "the can with its label readable"}
  ]
}
```

`must_show` is what the quality gate checks, so write it as something visible.

## Common failures

- Two subjects or two actions in one shot: the video model picks one. Split the shot.
- Text longer than about 8 characters, or text in the video prompt: it warps. Keep text on the frame, short.
- A different adjective set per shot: the film stops looking like one film.
