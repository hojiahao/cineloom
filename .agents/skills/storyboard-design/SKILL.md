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

1. Read the brief and the approved script. One script beat becomes one shot of 5 seconds.
2. Describe the product once, in `product`: container type, material, colours, and the label text in quotes. Every shot shows that same product. In `image_prompt` call it "the product" and do not describe it again - the pipeline generates one approved hero still from `product` and anchors every frame to it, because a product described per shot drifts (a can in shot 1 became a bottle in shot 2).
3. Write one `style` line - palette, light, texture, mood - and nothing else. No numbers, no lens specs, no resolution tags: the image model paints short tokens like "50mm" into the picture as text. Style and the no-text rule are appended to every shot automatically.
4. Never ask for captions, slogans or subtitles in `image_prompt`. On-screen text is typeset in post-production in a real font; text drawn by the model warps, duplicates and turns rare characters into common ones. Put the beat's text in `on_screen_text` only.
5. Design around what the models do badly. Prefer product, liquid, ice, glass, steam, light and macro compositions. Use at most one shot with a person, framed so that hands and face are not the subject. Never two subjects or two actions in one shot: the video model picks one.
6. Vary the shots like a cinematographer: change framing between neighbours (macro -> medium -> wide), give each shot a motivated light source, and build to the product reveal.
7. `image_prompt` in English: subject first, then action, setting, light, framing.
8. `video_prompt` in English, separate from the look: what moves, exactly one camera move described the way a cinematographer would ("slow push-in with a subtle, breath-like handheld float"), and what stays still. For product-only shots end with "No people and no hands enter the frame" - otherwise the video model tends to add a hand.
9. `must_show` is what the quality gate checks, so write something visible and specific.
10. If a reference breakdown exists, keep its shot count, durations, framing and camera moves; replace subject, product and scene.

## Semantic checks

The validator counts beats, checks languages and lengths. With `TYPESAFE_API_KEY` set,
each shot is also judged by Jev on what a regex cannot see: does the prompt ask for
lettering, does it pack two actions or two camera moves, does it re-describe the product,
does it call for a hand or person the `must_show` did not ask for. Findings above p = 0.7
come back as rewrite reasons in the same loop as the validator's own.

## Output format

```json
{
  "style": "cool backlit morning light, pastel teal and coral, shallow depth of field, fine film grain, clean commercial look",
  "product": "a slim matte-silver aluminium can with a teal band whose label reads \"冷\" in bold white brush calligraphy",
  "shots": [
    {"shot": 1, "seconds": 5, "framing": "macro", "camera": "slow push-in",
     "image_prompt": "Macro of the product half buried in crushed ice, condensation beading on the metal, backlit mist",
     "video_prompt": "Slow push-in with a subtle, breath-like handheld float. Droplets slide down the metal, mist drifts. The product stays still. No people and no hands enter the frame.",
     "on_screen_text": "冰爽一夏", "must_show": "the can upright in ice with its label readable"}
  ]
}
```

## Common failures

- Two subjects or two actions in one shot: the video model picks one. Split the shot.
- Text requested inside the image, or a style line with numbers in it: it shows up as stray lettering and the gate rejects the frame.
- Re-describing the product in a shot: the description competes with the hero still and the product drifts.
- The same framing three times in a row: the film reads as one long shot.
