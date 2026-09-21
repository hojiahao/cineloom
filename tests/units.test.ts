import { describe, expect, it } from 'vitest'
import { renderWorkflow } from '../src/comfy/workflow.js'
import { parseArgs } from '../src/lib/args.js'
import { scanCopy } from '../src/lib/compliance.js'
import { nativeSize, videoSize } from '../src/lib/media.js'
import { parseMeminfo, planMemory } from '../src/lib/memory.js'
import { buildShots } from '../src/lib/shots.js'
import { extractJson } from '../src/lib/vision.js'

describe('compliance scan', () => {
  it('blocks absolute terms and guarantees, and does not double count "100%"', () => {
    const findings = scanCopy('全网第一的气泡水，100%天然，喝了永不发胖。', 'food')
    expect(findings.map((finding) => finding.text)).toEqual(['全网第一', '100%', '永不'])
    expect(findings.every((finding) => finding.severity === 'block')).toBe(true)
  })
  it('applies medical wording rules to cosmetics but not to medical ads', () => {
    expect(scanCopy('医学级修复', 'cosmetics').map((finding) => finding.rule)).toContain('medical_claim')
    expect(scanCopy('医学级修复', 'medical')).toEqual([])
  })
  it('flags efficacy and data claims for review, with line numbers', () => {
    const findings = scanCopy('清爽上市\n美白祛斑，好评率98%', 'cosmetics')
    expect(findings.every((finding) => finding.severity === 'review' && finding.line === 2)).toBe(true)
    expect(findings.map((finding) => finding.text)).toEqual(['美白', '祛斑', '好评率', '98%'])
  })
  it('passes clean copy', () => expect(scanCopy('清爽气泡，0糖0脂，夏日畅饮。', 'food')).toEqual([]))
})

describe('shots', () => {
  it('merges cuts closer than the minimum shot length', () => {
    expect(buildShots([2, 2.1, 5], 6.5, 0.4)).toEqual([[0, 2], [2, 5], [5, 6.5]])
    expect(buildShots([], 3, 0.4)).toEqual([[0, 3]])
    expect(buildShots([2.9], 3, 0.4)).toEqual([[0, 3]])
  })
})

describe('media sizing', () => {
  it('keeps aspect, stays in the native budget and aligns to 16', () => {
    const [width, height] = nativeSize(2160, 3840)
    expect(width * height).toBeLessThanOrEqual(1328 * 1328)
    expect(width % 16).toBe(0)
    expect(height % 16).toBe(0)
    expect(Math.abs(width / height - 9 / 16)).toBeLessThan(0.02)
    expect(nativeSize(1024, 1024)).toEqual([1024, 1024])
  })
  it('maps resolution and ratio to Wan sizes', () => {
    expect(videoSize('720p', '9:16')).toEqual([704, 1280])
    expect(() => videoSize('4k', '16:9')).toThrow(/Unsupported/)
  })
})

describe('workflow rendering', () => {
  it('keeps numeric types for whole placeholders and drops comments', () => {
    const graph = renderWorkflow({ _comment: 'x', '1': { class_type: 'A', inputs: { width: '{{width}}', text: 'say {{prompt}}!' } } }, { width: 512, prompt: '你好' })
    expect(graph).toEqual({ '1': { class_type: 'A', inputs: { width: 512, text: 'say 你好!' } } })
  })
  it('fails loudly on a missing value', () => expect(() => renderWorkflow({ a: '{{nope}}' }, {})).toThrow(/nope/))
})

describe('memory', () => {
  const status = parseMeminfo('MemTotal:       127600000 kB\nMemAvailable:   114300000 kB\nSwapTotal:  8000000 kB\nSwapFree:  8000000 kB\n')
  it('parses /proc/meminfo into GiB', () => expect(status).toEqual({ totalGb: 121.7, availableGb: 109, swapUsedGb: 0 }))
  it('checks a plan against the budget', () => {
    expect(planMemory(status, { nemotron: 30, stepvl: 20, comfyui: 45 }, 10, 'total')).toMatchObject({ fits: true, headroomGb: 16.7 })
    expect(planMemory(status, { step37: 116 }, 10, 'total').fits).toBe(false)
  })
})

describe('helpers', () => {
  it('parses flags, repeats and switches', () => {
    const args = parseArgs(['init', '--id', 'a', '--ref=x.png', '--ref', 'y.png', '--keep-loaded'])
    expect(args.positionals).toEqual(['init'])
    expect(args.flags.get('ref')).toEqual(['x.png', 'y.png'])
    expect(args.flags.get('keep-loaded')).toEqual(['true'])
  })
  it('extracts JSON from a fenced model reply', () => {
    expect(extractJson('好的：\n```json\n{"pass": false, "score": 40, "issues": ["logo warped"]}\n```')).toEqual({ pass: false, score: 40, issues: ['logo warped'] })
  })
})

import { checkScript, checkStoryboard, spokenLength, type Brief, type Script } from '../src/agent/checks.js'

