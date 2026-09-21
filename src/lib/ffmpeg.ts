import { writeFile } from 'node:fs/promises'
import { exec } from './exec.js'

export async function probeDuration(video: string): Promise<number> {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video])
  return Number(stdout.trim())
}

export async function scaleImage(input: string, output: string, width: number, height: number): Promise<void> {
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vf', `scale=${width}:${height}:flags=lanczos`, output])
}

export async function extractFrame(video: string, seconds: number, output: string): Promise<void> {
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', seconds.toFixed(3), '-i', video, '-frames:v', '1', '-q:v', '2', output])
}

export async function extractLastFrame(video: string, output: string): Promise<void> {
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-sseof', '-0.2', '-i', video, '-frames:v', '1', output])
}

/** Timestamps where ffmpeg's scene score crosses the threshold. */
export async function detectCuts(video: string, threshold: number): Promise<number[]> {
  const { stderr } = await exec('ffmpeg', ['-hide_banner', '-i', video, '-vf', `select='gt(scene,${threshold})',showinfo`, '-an', '-f', 'null', '-'])
  return [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((match) => Number(match[1]))
}

export interface CutOptions {
  width: number
  height: number
  fps: number
  audio?: string
  audioGainDb?: number
  subtitles?: string
}

/** Normalise every clip to one size and frame rate, join them, then lay audio and subtitles on top. */
export async function assembleCut(clips: string[], output: string, options: CutOptions): Promise<void> {
  const inputs = clips.flatMap((clip) => ['-i', clip])
  const normalise = clips
    .map((_, index) => `[${index}:v]scale=${options.width}:${options.height}:force_original_aspect_ratio=decrease,pad=${options.width}:${options.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${options.fps}[v${index}]`)
    .join(';')
  let chain = `${normalise};${clips.map((_, index) => `[v${index}]`).join('')}concat=n=${clips.length}:v=1:a=0[joined]`
  let videoLabel = '[joined]'
  if (options.subtitles) {
    const escaped = options.subtitles.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
    chain += `;[joined]subtitles='${escaped}'[subbed]`
    videoLabel = '[subbed]'
  }
  const args = ['-hide_banner', '-loglevel', 'error', '-y', ...inputs]
  if (options.audio) {
    args.push('-i', options.audio)
    chain += `;[${clips.length}:a]volume=${options.audioGainDb ?? -10}dB[music]`
  }
  args.push('-filter_complex', chain, '-map', videoLabel)
  if (options.audio) args.push('-map', '[music]', '-shortest', '-c:a', 'aac')
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output)
  await exec('ffmpeg', args)
}

export async function concatCopy(segments: string[], output: string): Promise<void> {
  const listing = `${output}.txt`
  await writeFile(listing, segments.map((segment) => `file '${segment}'\n`).join(''))
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listing, '-c', 'copy', output])
}

export interface FilmOptions {
  width: number
  height: number
  fps: number
  clipSeconds: number
  crossfadeSeconds: number
  ass?: string
  audio?: string
  audioGainDb?: number
}

/** Seconds at which clip `index` starts on the final timeline, given crossfades between clips. */
export const clipStart = (index: number, clipSeconds: number, crossfadeSeconds: number) => index * (clipSeconds - crossfadeSeconds)

/**
 * Finishing pass: conform every clip, crossfade between them, then grade the whole film as
 * one image - gentle contrast, a teal/warm split, sharpening, fine grain, vignette, fades -
 * and burn in typography. Grading after the join keeps shots from different generations
 * looking like one film.
 */
export async function assembleFilm(clips: string[], output: string, options: FilmOptions): Promise<void> {
  const { width, height, fps, clipSeconds, crossfadeSeconds } = options
  const conform = clips
    .map((_, index) => `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},setsar=1,fps=${fps},trim=duration=${clipSeconds},setpts=PTS-STARTPTS,format=yuv420p[c${index}]`)
    .join(';')
  let chain = conform
  let last = '[c0]'
  for (let index = 1; index < clips.length; index++) {
    const label = `[x${index}]`
    chain += `;${last}[c${index}]xfade=transition=fade:duration=${crossfadeSeconds}:offset=${clipStart(index, clipSeconds, crossfadeSeconds).toFixed(3)}${label}`
    last = label
  }
  const total = clipStart(clips.length - 1, clipSeconds, crossfadeSeconds) + clipSeconds
  const grade = [
    'eq=contrast=1.07:saturation=1.10:gamma=0.98',
    'colorbalance=rs=0.04:gs=0.01:bs=-0.03:rh=-0.02:bh=0.04',
    'unsharp=5:5:0.5:5:5:0.0',
    'noise=alls=5:allf=t+u',
    'vignette=PI/5.5',
    `fade=t=in:st=0:d=0.35,fade=t=out:st=${(total - 0.5).toFixed(3)}:d=0.5`,
  ].join(',')
  chain += `;${last}${grade}[graded]`
  let videoLabel = '[graded]'
  if (options.ass) {
    const escaped = options.ass.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
    chain += `;[graded]ass='${escaped}'[titled]`
    videoLabel = '[titled]'
  }
  const args = ['-hide_banner', '-loglevel', 'error', '-y', ...clips.flatMap((clip) => ['-i', clip])]
  if (options.audio) {
    args.push('-i', options.audio)
    chain += `;[${clips.length}:a]volume=${options.audioGainDb ?? -10}dB,afade=t=out:st=${(total - 1).toFixed(3)}:d=1[music]`
  }
  args.push('-filter_complex', chain, '-map', videoLabel)
  if (options.audio) args.push('-map', '[music]', '-shortest', '-c:a', 'aac', '-b:a', '192k')
  args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output)
  await exec('ffmpeg', args)
}
