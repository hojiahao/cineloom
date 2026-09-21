import { spawn } from 'node:child_process'

export interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

/** Run a program to completion. Rejects on a non-zero exit unless `allowFailure` is set. */
export function exec(command: string, args: string[], options: { allowFailure?: boolean } = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      const result = { stdout, stderr, code: code ?? -1 }
      if (result.code !== 0 && !options.allowFailure) {
        reject(new Error(`${command} exited with ${result.code}: ${stderr.slice(-1500)}`))
      } else {
        resolve(result)
      }
    })
  })
}
