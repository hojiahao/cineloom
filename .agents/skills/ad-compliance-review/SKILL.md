---
name: ad-compliance-review
version: "0.1.0"
description: Review Chinese advertising copy (scripts, voiceover, on-screen text, captions) for wording that PRC advertising rules restrict - absolute claims, unverifiable guarantees, medical or efficacy claims on non-medical products, and data claims without a source. Use after script or voiceover authoring and before any media generation, or whenever the user asks whether ad copy is compliant or "能不能这么说".
license: MIT
metadata:
  author: 方舟团队 (Team Ark)
  tags:
    - advertising
    - compliance
    - prc-advertising-law
---

# Ad compliance review

Generated copy reaches image, video and voice generation unchanged, so a restricted
phrase caught late costs a full regeneration. Review text before media.

## Workflow

1. Collect every user-visible string: voiceover, on-screen titles and the end-card message. (Nothing else reaches the screen: frames carry no generated text.) Save it as `projects/<id>/script/copy.txt`, one line per string.
2. Run the deterministic scan. It is local, fast, and reproducible:

   ```bash
   cineloom copy-check projects/<id>/script/copy.txt --category cosmetics > projects/<id>/reports/compliance.json
   ```

   The category comes from the brief. Exit code 1 means at least one `block` finding.
3. For each finding, read the matching section of `references/rules.md` before judging. The scan matches wording; whether a claim is substantiated depends on the brief's proof points.
4. Review what a wording scan cannot see: implied superlatives and comparisons with competitors, body or health effects claimed for food and drink ("提神醒脑", "解暑降火"), efficacy claims on cosmetics, statistics without a stated source, and register borrowed from another category (skincare vocabulary on a soda). The reviewer must not be the agent that wrote the copy; in CineLoom Harness it is a separate agent with this skill and a different system prompt.
5. Rewrite every `block` finding - keep the selling point, drop the restricted form - and rescan until the exit code is 0. Resolve `review` findings with proof from the brief, or rewrite them too.

## Severity

- `block`: wording the rules prohibit outright. The copy must not go downstream.
- `review`: allowed only with substantiation. Ask for the proof or rewrite.

## Limits

This is a wording screen, not legal advice. When the user is about to publish, say so, and list what still needs human or legal confirmation instead of implying the copy is cleared.