describe('skill checks (shared by the director and the evals)', () => {
  const brief = { id: 'soda', title: '气泡水', product: 'sparkling water', category: 'food', audience: 'students', message: '0糖也有爽感', ratio: '9:16', durationSeconds: 15, tone: 'fresh', brandText: '冷' } as Brief
  const beat = (n: number, vo: string, text = '') => ({ beat: n, job: 'hook', see: 'a can on ice', vo, text })
  const good: Script = { structure: 'sensory close-ups -> reveal', beats: [beat(1, '冰块碰撞，夏天就此开罐'), beat(2, '零糖零脂，气泡却更足'), beat(3, '先冷一下，我们再出发', '冷一下')] }

  it('accepts a script that follows the skill', () => expect(checkScript(good, brief)).toEqual([]))
  it('counts spoken characters without punctuation', () => expect(spokenLength('冰块碰撞，夏天开罐！')).toBe(8))
  it('rejects the wrong beat count, long voiceover and restricted wording', () => {
    const problems = checkScript({ structure: 'x', beats: [beat(1, '这是一句明显超过十八个字的口播文案它真的太长了读不完'), beat(2, '全网第一的气泡水')] }, brief)
    expect(problems.some((problem) => problem.includes('exactly 3 beats'))).toBe(true)
    expect(problems.some((problem) => problem.includes('at most 18'))).toBe(true)
    expect(problems.some((problem) => problem.includes('全网第一'))).toBe(true)
  })
  it('requires the style line verbatim, English prompts and one camera move', () => {
    const style = 'soft morning light, 50mm'
    const shot = { shot: 1, seconds: 5, framing: 'close-up', camera: 'slow push-in', image_prompt: `A can labelled "冷" on ice, ${style}`, video_prompt: 'Slow push-in.', on_screen_text: '', must_show: 'the can' }
    const script3 = { ...good, beats: [good.beats[0]!] }
    expect(checkStoryboard({ style, product: 'a slim aluminium can with a teal band that reads "冷"', shots: [shot] }, script3)).toEqual([])
    const bad = { ...shot, camera: 'push-in, then pan', image_prompt: '一罐气泡水' }
    const problems = checkStoryboard({ style, product: 'a can', shots: [bad] }, script3)
    expect(problems).toHaveLength(2)
  })
})

import { composeImagePrompt, composeProductPrompt, sanitizeStyle } from '../src/agent/checks.js'
import { clipStart, filmLength } from '../src/lib/ffmpeg.js'
import { buildAss } from '../src/lib/titles.js'

describe('prompt composition and finishing', () => {
  const storyboard = { style: 'soft morning light, 50mm, f/2.8, shallow depth of field, 4k', product: 'a slim silver can whose label reads "冷".', shots: [] }
  const shot = { shot: 1, seconds: 5, framing: 'macro', camera: 'slow push-in', image_prompt: 'Macro of the product on crushed ice.', video_prompt: 'x', on_screen_text: '', must_show: 'the can' }

  it('strips lens specs that the image model would paint as text', () => {
    expect(sanitizeStyle(storyboard.style)).toBe('soft morning light, shallow depth of field')
  })
  it('anchors reference shots to image 1 and always forbids stray text', () => {
    const anchored = composeImagePrompt(shot, storyboard, true)
    expect(anchored).toContain('exactly as in image 1')
    expect(anchored).not.toContain('50mm')
    expect(anchored).toMatch(/no lettering anywhere except the label/)
    expect(composeImagePrompt(shot, storyboard)).toContain('The product: a slim silver can')
    expect(composeProductPrompt(storyboard)).toMatch(/^Studio product photograph of a slim silver can/)
  })
  it('places clips and titles on the crossfaded timeline', () => {
    expect(clipStart(2, [5, 5, 5, 3], 0.4)).toBeCloseTo(9.2)
    expect(filmLength([5, 5, 5, 3], 0.4)).toBeCloseTo(16.8)
    const ass = buildAss([{ start: 4.6, end: 9.6, title: '0糖', subtitle: '气泡更足{\\b1}' }], 1080, 1920)
    expect(ass).toContain('PlayResY: 1920')
    expect(ass).toMatch(/Dialogue: 1,0:00:05\.10,0:00:09\.20,Title/)
    expect(ass).toContain('气泡更足b1') // override tags from model text are neutralised
  })
})

import { captionProblems } from '../src/agent/checks.js'

describe('captions', () => {
  it('accepts ordinary Chinese ad copy', () => {
    expect(captionProblems('vo', '第一口下去，冰凉满口', false)).toEqual([])
    expect(captionProblems('title', '0糖', true)).toEqual([])
  })
  it('rejects emoji, replacement characters, doubled or half-width punctuation and a title ending in a full stop', () => {
    expect(captionProblems('vo', '清爽一夏🥤', false)[0]).toMatch(/must not appear on screen/)
    expect(captionProblems('vo', '清爽�一夏', false)).toHaveLength(1)
    expect(captionProblems('vo', '太爽了！！', false)[0]).toMatch(/repeated or half-width/)
    expect(captionProblems('vo', '清爽,一夏', false)[0]).toMatch(/must not appear|half-width/)
    expect(captionProblems('title', '清爽。', true)[0]).toMatch(/no closing punctuation/)
  })
})
