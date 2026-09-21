---
name: shot-quality-gate
version: "0.1.0"
description: Inspect a generated advertisement frame with the local vision model and decide whether it may proceed to video generation - product identity against references, warped text or logos, anatomy errors, and whether the required content is present. Use after every generated frame and before any clip is made from it, or when the user asks to check, QA or verify generated shots.
license: MIT
metadata:
  author: 方舟团队 (Team Ark)
  tags:
    - dgx-spark
    - stepfun
    - vision
    - quality
---

# Shot quality gate

Video generation is the expensive step, and it faithfully animates whatever is wrong in
its first frame. Gate frames with a second pair of eyes that did not write the prompt.

## Workflow

1. Run the gate with the shot's references and its storyboard `must_show`:

   ```bash
   cineloom qa --project <id> --shot 1 --frame projects/<id>/frames/shot_001.png \
     --ref projects/<id>/refs/can_front.png --expect "the can with its label readable"
   ```

   The StepFun vision model (local) returns `{"pass", "score", "issues"}`; the report is saved to `reports/qa_1.json`. Exit code 1 means rejected.
2. On rejection, change the prompt according to the issues before regenerating - the same prompt mostly fails the same way:
   - product mismatch -> add or reorder references, product first; describe label colour and shape in words
   - warped text -> shorten the text, or drop it from the image and add it as a subtitle at the cut
   - anatomy -> reframe so hands are not the subject, or change the action
   - missing content -> move it to the front of the prompt
3. At most two regenerations per shot. Then keep the highest-scoring attempt and note the open issue for the delivery report.
4. Record the pass rate and regeneration count across the project; they are the evidence that the loop works.

## Limits

The vision model judges what is visible in one frame. It does not see motion, and it can
miss small logo errors. For hero product shots, show the frame to the user as well.
