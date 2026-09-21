import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { ComfyClient } from '../comfy/client.js'
import { loadWorkflow } from '../comfy/workflow.js'
import { flag, numberFlag, requireFlag, UsageError, type ParsedArgs } from '../lib/args.js'
import { CATEGORIES, scanCopy, type Category } from '../lib/compliance.js'
import { assembleCut, detectCuts, extractFrame, probeDuration } from '../lib/ffmpeg.js'
import { generateImage, generateVideo, videoSize } from '../lib/media.js'
import { memoryStatus, planMemory } from '../lib/memory.js'
import { addAsset, createProject, loadProject, projectDir, setStage, STAGES, type Stage, type StageStatus } from '../lib/project.js'
import { buildShots } from '../lib/shots.js'
import { askVision, extractJson } from '../lib/vision.js'
import { direct } from '../agent/director.js'
import { startStudio } from '../studio/server.js'

export type Command = (args: ParsedArgs) => Promise<number>

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2))

/** Asset paths are stored relative to the project so a project folder stays portable. */
const projectRelative = (id: string, path: string) => relative(projectDir(id), resolve(path))

async function project(args: ParsedArgs): Promise<number> {
  const action = args.positionals[0]
  if (action === 'init') {
    const state = await createProject({
      id: requireFlag(args, 'id'),
      title: flag(args, 'title') ?? requireFlag(args, 'id'),
      brief: requireFlag(args, 'brief'),
      ratio: flag(args, 'ratio', '9:16')!,
      durationSeconds: numberFlag(args, 'duration', 15),
    })
    print({ project: state.id, dir: projectDir(state.id) })
    return 0
  }
  if (action === 'status') {
    print(await loadProject(requireFlag(args, 'id')))
    return 0
  }
  if (action === 'stage') {
    const stage = requireFlag(args, 'stage') as Stage
    const status = requireFlag(args, 'status') as StageStatus
    if (!STAGES.includes(stage)) throw new UsageError(`--stage must be one of ${STAGES.join(', ')}`)
    if (!['pending', 'running', 'done', 'failed'].includes(status)) throw new UsageError('--status must be pending, running, done or failed')
    print((await setStage(requireFlag(args, 'id'), stage, status, flag(args, 'note'))).stages)
    return 0
  }
  throw new UsageError('usage: cineloom project <init|status|stage> ...')
}

async function image(args: ParsedArgs): Promise<number> {
  const id = flag(args, 'project')
  const shot = flag(args, 'shot')
  const output = resolve(flag(args, 'out') ?? join(projectDir(requireFlag(args, 'project')), 'frames', `shot_${String(shot ?? 'x').padStart(3, '0')}.png`))
  const result = await generateImage(new ComfyClient(), {
    prompt: requireFlag(args, 'prompt'),
    size: flag(args, 'size', '1328x1328')!,
    output,
    references: args.flags.get('ref'),
    seed: flag(args, 'seed') ? numberFlag(args, 'seed', 0) : undefined,
  })
  if (id) {
    await addAsset(id, {
      id: `frame-${shot ?? Date.now()}`, kind: 'image', stage: 'frames', path: projectRelative(id, output),
      shot: shot ? Number(shot) : undefined, execution: 'local-dgx-spark', model: result.workflow, seconds: result.seconds,
    })
  }
  print(result)
  return 0
}

async function video(args: ParsedArgs): Promise<number> {
  const id = flag(args, 'project')
  const shot = flag(args, 'shot')
  const output = resolve(flag(args, 'out') ?? join(projectDir(requireFlag(args, 'project')), 'clips', `shot_${String(shot ?? 'x').padStart(3, '0')}.mp4`))
  const result = await generateVideo(new ComfyClient(), {
    prompt: requireFlag(args, 'prompt'),
    output,
    resolution: flag(args, 'resolution', '720p')!,
    ratio: flag(args, 'ratio', '9:16')!,
    durationSeconds: numberFlag(args, 'duration', 5),
    firstFrame: flag(args, 'first-frame'),
    freeAfter: flag(args, 'keep-loaded') !== 'true',
    model: flag(args, 'model') as never,
  })
  if (id) {
    await addAsset(id, {
      id: `clip-${shot ?? Date.now()}`, kind: 'video', stage: 'clips', path: projectRelative(id, output),
      shot: shot ? Number(shot) : undefined, execution: 'local-dgx-spark', model: result.workflow, seconds: result.seconds,
    })
  }
  print(result)
  return 0
}

