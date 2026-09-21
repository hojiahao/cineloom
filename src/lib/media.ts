import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ComfyClient } from '../comfy/client.js'
import { loadWorkflow, renderWorkflow } from '../comfy/workflow.js'
import { concatCopy, extractLastFrame, scaleImage } from './ffmpeg.js'

export const IMAGE_NATIVE_MAX_PIXELS = Number(process.env.CINELOOM_IMAGE_NATIVE_MAX_PIXELS ?? 1328 * 1328)
export const VIDEO_FPS = 24
export const VIDEO_SEGMENT_SECONDS = 5

const VIDEO_SIZES: Record<string, [number, number]> = {
  '480p/16:9': [832, 480],
  '480p/9:16': [480, 832],
  '480p/1:1': [624, 624],
  '720p/16:9': [1280, 704],
  '720p/9:16': [704, 1280],
  '720p/1:1': [960, 960],
}

export interface MediaResult {
  path: string
  workflow: string
  seconds: number
  width: number
  height: number
  detail: Record<string, unknown>
}

export function parseSize(size: string): [number, number] {
  const match = /^(\d+)x(\d+)$/i.exec(size)
  if (!match) throw new Error(`Unsupported size ${JSON.stringify(size)}; use WIDTHxHEIGHT.`)
  return [Number(match[1]), Number(match[2])]
}

/** Largest 16-aligned size with the requested aspect that stays inside the native pixel budget. */
export function nativeSize(width: number, height: number, maxPixels = IMAGE_NATIVE_MAX_PIXELS): [number, number] {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)))
  const align = (value: number) => Math.max(256, Math.floor((value * scale) / 16) * 16)
  return [align(width), align(height)]
}

export function videoSize(resolution: string, ratio: string): [number, number] {
  const size = VIDEO_SIZES[`${resolution}/${ratio}`]
  if (!size) throw new Error(`Unsupported video format ${resolution} ${ratio}; supported: ${Object.keys(VIDEO_SIZES).join(', ')}`)
  return size
}

const seed = () => Math.floor(Math.random() * 2 ** 31)

export async function generateImage(
  comfy: ComfyClient,
  request: { prompt: string; size: string; output: string; references?: string[]; seed?: number },
): Promise<MediaResult> {
  const started = Date.now()
  const [width, height] = parseSize(request.size)
  const [nativeWidth, nativeHeight] = nativeSize(width, height)
  const references = request.references ?? []
  const workflow = references.length > 0 ? 'qwen_image_edit_lightning' : 'qwen_image_lightning'

  const values: Record<string, unknown> = {
    prompt: request.prompt,
    width: nativeWidth,
    height: nativeHeight,
    seed: request.seed ?? seed(),
    filename_prefix: `cineloom/${Date.now()}`,
  }
  // The edit graph has three reference slots; with fewer references the last one repeats.
  for (let slot = 0; slot < 3 && references.length > 0; slot++) {
    const source = references[Math.min(slot, references.length - 1)]!
    values[`image_${slot + 1}`] = await comfy.uploadImage(await readFile(source), `ref_${Date.now()}_${slot}.png`)
  }

  const outputs = await comfy.run(renderWorkflow(await loadWorkflow(workflow), values))
  await mkdir(dirname(request.output), { recursive: true })
  const upscaled = nativeWidth !== width || nativeHeight !== height
  if (upscaled) {
    const native = `${request.output}.native.png`
    await writeFile(native, await comfy.download(outputs[0]!))
    await scaleImage(native, request.output, width, height)
  } else {
    await writeFile(request.output, await comfy.download(outputs[0]!))
  }
  return {
    path: request.output,
    workflow,
    seconds: (Date.now() - started) / 1000,
    width,
    height,
    detail: { nativeSize: `${nativeWidth}x${nativeHeight}`, upscaled, references: references.length },
  }
}

export async function generateVideo(
  comfy: ComfyClient,
  request: { prompt: string; output: string; resolution: string; ratio: string; durationSeconds: number; firstFrame?: string; freeAfter?: boolean },
): Promise<MediaResult> {
  const started = Date.now()
  const [width, height] = videoSize(request.resolution, request.ratio)
  const segmentCount = Math.max(1, Math.ceil(request.durationSeconds / VIDEO_SEGMENT_SECONDS))
  await mkdir(dirname(request.output), { recursive: true })

  let startFrame = request.firstFrame
  const segments: string[] = []
  for (let index = 0; index < segmentCount; index++) {
    const workflow = startFrame ? 'wan22_ti2v_5b_i2v' : 'wan22_ti2v_5b_t2v'
    const values: Record<string, unknown> = {
      prompt: request.prompt,
      width,
      height,
      // Wan expects 4n+1 frames.
      length: VIDEO_SEGMENT_SECONDS * VIDEO_FPS + 1,
      fps: VIDEO_FPS,
      seed: seed(),
      filename_prefix: `cineloom/${Date.now()}_${index}`,
    }
    if (startFrame) values.start_image = await comfy.uploadImage(await readFile(startFrame), `start_${Date.now()}_${index}.png`)
    const outputs = await comfy.run(renderWorkflow(await loadWorkflow(workflow), values))
    const segment = `${request.output}.seg${index}.mp4`
    await writeFile(segment, await comfy.download(outputs[0]!))
    segments.push(segment)
    if (index + 1 < segmentCount) {
      // Continue the next segment from this one's last frame to keep the shot continuous.
      startFrame = `${segment}.last.png`
      await extractLastFrame(segment, startFrame)
    }
  }
  if (segments.length === 1) await rename(segments[0]!, request.output)
  else await concatCopy(segments, request.output)
  if (request.freeAfter ?? true) await comfy.free()

  return {
    path: request.output,
    workflow: 'wan22_ti2v_5b',
    seconds: (Date.now() - started) / 1000,
    width,
    height,
    detail: { segments: segmentCount, durationSeconds: segmentCount * VIDEO_SEGMENT_SECONDS, firstFrame: Boolean(request.firstFrame) },
  }
}
