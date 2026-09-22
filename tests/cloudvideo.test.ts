import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateCloudVideo } from '../src/lib/cloudvideo.js'

/** The Ark task protocol against a fake server: create, poll until succeeded, download. */
describe('cloud video route', () => {
  it('submits the first frame, polls the task and saves the video; labels nothing local', async () => {
    const seen: Record<string, unknown> = {}
    let polls = 0
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(chunk))
      request.on('end', () => {
        const url = request.url ?? ''
        if (request.method === 'POST' && url === '/api/v3/contents/generations/tasks') {
          seen.auth = request.headers.authorization
          seen.body = JSON.parse(Buffer.concat(chunks).toString())
          response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ id: 'cgt-1' })); return
        }
        if (url === '/api/v3/contents/generations/tasks/cgt-1') {
          polls++
          const done = polls >= 2
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify(done ? { id: 'cgt-1', status: 'succeeded', content: { video_url: `http://127.0.0.1:${(server.address() as { port: number }).port}/video.mp4` } } : { id: 'cgt-1', status: 'running' })); return
        }
        if (url === '/video.mp4') { response.writeHead(200); response.end(Buffer.from('fake-mp4')); return }
        response.writeHead(404); response.end()
      })
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v3/contents/generations/tasks`
    const dir = mkdtempSync(join(tmpdir(), 'cloudvideo-'))
    writeFileSync(join(dir, 'frame.png'), 'png-bytes')
    const result = await generateCloudVideo({ apiKey: 'k', endpoint: base, model: 'seedance-test' }, { prompt: 'slow push-in', firstFrame: join(dir, 'frame.png'), output: join(dir, 'out.mp4'), ratio: '9:16', resolution: '720p', durationSeconds: 5 }, 10)
    server.close()
    expect(result.taskId).toBe('cgt-1')
    expect(seen.auth).toBe('Bearer k')
    const body = seen.body as { model: string; content: Array<{ type: string; role?: string }>; duration: number; generate_audio: boolean }
    expect(body.model).toBe('seedance-test')
    expect(body.content[0]!.type).toBe('text')
    expect(body.content[1]).toMatchObject({ type: 'image_url', role: 'first_frame' })
    expect(body.duration).toBe(5)
    expect(readFileSync(join(dir, 'out.mp4'), 'utf8')).toBe('fake-mp4')
  })
  it('refuses to run without a key', async () => {
    delete process.env.ARK_API_KEY
    const { generateVideo } = await import('../src/lib/media.js')
    await expect(generateVideo({} as never, { prompt: 'x', output: '/tmp/x.mp4', resolution: '720p', ratio: '9:16', durationSeconds: 5, firstFrame: 'f.png', model: 'seedance' })).rejects.toThrow(/ARK_API_KEY/)
  })
})
