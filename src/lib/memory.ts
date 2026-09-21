import { readFile } from 'node:fs/promises'

export interface MemoryStatus {
  totalGb: number
  availableGb: number
  swapUsedGb: number
}

const KIB_PER_GIB = 1024 ** 2

/** DGX Spark shares one pool between CPU and GPU, so /proc/meminfo is the ground truth. */
export function parseMeminfo(text: string): MemoryStatus {
  const values = new Map<string, number>()
  for (const line of text.split('\n')) {
    const match = /^(\w+):\s+(\d+)/.exec(line)
    if (match) values.set(match[1]!, Number(match[2]) / KIB_PER_GIB)
  }
  const round = (value: number) => Math.round(value * 10) / 10
  return {
    totalGb: round(values.get('MemTotal') ?? 0),
    availableGb: round(values.get('MemAvailable') ?? 0),
    swapUsedGb: round((values.get('SwapTotal') ?? 0) - (values.get('SwapFree') ?? 0)),
  }
}

export async function memoryStatus(): Promise<MemoryStatus> {
  return parseMeminfo(await readFile('/proc/meminfo', 'utf8'))
}

export interface MemoryPlan {
  budgetGb: number
  requiredGb: number
  headroomGb: number
  fits: boolean
  needs: Record<string, number>
}

export function planMemory(status: MemoryStatus, needs: Record<string, number>, reserveGb: number, against: 'total' | 'available'): MemoryPlan {
  const budgetGb = (against === 'total' ? status.totalGb : status.availableGb) - reserveGb
  const requiredGb = Object.values(needs).reduce((sum, value) => sum + value, 0)
  const round = (value: number) => Math.round(value * 10) / 10
  return { budgetGb: round(budgetGb), requiredGb, headroomGb: round(budgetGb - requiredGb), fits: requiredGb <= budgetGb, needs }
}
