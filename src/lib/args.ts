export interface ParsedArgs {
  positionals: string[]
  flags: Map<string, string[]>
}

/** `--key value`, `--key=value`, repeated flags, and bare `--switch` (value "true"). */
export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags = new Map<string, string[]>()
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }
    const [name, inline] = token.slice(2).split(/=(.*)/s, 2) as [string, string | undefined]
    const next = argv[index + 1]
    let value = 'true'
    if (inline !== undefined) value = inline
    else if (next !== undefined && !next.startsWith('--')) {
      value = next
      index++
    }
    flags.set(name, [...(flags.get(name) ?? []), value])
  }
  return { positionals, flags }
}

export function flag(args: ParsedArgs, name: string, fallback?: string): string | undefined {
  return args.flags.get(name)?.at(-1) ?? fallback
}

export function requireFlag(args: ParsedArgs, name: string): string {
  const value = flag(args, name)
  if (value === undefined || value === 'true') throw new UsageError(`--${name} is required`)
  return value
}

export function numberFlag(args: ParsedArgs, name: string, fallback: number): number {
  const raw = flag(args, name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new UsageError(`--${name} must be a number, got ${raw}`)
  return value
}

export class UsageError extends Error {}
