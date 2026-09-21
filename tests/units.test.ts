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
