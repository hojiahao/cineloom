---
name: ad-script-writing
version: "0.1.0"
description: Write the script for a short advertisement - hook, beats, voiceover, on-screen text and call to action, timed to the project duration. Use after the brief is confirmed, or when the user asks to rewrite, shorten, change the tone of, or localise an ad script or 广告脚本/口播/文案.
license: MIT
metadata:
  author: 方舟团队 (Team Ark)
  tags:
    - advertising
    - copywriting
    - script
---

# Ad script writing

A short ad has room for one idea. The script's job is to land that idea in the first
three seconds and spend the rest proving it.

## Workflow

1. Read `projects/<id>/brief.json`. The "single message" is the spine; every beat serves it.
2. Pick one structure and name it in the script header:
   - Problem -> product -> payoff (daily-use goods)
   - Sensory close-ups -> reveal (food, drink, beauty)
   - Before / after (tools, services)
   - One scene, one line (brand moments)
3. Divide the duration into 5-second beats - one beat becomes one generated clip. A 15 s ad has three beats; do not write more.
4. For each beat write: what we see (one subject, one action), voiceover, on-screen text, and the beat's job (hook, proof, payoff, call to action).
5. Budget words: Mandarin voiceover reads at about 4 characters per second. Write 10-18 characters per 5 s beat and count them (punctuation does not count). Over 18 cannot be read in time; under 8 leaves most of the beat silent - a model asked only for a maximum tends to answer with four characters.
6. On-screen text is a title of at most 8 characters per beat. It is typeset in post-production in a real font, never drawn by the image model, so write exactly what should appear: Chinese characters, digits and ordinary full-width punctuation only - no emoji, no symbols, no doubled marks, and no closing punctuation on a title.
7. Write `projects/<id>/script/script.json`, then hand the copy to `ad-compliance-review` before anything is generated.

## Output format

```json
{"structure": "sensory close-ups -> reveal",
 "beats": [
  {"beat": 1, "job": "hook",   "see": "ice cracking around the can, backlit", "vo": "冰块轻响，夏天就此开罐", "text": "开罐"},
  {"beat": 2, "job": "proof",  "see": "...", "vo": "...", "text": "..."},
  {"beat": 3, "job": "payoff", "see": "...", "vo": "...", "text": "..."}
 ]}
```

`see` is in English (it feeds the storyboard); `vo` and `text` are in Chinese. The validator that accepts or rejects this file is `src/agent/checks.ts` - beat count, 8-18 spoken characters, title length, caption characters and the compliance scan.

## Quality bar

- The first beat works with the sound off.
- The product is visible in at least two beats, and in the last one.
- Claims come from the brief's proof points. No superlatives, no guarantees, no numbers without a source, and no body or health effects for food and drink ("提神醒脑", "解暑降火") - these fail compliance and cost a rewrite. Describe the experience (taste, feel, moment), not an effect.
- Match the register to the category: a drink is tasted, a cream is felt, a device is used. Borrowing another category's vocabulary ("肌肤燥热" for a soda) reads as wrong even when every rule passes.
- The film ends on an end card with the brand and the single message, so the last beat should hand over to it rather than repeat it.
- Voiceover sounds like a person talking, not a slogan list. Read it aloud once.