async function copyCheck(args: ParsedArgs): Promise<number> {
  const source = args.positionals[0]
  if (!source) throw new UsageError('usage: cineloom copy-check <file|-> [--category general|food|health_food|cosmetics|medical]')
  const category = flag(args, 'category', 'general') as Category
  if (!CATEGORIES.includes(category)) throw new UsageError(`--category must be one of ${CATEGORIES.join(', ')}`)
  const copy = source === '-' ? await new Response(process.stdin as never).text() : await readFile(source, 'utf8')
  const findings = scanCopy(copy, category)
  print({ verdict: findings.length === 0 ? 'pass' : 'needs_changes', category, findings })
  return findings.some((finding) => finding.severity === 'block') ? 1 : 0
}

async function shots(args: ParsedArgs): Promise<number> {
  const source = args.positionals[0]
  if (!source) throw new UsageError('usage: cineloom shots <video> [--out dir] [--threshold 0.30] [--min-shot 0.4]')
  const out = resolve(flag(args, 'out', 'breakdown')!)
  await mkdir(out, { recursive: true })
  const duration = await probeDuration(source)
  const ranges = buildShots(await detectCuts(source, numberFlag(args, 'threshold', 0.3)), duration, numberFlag(args, 'min-shot', 0.4))
  const list = []
  for (const [index, [start, end]] of ranges.entries()) {
    const keyframe = `shot_${String(index + 1).padStart(3, '0')}.jpg`
    // Mid-shot avoids transition frames at either edge.
    await extractFrame(source, (start + end) / 2, join(out, keyframe))
    list.push({ index: index + 1, start: round(start), end: round(end), duration: round(end - start), keyframe })
  }
  const manifest = { source: { file: source, duration: round(duration), shotCount: list.length, avgShotSeconds: round(duration / list.length) }, shots: list }
  await writeFile(join(out, 'shots.json'), JSON.stringify(manifest, null, 2))
  print(manifest.source)
  return 0
}

const round = (value: number) => Math.round(value * 1000) / 1000

async function mem(args: ParsedArgs): Promise<number> {
  const action = args.positionals[0] ?? 'status'
  const status = await memoryStatus()
  if (action === 'status') {
    print(status)
    return 0
  }
  if (action === 'plan') {
    const needs = Object.fromEntries((args.flags.get('need') ?? []).map((item) => {
      const [name, gb] = item.split('=')
      return [name!, Number(gb)]
    }))
    const plan = planMemory(status, needs, numberFlag(args, 'reserve', 10), flag(args, 'against', 'total') as 'total' | 'available')
    print(plan)
    return plan.fits ? 0 : 1
  }
  if (action === 'free') {
    await new ComfyClient().free()
    print({ availableBeforeGb: status.availableGb, availableAfterGb: (await memoryStatus()).availableGb })
    return 0
  }
  throw new UsageError('usage: cineloom mem <status|plan|free> [--need name=GB ...] [--reserve 10] [--against total|available]')
}

interface QaVerdict {
  pass: boolean
  score: number
  issues: string[]
}

async function qa(args: ParsedArgs): Promise<number> {
  const frame = requireFlag(args, 'frame')
  const references = args.flags.get('ref') ?? []
  const brief = flag(args, 'expect', '')
  const question = [
    'You are the quality gate of an advertising studio. The FIRST image is a generated shot.',
    references.length > 0 ? `The other ${references.length} image(s) are approved references (product, character or scene).` : '',
    brief ? `The shot must show: ${brief}` : '',
    'Check: product shape, colour, label and logo match the references; no warped text; no extra limbs or fingers; the requested content is present.',
    'Reply with JSON only: {"pass": boolean, "score": 0-100, "issues": ["short issue", ...]}. Pass requires score >= 75 and no product mismatch.',
  ].filter(Boolean).join('\n')
  const verdict = extractJson<QaVerdict>(await askVision(question, [frame, ...references]))
  const id = flag(args, 'project')
  if (id) {
    const report = join(projectDir(id), 'reports', `qa_${flag(args, 'shot', 'x')}.json`)
    await writeFile(report, JSON.stringify({ frame, references, verdict }, null, 2))
  }
  print(verdict)
  return verdict.pass ? 0 : 1
}

