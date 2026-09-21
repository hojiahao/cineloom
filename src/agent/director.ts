import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ComfyClient } from '../comfy/client.js'
import { scanCopy } from '../lib/compliance.js'
import { assembleFilm, clipStart, probeDuration } from '../lib/ffmpeg.js'
import { generateImage, generateVideo, type VideoModel } from '../lib/media.js'
import { buildAss } from '../lib/titles.js'
import { memoryStatus } from '../lib/memory.js'
import { addAsset, createProject, projectDir, setStage, type Stage } from '../lib/project.js'
import { checkBrief, checkScript, checkStoryboard, composeImagePrompt, composeProductPrompt, type Brief, type Script, type Shot, type Storyboard } from './checks.js'
import { chatJson, endpoints, type ModelEndpoint } from './llm.js'
import { loadRules, loadSkill } from './skills.js'

export interface DirectOptions {
  brief: string
  id?: string
  ratio?: string
  durationSeconds?: number
  /** Stop after the storyboard; useful for evals and for reviewing the plan before spending GPU time. */
  planOnly?: boolean
  /** Run the agents without their skills. Exists for the with/without-skill comparison only. */
  withoutSkills?: boolean
  resolution?: string
  videoModel?: VideoModel
  /** Music bed for the final cut. Only a file the user supplied or has rights to. */
  audio?: string
  log?: (line: string) => void
}

export interface DirectResult {
  projectId: string
  dir: string
  finalCut?: string
  rejectedAttempts: Record<string, number>
  qaRegenerations: number
  wallSeconds: number
}

const FRAME_SIZE: Record<string, string> = { '9:16': '1080x1920', '16:9': '1920x1080', '1:1': '1328x1328' }
const MAX_QA_REGENERATIONS = 2
const FINAL_SIZE: Record<string, [number, number]> = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080] }
const CROSSFADE_SECONDS = 0.4

interface QaVerdict {
  pass: boolean
  score: number
  issues: string[]
}

/**
 * The director: eight stages in a fixed order, each handed to an agent that works under
 * one skill. Code owns the order and the acceptance checks; models own the judgement.
 */
