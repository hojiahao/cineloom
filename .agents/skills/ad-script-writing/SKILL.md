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

1. Read `projects/<id>/brief.md`. The "single message" is the spine; every beat serves it.
2. Pick one structure and name it in the script header:
   - Problem -> product -> payoff (daily-use goods)
   - Sensory close-ups -> reveal (food, drink, beauty)
   - Before / after (tools, services)
   - One scene, one line (brand moments)
3. Divide the duration into 5-second beats - one beat becomes one generated clip. A 15 s ad has three beats; do not write more.
4. For each beat write: what we see (one subject, one action), voiceover, on-screen text, and the beat's job (hook, proof, payoff, call to action).
5. Budget words: Mandarin voiceover reads at about 4 characters per second. Write 10-18 characters per 5 s beat and count them. Over 18 cannot be read in time; under 8 leaves most of the beat silent - a model asked only for a maximum tends to answer with four characters.
6. On-screen text is at most 8 characters per beat and must be exact - the image model renders it literally.
7. Write `projects/<id>/script/script.md`, then hand the copy to `ad-compliance-review` before anything is generated.

## Output format

```markdown
# <title> - <duration>s - <ratio> - structure: <name>
## Beat 1 (0-5s) - hook
See: ...
VO: ...            (n chars)
Text: "..."
## Beat 2 (5-10s) - proof
...
```

## Quality bar

- The first beat works with the sound off.
- The product is visible in at least two beats, and in the last one.
- Claims come from the brief's proof points. No superlatives, no guarantees, no numbers without a source - these fail compliance and cost a rewrite.
- Voiceover sounds like a person talking, not a slogan list. Read it aloud once.