async function cut(args: ParsedArgs): Promise<number> {
  const id = requireFlag(args, 'project')
  const state = await loadProject(id)
  const clips = state.assets.filter((asset) => asset.kind === 'video' && asset.stage === 'clips').sort((a, b) => (a.shot ?? 0) - (b.shot ?? 0))
  if (clips.length === 0) throw new Error('No clips in this project yet.')
  const [width, height] = videoSize(flag(args, 'resolution', '720p')!, state.ratio)
  const output = join(projectDir(id), 'cut', 'final.mp4')
  await assembleCut(clips.map((clip) => join(projectDir(id), clip.path)), output, {
    width, height, fps: 24, audio: flag(args, 'audio'), audioGainDb: numberFlag(args, 'audio-gain', -10), subtitles: flag(args, 'subtitles'),
  })
  await addAsset(id, { id: 'final-cut', kind: 'video', stage: 'cut', path: 'cut/final.mp4', execution: 'local-dgx-spark', model: 'ffmpeg' })
  await setStage(id, 'cut', 'done')
  print({ output, clips: clips.length, duration: round(await probeDuration(output)) })
  return 0
}

/** Compare every workflow template with the running ComfyUI: unknown nodes, unknown inputs, missing model files. */
async function doctor(): Promise<number> {
  const info = await new ComfyClient().objectInfo()
  const problems: string[] = []
  for (const name of ['qwen_image_lightning', 'qwen_image_edit_lightning', 'wan22_ti2v_5b_t2v', 'wan22_ti2v_5b_i2v', 'wan22_i2v_14b_4step']) {
    const graph = (await loadWorkflow(name)) as Record<string, { class_type: string; inputs: Record<string, unknown> }>
    for (const [nodeId, node] of Object.entries(graph)) {
      if (nodeId.startsWith('_')) continue
      const spec = info[node.class_type]
      if (!spec) {
        problems.push(`${name} node ${nodeId}: unknown class ${node.class_type}`)
        continue
      }
      const declared = { ...spec.input.required, ...spec.input.optional }
      for (const [input, value] of Object.entries(node.inputs)) {
        if (!(input in declared)) problems.push(`${name} node ${nodeId}: ${node.class_type} has no input "${input}"`)
        else if (/_name$/.test(input) && Array.isArray(declared[input]?.[0]) && !(declared[input]![0] as unknown[]).includes(value)) {
          problems.push(`${name} node ${nodeId}: model file not installed: ${String(value)}`)
        }
      }
    }
  }
  print({ ok: problems.length === 0, problems })
  return problems.length === 0 ? 0 : 1
}

async function studio(args: ParsedArgs): Promise<number> {
  await startStudio(numberFlag(args, 'port', 3090), flag(args, 'host', '127.0.0.1')!)
  return new Promise(() => {})
}

/** Brief in, finished film out: the director runs every stage with its agents and skills. */
async function directCommand(args: ParsedArgs): Promise<number> {
  const brief = args.positionals.join(' ').trim()
  if (!brief) throw new UsageError('usage: cineloom direct "<brief>" [--id id] [--ratio 9:16] [--duration 15] [--plan-only] [--without-skills]')
  const result = await direct({
    brief,
    id: flag(args, 'id'),
    ratio: flag(args, 'ratio'),
    durationSeconds: flag(args, 'duration') ? numberFlag(args, 'duration', 15) : undefined,
    planOnly: flag(args, 'plan-only') === 'true',
    withoutSkills: flag(args, 'without-skills') === 'true',
    resolution: flag(args, 'resolution'),
    videoModel: flag(args, 'video-model') as never,
    audio: flag(args, 'audio'),
  })
  print(result)
  return 0
}

export const COMMANDS: Record<string, Command> = { direct: directCommand, project, image, video, 'copy-check': copyCheck, shots, mem, qa, cut, doctor, studio }