export async function direct(options: DirectOptions): Promise<DirectResult> {
  const started = Date.now()
  const log = options.log ?? ((line: string) => console.error(line))
  const { planner, reviewer, editor } = endpoints()
  const rules = await loadRules()
  const rejectedAttempts: Record<string, number> = {}

  const agentPrompt = async (role: string, skill: string) =>
    [`You are the ${role} of CineLoom, an advertising studio running on one DGX Spark.`, rules, options.withoutSkills ? '' : `# Skill: ${skill}\n\n${await loadSkill(skill)}`]
      .filter(Boolean)
      .join('\n\n')

  // ---- brief -----------------------------------------------------------------------------
  log('▸ brief        intake agent · nemotron')
  const briefRun = await chatJson<Brief>(
    planner,
    {
      system: await agentPrompt('intake producer', 'ad-brief-intake'),
      thinking: false,
      temperature: 0.3,
      user: `This run is non-interactive: nobody can answer questions, so decide every open point yourself.
Request: ${options.brief}
${options.ratio ? `The user fixed the aspect ratio: ${options.ratio}.` : ''}${options.durationSeconds ? ` The user fixed the duration: ${options.durationSeconds} seconds.` : ''}

Return JSON only:
{"id": "lowercase-dashed-project-id", "title": "short Chinese title", "product": "what is being advertised", "category": "general|food|health_food|cosmetics|medical",
 "audience": "...", "message": "the one thing the viewer should remember, in Chinese", "ratio": "9:16|16:9|1:1", "durationSeconds": 15,
 "tone": "tone and visual style in English", "brandText": "the brand name as it should appear on the product, at most 4 common characters"}`,
    },
    checkBrief,
  )
  const brief = { ...briefRun.value, id: options.id ?? briefRun.value.id }
  rejectedAttempts.brief = briefRun.rejected.length
  await createProject({ id: brief.id, title: brief.title, brief: options.brief, ratio: brief.ratio, durationSeconds: brief.durationSeconds })
  const dir = projectDir(brief.id)
  const record = async (stage: Stage | 'run', agent: string, endpoint: ModelEndpoint | undefined, detail: Record<string, unknown>) =>
    appendFile(
      join(dir, 'reports', 'run.jsonl'),
      `${JSON.stringify({ ts: new Date().toISOString(), stage, agent, model: endpoint?.model, execution: endpoint?.execution ?? 'local-dgx-spark', ...detail })}\n`,
    )
  await writeFile(join(dir, 'brief.json'), JSON.stringify(brief, null, 2))
  await record('brief', 'intake', planner, { seconds: briefRun.seconds, attempts: briefRun.attempts, skills: !options.withoutSkills })

  // ---- script ----------------------------------------------------------------------------
  await setStage(brief.id, 'script', 'running')
  log('▸ script       copywriter agent · nemotron')
  const scriptRun = await chatJson<Script>(
    planner,
    {
      system: await agentPrompt('copywriter', 'ad-script-writing'),
      // Thinking mode spent the whole token budget reasoning about the length limits and returned nothing.
      thinking: false,
      maxTokens: 3000,
      temperature: 0.8,
      user: `Brief:\n${JSON.stringify(brief, null, 2)}\n\nWrite the script. Voiceover ("vo") and on-screen text ("text") are in Chinese; "see" is in English.
Return JSON only: {"structure": "...", "beats": [{"beat": 1, "job": "hook|proof|payoff|cta", "see": "...", "vo": "...", "text": "..."}]}`,
    },
    (script) => checkScript(script, brief),
  )
  let script = scriptRun.value
  rejectedAttempts.script = scriptRun.rejected.length
  await record('script', 'copywriter', planner, { seconds: scriptRun.seconds, attempts: scriptRun.attempts, rejected: scriptRun.rejected })
  await setStage(brief.id, 'script', 'done', `${script.beats.length} beats · ${script.structure}`)

  // ---- compliance: deterministic scan, then an independent reviewer on a different model ----
  await setStage(brief.id, 'compliance', 'running')
  log(`▸ compliance   scan + independent reviewer · ${editor.name}`)
  const reviewRun = await chatJson<{ approve: boolean; issues: string[]; revised?: Array<{ beat: number; vo: string; text: string }> }>(
    editor,
    {
      system: await agentPrompt('compliance reviewer and Chinese copy editor. You did not write this script', 'ad-compliance-review'),
      thinking: false,
      maxTokens: 2000,
      temperature: 0.2,
      user: `Product category: ${brief.category}. Proof points the brand can substantiate: none supplied.
Script copy:\n${script.beats.map((beat) => `Beat ${beat.beat} VO: ${beat.vo}\nBeat ${beat.beat} text: ${beat.text}`).join('\n')}

Judge two things only, briefly: (1) wording a keyword scan would miss - implied superlatives, implied comparison with competitors, effects nobody could prove; (2) Chinese that sounds unnatural when read aloud.
Line lengths are checked elsewhere; do not count characters. Return JSON only:
{"approve": true|false, "issues": ["..."], "revised": [{"beat": 1, "vo": "...", "text": "..."}]}  ("revised" only for lines you would change)`,
    },
    (review) => (typeof review.approve === 'boolean' ? [] : ['"approve" must be true or false']),
    2,
  ).catch((error: Error) => {
    log(`  reviewer unavailable (${error.message.slice(0, 120)}); continuing with the deterministic scan only`)
    return undefined
  })
  if (reviewRun?.value.revised?.length) {
    const revisedBeats = script.beats.map((beat) => {
      const change = reviewRun.value.revised!.find((item) => item.beat === beat.beat)
      return change ? { ...beat, vo: change.vo ?? beat.vo, text: change.text ?? beat.text } : beat
    })
    // The reviewer's edits are accepted only if they still pass every script check.
    if (checkScript({ ...script, beats: revisedBeats }, brief).length === 0) script = { ...script, beats: revisedBeats }
  }
  const copy = script.beats.map((beat) => `${beat.vo}\n${beat.text}`).join('\n')
  const findings = scanCopy(copy, brief.category)
  await writeFile(join(dir, 'script', 'script.json'), JSON.stringify(script, null, 2))
  await writeFile(join(dir, 'script', 'copy.txt'), copy)
  await writeFile(join(dir, 'reports', 'compliance.json'), JSON.stringify({ scan: findings, reviewer: reviewRun?.value ?? null }, null, 2))
  await record('compliance', 'reviewer', editor, { seconds: reviewRun?.seconds ?? 0, approve: reviewRun?.value.approve, issues: reviewRun?.value.issues, scanFindings: findings.length })
  if (findings.some((finding) => finding.severity === 'block')) {
    await setStage(brief.id, 'compliance', 'failed', 'blocked wording remains after review')
    throw new Error(`Compliance blocked the script: ${findings.filter((finding) => finding.severity === 'block').map((finding) => finding.text).join(', ')}`)
  }
  await setStage(brief.id, 'compliance', 'done', `${findings.length} review-level findings`)

  // ---- storyboard ------------------------------------------------------------------------
  await setStage(brief.id, 'storyboard', 'running')
  log('▸ storyboard   storyboard agent · nemotron')
  const storyboardUser = `Brief:\n${JSON.stringify(brief, null, 2)}\n\nApproved script:\n${JSON.stringify(script, null, 2)}

No reference photos exist. Describe the product ONCE in "product": container type, material, colours, and a label that reads "${brief.brandText}" in quotes.
On-screen text is typeset in post-production: never ask for captions or slogans in image_prompt, and put no numbers or lens specs in "style" (they get painted into the picture).
Design around what image and video models do badly: prefer product, liquid, ice, light, macro and hands-free compositions; at most one shot with a person, framed so hands and face are not the subject.
Every shot shows that same product; in image_prompt refer to it as "the product" and do not re-describe it or restate the style - both are appended to every shot automatically.
Return JSON only: {"style": "one style line", "product": "one sentence", "shots": [{"shot": 1, "seconds": 5, "framing": "...", "camera": "one move", "image_prompt": "subject, action, setting, light, framing",
"video_prompt": "what moves, one camera move described like a cinematographer (for example: slow push-in with a subtle breath-like handheld float), what stays still; for product-only shots end with: No people and no hands enter the frame", "on_screen_text": "", "must_show": "something visible"}]}`
  const storyboardRun = await chatJson<Storyboard>(
    planner,
    { system: await agentPrompt('storyboard artist', 'storyboard-design'), thinking: false, maxTokens: 5000, temperature: 0.6, user: storyboardUser },
    (storyboard) => checkStoryboard(storyboard, script),
  )
  const storyboard = storyboardRun.value
  rejectedAttempts.storyboard = storyboardRun.rejected.length
  await writeFile(join(dir, 'storyboard', 'storyboard.json'), JSON.stringify(storyboard, null, 2))
  await record('storyboard', 'storyboard', planner, { seconds: storyboardRun.seconds, attempts: storyboardRun.attempts, rejected: storyboardRun.rejected })
  await setStage(brief.id, 'storyboard', 'done', `${storyboard.shots.length} shots`)

  const result: DirectResult = { projectId: brief.id, dir, rejectedAttempts, qaRegenerations: 0, wallSeconds: 0 }
  if (options.planOnly) {
    result.wallSeconds = (Date.now() - started) / 1000
    return result
  }

  // ---- frames + quality gate -------------------------------------------------------------
  const comfy = new ComfyClient()
  await record('run', 'scheduler', undefined, { memoryBeforeFrames: await memoryStatus() })
  await setStage(brief.id, 'frames', 'running')
  await setStage(brief.id, 'qa', 'running')
  // The hero still: one approved picture of the product that every shot is generated from,
  // so the can in shot 3 is the can in shot 1. A text description alone let it drift.
  await mkdir(join(dir, 'refs'), { recursive: true })
  const heroShot: Shot = { shot: 0, seconds: 0, framing: 'product', camera: 'static', image_prompt: '', video_prompt: '', on_screen_text: '', must_show: `${storyboard.product}; the label must read "${brief.brandText}" cleanly` }
  let hero: { path: string; verdict: QaVerdict } | undefined
  for (let attempt = 0; attempt <= MAX_QA_REGENERATIONS; attempt++) {
    const path = join(dir, 'refs', `product${attempt ? `_r${attempt}` : ''}.png`)
    const image = await generateImage(comfy, { prompt: composeProductPrompt(storyboard), size: '1328x1328', output: path })
    const verdict = await qualityGate(reviewer, path, heroShot)
    log(`▸ product hero ${image.seconds.toFixed(1)}s · gate ${verdict.pass ? 'pass' : 'reject'} ${verdict.score}${verdict.issues.length ? ` · ${verdict.issues[0]}` : ''}`)
    await record('frames', 'product-hero', reviewer, { attempt, imageSeconds: image.seconds, ...verdict })
    if (!hero || verdict.score > hero.verdict.score) hero = { path, verdict }
    if (verdict.pass) break
  }
  await addAsset(brief.id, { id: 'product-hero', kind: 'image', stage: 'frames', path: hero!.path.slice(dir.length + 1), execution: 'local-dgx-spark', model: 'qwen_image_lightning', note: `gate ${hero!.verdict.score}` })

  const frames = new Map<number, string>()
  for (const shot of storyboard.shots) {
    let prompt = composeImagePrompt(shot, storyboard, true)
    let best: { path: string; verdict: QaVerdict } | undefined
    for (let attempt = 0; attempt <= MAX_QA_REGENERATIONS; attempt++) {
      const path = join(dir, 'frames', `shot_${String(shot.shot).padStart(3, '0')}${attempt ? `_r${attempt}` : ''}.png`)
      const image = await generateImage(comfy, { prompt, size: FRAME_SIZE[brief.ratio]!, output: path, references: [hero!.path] })
      const verdict = await qualityGate(reviewer, path, shot, hero!.path)
      log(`▸ frame ${shot.shot}      ${image.seconds.toFixed(1)}s · gate ${verdict.pass ? 'pass' : 'reject'} ${verdict.score}${verdict.issues.length ? ` · ${verdict.issues[0]}` : ''}`)
      await record('qa', 'quality-gate', reviewer, { shot: shot.shot, attempt, imageSeconds: image.seconds, ...verdict })
      if (!best || verdict.score > best.verdict.score) best = { path, verdict }
      if (verdict.pass) break
      if (attempt === MAX_QA_REGENERATIONS) break
      result.qaRegenerations++
      prompt = await repairPrompt(planner, await agentPrompt('storyboard artist', 'shot-quality-gate'), shot, prompt, verdict.issues)
    }
    frames.set(shot.shot, best!.path)
    await addAsset(brief.id, {
      id: `frame-${shot.shot}`, kind: 'image', stage: 'frames', path: best!.path.slice(dir.length + 1), shot: shot.shot,
      execution: 'local-dgx-spark', model: 'qwen_image_edit_lightning', note: `gate ${best!.verdict.score}${best!.verdict.pass ? '' : ' (kept after failed gate)'}`,
    })
  }
  await setStage(brief.id, 'frames', 'done')
  await setStage(brief.id, 'qa', 'done', `${result.qaRegenerations} regenerations`)

  // ---- clips -----------------------------------------------------------------------------
  await setStage(brief.id, 'clips', 'running')
  await record('run', 'scheduler', undefined, { memoryBeforeClips: await memoryStatus() })
  for (const [index, shot] of storyboard.shots.entries()) {
    const output = join(dir, 'clips', `shot_${String(shot.shot).padStart(3, '0')}.mp4`)
    const clip = await generateVideo(comfy, {
      prompt: shot.video_prompt, output, resolution: options.resolution ?? '720p', ratio: brief.ratio, durationSeconds: shot.seconds || 5,
      firstFrame: frames.get(shot.shot), freeAfter: index === storyboard.shots.length - 1, model: options.videoModel ?? 'wan22-14b',
    })
    log(`▸ clip ${shot.shot}       ${clip.seconds.toFixed(1)}s`)
    await record('clips', 'video', undefined, { shot: shot.shot, seconds: clip.seconds })
    await addAsset(brief.id, { id: `clip-${shot.shot}`, kind: 'video', stage: 'clips', path: `clips/shot_${String(shot.shot).padStart(3, '0')}.mp4`, shot: shot.shot, execution: 'local-dgx-spark', model: clip.workflow, seconds: clip.seconds })
  }
  await setStage(brief.id, 'clips', 'done')

  // ---- cut -------------------------------------------------------------------------------
  await setStage(brief.id, 'cut', 'running')
  await mkdir(join(dir, 'cut'), { recursive: true })
  const [width, height] = FINAL_SIZE[brief.ratio]!
  // Titles and subtitles are typeset here in a real font; the image model is never asked to draw them.
  const cues = script.beats.map((beat, index) => ({
    start: clipStart(index, 5, CROSSFADE_SECONDS),
    end: clipStart(index, 5, CROSSFADE_SECONDS) + 5,
    title: beat.text,
    subtitle: beat.vo,
  }))
  const ass = join(dir, 'cut', 'titles.ass')
  await writeFile(ass, buildAss(cues, width, height))
  const finalCut = join(dir, 'cut', 'final.mp4')
  await assembleFilm(storyboard.shots.map((shot) => join(dir, 'clips', `shot_${String(shot.shot).padStart(3, '0')}.mp4`)), finalCut, {
    width, height, fps: 24, clipSeconds: 5, crossfadeSeconds: CROSSFADE_SECONDS, ass, audio: options.audio,
  })
  await addAsset(brief.id, { id: 'final-cut', kind: 'video', stage: 'cut', path: 'cut/final.mp4', execution: 'local-dgx-spark', model: 'ffmpeg' })
  await setStage(brief.id, 'cut', 'done', `${(await probeDuration(finalCut)).toFixed(1)}s`)
  result.finalCut = finalCut
  result.wallSeconds = (Date.now() - started) / 1000
  await record('run', 'director', undefined, { wallSeconds: result.wallSeconds, qaRegenerations: result.qaRegenerations, rejectedAttempts, memoryAtEnd: await memoryStatus() })
  log(`▸ cut          ${finalCut}`)
  return result
}

