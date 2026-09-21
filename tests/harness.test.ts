import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeComfy } from './fake-comfy.js'

/**
 * The harness end to end against a scripted model server and a fake ComfyUI: stage order,
 * a rejected script being rewritten, a rejected frame being regenerated, the end card and
 * the final cut. ffmpeg is real. Voice and music are skipped (silent) so no model is needed.
 */

const STYLE = 'cool backlit morning light, pastel teal and coral, fine film grain'
const replies = {
  brief: { id: 'model-chose-this', title: '冷·气泡水', product: 'sugar-free sparkling water', category: 'food', audience: '大学生', message: '清爽一夏', ratio: '9:16', durationSeconds: 10, tone: 'fresh, cinematic', brandText: '冷' },
  badScript: { structure: 'sensory -> reveal', beats: [{ beat: 1, job: 'hook', see: 'ice', vo: '全网第一的气泡水来了', text: '第一' }, { beat: 2, job: 'payoff', see: 'can', vo: '冷', text: '冷' }] },
  script: { structure: 'sensory -> reveal', beats: [{ beat: 1, job: 'hook', see: 'ice cracking', vo: '冰块轻响，夏天开罐', text: '开罐' }, { beat: 2, job: 'payoff', see: 'the can', vo: '零糖气泡，清爽入口', text: '零糖' }] },
  review: { approve: true, issues: [] },
  storyboard: {
    style: STYLE, product: 'a slim silver aluminium can with a teal band that reads "冷"',
    shots: [1, 2].map((shot) => ({ shot, seconds: 5, framing: shot === 1 ? 'macro' : 'medium', camera: 'slow push-in', image_prompt: `Shot ${shot}: the product on crushed ice, backlit mist`, video_prompt: 'Slow push-in. Mist drifts. No people and no hands enter the frame.', on_screen_text: '', must_show: 'the can upright with its label readable' })),
  },
}

let llm: Server
let llmUrl = ''
let comfy: Awaited<ReturnType<typeof startFakeComfy>>
const seen: string[] = []
let scriptCalls = 0
let gateCalls = 0

beforeAll(async () => {
  comfy = await startFakeComfy()
  llm = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString())
      const system: string = body.messages[0].content
      const user = body.messages[1].content
      const hasImage = Array.isArray(user)
      let reply: unknown
      if (hasImage) {
        seen.push('gate')
        gateCalls++
        // Reject the very first storyboard frame once, to exercise the regeneration loop.
        reply = gateCalls === 2 ? { pass: false, score: 40, issues: ['a hand appears although the shot does not call for one'] } : { pass: true, score: 92, issues: [] }
      } else if (system.includes('intake producer')) { seen.push('brief'); reply = replies.brief }
      else if (system.includes('compliance reviewer')) { seen.push('review'); reply = replies.review }
      else if (system.includes('copywriter')) { seen.push('script'); reply = ++scriptCalls === 1 ? replies.badScript : replies.script }
      else if (String(user).includes('quality gate rejected')) { seen.push('repair'); reply = { image_prompt: 'Product-only macro of the product on crushed ice' } }
      else { seen.push('storyboard'); reply = replies.storyboard }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }], usage: { completion_tokens: 10 } }))
    })
  })
  await new Promise<void>((done) => llm.listen(0, '127.0.0.1', done))
  llmUrl = `http://127.0.0.1:${(llm.address() as { port: number }).port}/v1`
})
afterAll(() => { llm.close(); comfy.close() })

describe('CineLoom Harness', () => {
  it('takes a brief to a finished film, rewriting a bad script and regenerating a rejected frame', async () => {
    const projects = mkdtempSync(join(tmpdir(), 'cineloom-harness-'))
    Object.assign(process.env, { CINELOOM_PROJECTS: projects, COMFYUI_URL: comfy.url, CINELOOM_PLANNER_URL: llmUrl, CINELOOM_VISION_URL: llmUrl })
    delete process.env.STEPFUN_API_KEY
    const { runHarness } = await import('../src/agent/harness.js')
    const log: string[] = []
    const result = await runHarness({ brief: '给“冷”气泡水做一条 10 秒竖版广告', id: 'soda-test', silent: true, candidates: 1, log: (line) => log.push(line) })

    // Stage order, and the first script (absolute claim, 1-character voiceover) was sent back.
    expect(seen.filter((name) => name !== 'gate' && name !== 'repair')).toEqual(['brief', 'script', 'script', 'review', 'storyboard'])
    expect(result.rejectedAttempts.script).toBe(1)
    expect(readFileSync(join(projects, 'soda-test', 'script', 'copy.txt'), 'utf8')).not.toContain('全网第一')

    // Gate: hero passes, shot 1 is rejected once and repaired, shot 2 passes.
    expect(seen.filter((name) => name === 'repair')).toHaveLength(1)
    expect(result.qaRegenerations).toBe(1)

    // The hero still is generated first without references; every frame after it is anchored to it.
    const graphs = comfy.graphs
    expect(graphs[0]!['6'].class_type).toBe('CLIPTextEncode')
    expect(graphs[0]!['6'].inputs.text).toMatch(/^Studio product photograph of a slim silver aluminium can/)
    expect(graphs[1]!['6'].class_type).toBe('TextEncodeQwenImageEditPlus')
    expect(graphs[1]!['6'].inputs.prompt).toContain('exactly as in image 1')
    expect(graphs[1]!['6'].inputs.prompt).toContain(STYLE)
    // Clips come from the 14B image-to-video graph, one per shot, and memory is released between phases.
    expect(graphs.filter((graph) => Object.values(graph).some((node: any) => node.class_type === 'WanImageToVideo'))).toHaveLength(2)
    expect(comfy.freed()).toBeGreaterThanOrEqual(3)

    // Final cut: two 5 s shots plus a 3 s end card, crossfaded, with typeset titles.
    expect(existsSync(result.finalCut!)).toBe(true)
    const ass = readFileSync(join(projects, 'soda-test', 'cut', 'titles.ass'), 'utf8')
    expect(ass).toContain('开罐')
    expect(ass).toMatch(/Closing,,0,0,0,,.*清爽一夏/)
    const state = JSON.parse(readFileSync(join(projects, 'soda-test', 'state.json'), 'utf8'))
    expect(Object.values(state.stages).every((stage: any) => stage.status === 'done')).toBe(true)
    expect(state.assets.map((asset: any) => asset.id).sort()).toEqual(['clip-1', 'clip-2', 'final-cut', 'frame-1', 'frame-2', 'product-hero'])
  })
})
