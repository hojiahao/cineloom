---
name: ad-brief-intake
version: "0.1.0"
description: Turn a rough advertising request into a confirmed production brief and open a CineLoom project. Use at the start of any new ad, commercial, product video or 广告片 request, or when the user changes the product, audience, platform, duration or aspect ratio of an existing project.
license: MIT
metadata:
  author: 方舟团队 (Team Ark)
  tags:
    - advertising
    - brief
    - planning
---

# Ad brief intake

A vague brief produces a generic film. Fix the few decisions everything else depends on,
then open the project so every later stage has one source of truth.

## Workflow

1. Extract what the request already states. Do not ask for it again.
2. Resolve the blocking unknowns, in this order, in one message: the product (and whether
   reference photos exist), the audience, the single message the viewer should remember.
3. Decide the rest yourself and say what you chose: platform, aspect ratio (9:16 for feed
   and short-video platforms, 16:9 for web and TV, 1:1 for marketplaces), duration (15 s
   default; 5 s steps because clips are generated in 5 s segments), tone, product category
   for compliance (`general`, `food`, `health_food`, `cosmetics`, `medical`).
4. Open the project:

   ```bash
   cineloom project init --id summer-soda --title "夏日气泡水" --brief "<one-paragraph brief>" --ratio 9:16 --duration 15
   ```

   The id is lowercase letters, digits and dashes.
5. Write `projects/<id>/brief.md` with the fields below. Put user-supplied reference
   images in `projects/<id>/refs/` and list them.

## brief.md fields

Product · Category · Audience · Single message · Proof points the user can substantiate ·
Platform, ratio, duration · Tone and visual style · Must show · Must avoid · References ·
Delivery route (local only, or cloud allowed for which step).

## Notes

- Record only claims the user can back up under "proof points". Anything else is a wish, and the script must not state it as fact.
- If the user says the product is unreleased or under NDA, write "local only" under delivery route. That line is what later stages check.
