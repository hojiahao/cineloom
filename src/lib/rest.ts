/**
 * Putting the language models to sleep while the diffusion models work.
 *
 * On a DGX Spark every model shares one 121.7 GB pool. The two vLLM services claim 45 % of it at
 * start-up and keep it, so during the frame and clip phases ComfyUI has ~54 GB and must evict
 * and reload Qwen-Image-Edit / Wan2.2 weights on every frame and every clip. Measured on this
 * machine: a 5-second Wan clip is ~200 s of compute plus ~150 s of weight traffic.
 *
 * vLLM's sleep mode (`--enable-sleep-mode`) fixes that: level 2 discards the weights and the KV
 * cache, `wake_up` reloads them from NVMe. The harness sleeps the planner during frames, both
 * services during clips, and every request wakes its endpoint first, so a caller never sees a
 * sleeping model. Servers started without the flag answer 404 and are simply left alone.
 */

/** Per service: 'awake', 'asleep', or 'none' for a server without sleep mode (asked once). */
const state = new Map<string, 'awake' | 'asleep' | 'none'>()

/** `http://host:port/v1` -> `http://host:port` */
export const serviceRoot = (baseUrl: string) => baseUrl.replace(/\/v1\/?$/, '')

export const sleepEnabled = () => process.env.CINELOOM_SLEEP_LLMS !== '0'

/** Whether the service is asleep; `undefined` when it has no sleep mode (or is not a vLLM server). */
export async function isSleeping(baseUrl: string): Promise<boolean | undefined> {
  try {
    const response = await fetch(`${serviceRoot(baseUrl)}/is_sleeping`, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) return undefined
    return Boolean(((await response.json()) as { is_sleeping?: boolean }).is_sleeping)
  } catch {
    return undefined
  }
}

/** Wake the service if it sleeps. Cheap after the first call: the state is remembered until we sleep it ourselves. */
export async function ensureAwake(baseUrl: string): Promise<{ wokeSeconds?: number }> {
  if (!baseUrl.startsWith('http://127.0.0.1') && !baseUrl.startsWith('http://localhost')) return {}
  const known = state.get(baseUrl)
  if (known === 'awake' || known === 'none') return {}
  const sleeping = await isSleeping(baseUrl)
  if (sleeping === undefined) {
    state.set(baseUrl, 'none')
    return {}
  }
  if (!sleeping) {
    state.set(baseUrl, 'awake')
    return {}
  }
  const started = Date.now()
  const response = await fetch(`${serviceRoot(baseUrl)}/wake_up`, { method: 'POST', signal: AbortSignal.timeout(600000) })
  if (!response.ok) throw new Error(`could not wake ${baseUrl}: ${response.status}`)
  state.set(baseUrl, 'awake')
  return { wokeSeconds: (Date.now() - started) / 1000 }
}

/** Level 2: weights and KV cache are released; the next request reloads them. Returns false when the server has no sleep mode. */
export async function sleepService(baseUrl: string): Promise<boolean> {
  if (!sleepEnabled() || state.get(baseUrl) === 'none') return false
  const sleeping = await isSleeping(baseUrl)
  if (sleeping === undefined) {
    state.set(baseUrl, 'none')
    return false
  }
  if (!sleeping) {
    const response = await fetch(`${serviceRoot(baseUrl)}/sleep?level=2`, { method: 'POST', signal: AbortSignal.timeout(120000) })
    if (!response.ok) throw new Error(`could not sleep ${baseUrl}: ${response.status}`)
  }
  state.set(baseUrl, 'asleep')
  return true
}

export async function wakeService(baseUrl: string): Promise<{ wokeSeconds?: number }> {
  if (state.get(baseUrl) !== 'none') state.delete(baseUrl)
  return ensureAwake(baseUrl)
}