async function qualityGate(reviewer: ModelEndpoint, frame: string, shot: Shot, productReference?: string): Promise<QaVerdict> {
  const run = await chatJson<QaVerdict>(
    reviewer,
    {
      system: 'You are the quality gate of an advertising studio. You did not write the prompt. Judge only what is visible, and be strict: a flawed frame costs six minutes of video generation.',
      images: productReference ? [frame, productReference] : [frame],
      maxTokens: 3000,
      temperature: 0,
      user: `Image 1 is the generated frame.${productReference ? ' Image 2 is the approved product reference.' : ''}
The frame must show: ${shot.must_show}
Reject (pass=false) if ANY of these is true:
- the required content is missing;
${productReference ? '- the product in image 1 differs from image 2 in container type, colours or label;\n' : ''}- there is ANY text outside the product label: captions, slogans, subtitles, numbers, lens specs, watermarks;
- any lettering is garbled, duplicated or nonsensical;
- extra limbs, malformed hands or a distorted face;
- the product is cropped, floating or physically implausible.
Reply with JSON only: {"pass": boolean, "score": 0-100, "issues": ["short issue"]}. Pass requires score >= 80 and none of the reject conditions.`,
    },
    (verdict) => (typeof verdict.pass === 'boolean' && typeof verdict.score === 'number' ? [] : ['need boolean "pass" and numeric "score"']),
    2,
  )
  const issues = Array.isArray(run.value.issues) ? run.value.issues : []
  return { pass: run.value.pass && run.value.score >= 80, score: run.value.score, issues }
}

async function repairPrompt(planner: ModelEndpoint, system: string, shot: Shot, prompt: string, issues: string[]): Promise<string> {
  const run = await chatJson<{ image_prompt: string }>(
    planner,
    {
      system,
      thinking: false,
      temperature: 0.4,
      user: `The quality gate rejected shot ${shot.shot}.\nIssues: ${issues.join('; ') || 'required content missing'}\nMust show: ${shot.must_show}\nCurrent prompt: ${prompt}
Change the prompt according to the issue type; do not resubmit it unchanged. Rewrite only the scene description at the start. Keep every sentence from "Image 1 is the product" or "The product:" onward exactly as it is. Keep it in English.
Return JSON only: {"image_prompt": "..."}`,
    },
    (value) => (value.image_prompt?.trim() ? [] : ['image_prompt is empty']),
    2,
  )
  return run.value.image_prompt
}

function srtTime(seconds: number): string {
  const ms = Math.round(seconds * 1000)
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
}
