import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { memoryStatus } from '../lib/memory.js'
import { loadProject, projectsRoot } from '../lib/project.js'

const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public')
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4', '.md': 'text/markdown; charset=utf-8', '.srt': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
}

/** Read-only board over the projects folder: pipeline stages, assets, memory. The agent writes, the studio shows. */
export async function startStudio(port: number, host: string): Promise<void> {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://studio')
      const send = (status: number, body: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(body))
      }
      if (url.pathname === '/api/projects') {
        const ids = await readdir(projectsRoot()).catch(() => [])
        const states = await Promise.all(ids.map((id) => loadProject(id).catch(() => undefined)))
        return send(200, states.filter(Boolean).sort((a, b) => b!.updatedAt.localeCompare(a!.updatedAt)))
      }
      if (url.pathname === '/api/memory') return send(200, await memoryStatus())

      const isFile = url.pathname.startsWith('/files/')
      const root = isFile ? projectsRoot() : PUBLIC_DIR
      const requested = isFile ? decodeURIComponent(url.pathname.slice('/files/'.length)) : url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      const path = resolve(root, normalize(requested))
      if (path !== root && !path.startsWith(root + sep)) return send(403, { error: 'forbidden' })
      const info = await stat(path).catch(() => undefined)
      if (!info?.isFile()) return send(404, { error: 'not found' })
      response.writeHead(200, { 'content-type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream', 'content-length': info.size })
      createReadStream(path).pipe(response)
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: (error as Error).message }))
    }
  })
  await new Promise<void>((done) => server.listen(port, host, done))
  console.log(`CineLoom studio: http://${host}:${port}`)
}

