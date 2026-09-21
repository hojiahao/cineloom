import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { ComfyClient } from '../comfy/client.js'
import { loadWorkflow, renderWorkflow } from '../comfy/workflow.js'
import { exec } from './exec.js'
import { probeDuration } from './ffmpeg.js'

const TTS_PYTHON = () => resolve(process.env.CINELOOM_TTS_PYTHON ?? 'runtime-data/tts-venv/bin/python')
const TTS_SCRIPT = () => resolve(process.env.CINELOOM_TTS_SCRIPT ?? 'scripts/tts.py')

/**
 * Offline Mandarin voiceover for one line. If the line runs longer than its slot it is
 * re-synthesised faster (up to 1.25x) rather than cut off.
 */
export async function synthesizeVoice(text: string, output: string, maxSeconds: number, voice = process.env.CINELOOM_TTS_VOICE ?? 'zf_001'): Promise<{ seconds: number; speed: number }> {
  await mkdir(dirname(output), { recursive: true })
  let speed = 1.0
  for (let attempt = 0; attempt < 3; attempt++) {
    await exec(TTS_PYTHON(), [TTS_SCRIPT(), '--text', text, '--out', output, '--voice', voice, '--speed', speed.toFixed(2)])
    const seconds = await probeDuration(output)
    if (seconds <= maxSeconds || speed >= 1.25) return { seconds, speed }
    speed = Math.min(1.25, speed * (seconds / maxSeconds) * 1.03)
  }
  return { seconds: await probeDuration(output), speed }
}

/** An instrumental bed generated locally by ACE-Step through ComfyUI: nothing licensed, nothing uploaded. */
export async function generateMusic(comfy: ComfyClient, request: { tags: string; seconds: number; output: string }): Promise<{ seconds: number }> {
  const started = Date.now()
  const outputs = await comfy.run(
    renderWorkflow(await loadWorkflow('ace_step_instrumental'), {
      tags: request.tags,
      seconds: Math.ceil(request.seconds) + 2,
      seed: Math.floor(Math.random() * 2 ** 31),
      filename_prefix: `cineloom/music_${Date.now()}`,
    }),
  )
  await mkdir(dirname(request.output), { recursive: true })
  await writeFile(request.output, await comfy.download(outputs[0]!))
  return { seconds: (Date.now() - started) / 1000 }
}

/**
 * Voice lines placed at their cue times over the music bed. The bed ducks under the voice
 * (sidechain compression) instead of sitting at one low level for the whole film.
 */
export async function mixSoundtrack(request: { voices: Array<{ path: string; start: number }>; music?: string; totalSeconds: number; output: string }): Promise<void> {
  const { voices, music, totalSeconds, output } = request
  if (voices.length === 0 && !music) throw new Error('Nothing to mix: no voice lines and no music.')
  const args = ['-hide_banner', '-loglevel', 'error', '-y', ...voices.flatMap((voice) => ['-i', voice.path])]
  const parts: string[] = []
  voices.forEach((voice, index) => {
    const delay = Math.round(voice.start * 1000)
    parts.push(`[${index}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${delay}|${delay},volume=1.6[v${index}]`)
  })
  let voiceLabel = ''
  if (voices.length > 0) {
    parts.push(`${voices.map((_, index) => `[v${index}]`).join('')}amix=inputs=${voices.length}:normalize=0:duration=longest,apad=whole_dur=${totalSeconds}[voice]`)
    voiceLabel = '[voice]'
  }
  if (music) {
    args.push('-i', music)
    parts.push(`[${voices.length}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${totalSeconds},volume=0.55[bed]`)
    if (voiceLabel) {
      parts.push('[voice]asplit=2[voiceMix][voiceKey]')
      parts.push('[bed][voiceKey]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[ducked]')
      parts.push('[voiceMix][ducked]amix=inputs=2:normalize=0:duration=longest[mix]')
    } else parts.push('[bed]anull[mix]')
  } else parts.push('[voice]anull[mix]')
  parts.push(`[mix]atrim=duration=${totalSeconds},alimiter=limit=0.95[out]`)
  await mkdir(dirname(output), { recursive: true })
  await exec('ffmpeg', [...args, '-filter_complex', parts.join(';'), '-map', '[out]', '-ar', '48000', output])
}
