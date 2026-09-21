#!/usr/bin/env node
import { COMMANDS } from './commands/index.js'
import { parseArgs, UsageError } from './lib/args.js'

const HELP = `CineLoom - agentic ad-film studio for a single DGX Spark

  cineloom direct "<brief>" [--id id] [--ratio 9:16] [--duration 15] [--plan-only]
  cineloom project init --id <id> --brief <text> [--title] [--ratio 9:16] [--duration 15]
  cineloom project status --id <id>
  cineloom project stage --id <id> --stage <stage> --status <pending|running|done|failed> [--note]
  cineloom copy-check <file|-> [--category general|food|health_food|cosmetics|medical]
  cineloom shots <video> [--out dir] [--threshold 0.30]
  cineloom image --prompt <text> [--size 1328x1328] [--ref img ...] [--project id --shot n | --out file]
  cineloom video --prompt <text> [--first-frame img] [--duration 5] [--ratio 9:16] [--resolution 720p] [--project id --shot n | --out file]
  cineloom qa --frame <img> [--ref img ...] [--expect text] [--project id --shot n]
  cineloom cut --project <id> [--audio file] [--subtitles file.srt]
  cineloom mem <status|plan|free> [--need name=GB ...]
  cineloom doctor
  cineloom studio [--port 3090] [--host 127.0.0.1]
`

const [name, ...rest] = process.argv.slice(2)
const command = name ? COMMANDS[name] : undefined
if (!command) {
  console.log(HELP)
  process.exit(name && name !== 'help' && name !== '--help' ? 2 : 0)
}
try {
  process.exitCode = await command(parseArgs(rest))
} catch (error) {
  console.error(error instanceof UsageError ? `usage error: ${error.message}` : `error: ${(error as Error).message}`)
  process.exitCode = error instanceof UsageError ? 2 : 1
}
