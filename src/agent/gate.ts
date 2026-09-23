import type { Shot } from './checks.js'
import { chatJson, type ModelEndpoint } from './llm.js'
import { exec } from '../lib/exec.js'

/** The reviewer sees a 1024 px JPEG, not the full still: the verdict does not change, the prefill does. */
async function reviewCopy(path: string): Promise<string> {
  const copy = `${path}.review.jpg`
  await exec('ffmpeg', ['-y', '-v', 'error', '-i', path, '-vf', "scale='min(1024,iw)':-2", '-q:v', '3', copy])
  return copy
}

export interface QaVerdict {
  pass: boolean
  /** 0-100, or -1 when the reviewer could not answer and the frame went ahead unverified. */
  score: number
  issues: string[]
}

/**
 * The gate must never take the film down with it. A failed verdict is retried with a larger
 * budget; if the reviewer still cannot answer, the frame goes ahead marked unverified and the
 * delivery record says so.
 */
export async function qualityGate(reviewer: ModelEndpoint, frame: string, shot: Shot, productReference?: string): Promise<QaVerdict> {
  const [frameCopy, referenceCopy] = await Promise.all([reviewCopy(frame), productReference ? reviewCopy(productReference) : undefined])
  for (const maxTokens of [3500, 6000]) {
    try {
      return await runGate(reviewer, frameCopy, shot, referenceCopy, maxTokens)
    } catch {
      // fall through to the larger budget
    }
  }
  return { pass: true, score: -1, issues: ['quality gate unavailable: frame accepted unverified'] }
}

async function runGate(reviewer: ModelEndpoint, frame: string, shot: Shot, productReference: string | undefined, maxTokens: number): Promise<QaVerdict> {
  const run = await chatJson<QaVerdict>(
    reviewer,
    {
      system: 'You are the quality gate of an advertising studio. You did not write the prompt. Judge only what is visible, and be strict: a flawed frame costs six minutes of video generation.',
      images: productReference ? [frame, productReference] : [frame],
      // The local vision model reasons before it answers; too small a budget returns nothing at all.
      maxTokens,
      temperature: 0,
      user: `Image 1 is the generated frame.${productReference ? ' Image 2 is the approved product reference.' : ''}
The frame must show: ${shot.must_show}
Reject (pass=false) if ANY of these is true:
- the required content is missing;
${productReference ? '- the product in image 1 is a different product from image 2: another kind of object, other main colours, or different brand lettering. Ignore condensation, lighting, camera angle, reflections, scale and fine print - those are expected to change between shots;\n' : ''}- there is text that is not printed on the product itself: captions, slogans, subtitles, floating numbers, lens specs, watermarks. Lettering that belongs to the product (its label, key legends, packaging copy) is fine;
- any lettering is garbled, duplicated or nonsensical;
${/\b(hand|hands|person|people|student|man|woman|girl|boy|model|holding|drinking|sipping)\b/i.test(`${shot.must_show} ${shot.image_prompt}`) ? '' : '- a person, a hand or fingers appear although this shot does not call for them;\n'}- extra limbs, malformed hands or a distorted face;
- the product is cropped, floating or physically implausible, or a drink that should be clear is an odd colour.
Decide quickly; do not deliberate at length. Reply with JSON only: {"pass": boolean, "score": 0-100, "issues": ["short issue"]}. Pass requires score >= 80 and none of the reject conditions.`,
    },
    (verdict) => (typeof verdict.pass === 'boolean' && typeof verdict.score === 'number' ? [] : ['need boolean "pass" and numeric "score"']),
    2,
  )
  const issues = Array.isArray(run.value.issues) ? run.value.issues : []
  return { pass: run.value.pass && run.value.score >= 80, score: run.value.score, issues }
}

