import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { checkBrief, checkScript, checkStoryboard, type Brief, type Script, type Storyboard } from './checks.js'
import { chatJson, endpoints } from './llm.js'
import { agentSystem, scriptUser, storyboardUser } from './prompts.js'
import { loadRules, loadSkill } from './skills.js'

/**
 * With/without-skill comparison. Same model, same briefs, same prompts; the only variable
 * is whether the agent's system prompt contains its skill. Each stage gets ONE attempt and
 * is scored by the director's own validators: the number is rule violations on the first
 * answer, which is what the retry loop would otherwise have to clean up.
 */

interface ArmResult {
  scriptViolations: number
  scriptProblems: string[]
  storyboardViolations: number
  storyboardProblems: string[]
  seconds: number
}

const FIXED_BRIEF = (request: string, index: number): Brief => {
  const duration = Number(/(\d+)\s*秒/.exec(request)?.[1] ?? 15)
  return {
    id: `eval-${index + 1}`, title: request.slice(0, 12), product: request, category: /面霜/.test(request) ? 'cosmetics' : /水|咖啡|茶|榨汁/.test(request) ? 'food' : 'general',
    audience: 'see request', message: 'see request', ratio: /横版/.test(request) ? '16:9' : '9:16', durationSeconds: duration, tone: 'see request',
    brandText: /[“"]([^”"]{1,4})[”"]/.exec(request)?.[1] ?? '牌',
  }
}

async function runArm(brief: Brief, withSkills: boolean): Promise<ArmResult> {
  const { planner } = endpoints()
  const rules = await loadRules()
  const system = async (role: string, skill: string) => agentSystem(role, rules, withSkills ? { name: skill, body: await loadSkill(skill) } : undefined)
  const started = Date.now()

  let script: Script | undefined
  let scriptProblems: string[]
  try {
    const run = await chatJson<Script>(planner, { system: await system('copywriter', 'ad-script-writing'), thinking: false, maxTokens: 3000, temperature: 0.8, user: scriptUser(brief) }, (value) => checkScript(value, brief), 1)
    script = run.value
    scriptProblems = run.rejected[0] ?? []
  } catch (error) {
    scriptProblems = [`no usable JSON: ${(error as Error).message.slice(0, 100)}`]
  }

  let storyboardProblems: string[] = ['skipped: no script to storyboard']
  if (script && Array.isArray(script.beats) && script.beats.length > 0) {
    try {
      const run = await chatJson<Storyboard>(planner, { system: await system('storyboard artist', 'storyboard-design'), thinking: false, maxTokens: 5000, temperature: 0.6, user: storyboardUser(brief, script) }, (value) => [...checkStoryboard(value, script!), ...styleAndTextProblems(value)], 1)
      storyboardProblems = run.rejected[0] ?? []
    } catch (error) {
      storyboardProblems = [`no usable JSON: ${(error as Error).message.slice(0, 100)}`]
    }
  }
  return { scriptViolations: scriptProblems.length, scriptProblems, storyboardViolations: storyboardProblems.length, storyboardProblems, seconds: (Date.now() - started) / 1000 }
}

/** Two failure modes measured on real frames: numeric style tokens and captions requested inside the image. */
function styleAndTextProblems(storyboard: Storyboard): string[] {
  const problems: string[] = []
  if (/\d/.test(storyboard.style ?? '')) problems.push('style line contains numbers, which the image model paints into the frame')
  for (const shot of storyboard.shots ?? []) {
    if (/\b(text|caption|slogan|subtitle|title|words?|reads?|saying)\b/i.test(shot.image_prompt ?? '') || /"[^"]+"/.test(shot.image_prompt ?? ''))
      problems.push(`shot ${shot.shot}: image_prompt asks the model to draw text`)
    if (/\b(bottle|can|jar|cup|box|tube|label)\b[^.]{0,60}\b(silver|teal|white|red|blue|green|gold|black|pink)\b/i.test(shot.image_prompt ?? ''))
      problems.push(`shot ${shot.shot}: image_prompt re-describes the product instead of referring to "the product"`)
  }
  return problems
}

export async function runAblation(briefsPath: string, output: string, repeats: number, log: (line: string) => void): Promise<unknown> {
  const requests = JSON.parse(await readFile(briefsPath, 'utf8')) as string[]
  const rows: Array<{ brief: string; repeat: number; withSkills: ArmResult; withoutSkills: ArmResult }> = []
  for (const [index, request] of requests.entries()) {
    const brief = FIXED_BRIEF(request, index)
    if (checkBrief(brief).length) throw new Error(`eval brief ${index + 1} is invalid: ${checkBrief(brief).join('; ')}`)
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const withSkills = await runArm(brief, true)
      const withoutSkills = await runArm(brief, false)
      rows.push({ brief: request, repeat, withSkills, withoutSkills })
      log(`brief ${index + 1}/${requests.length} run ${repeat}: with skills ${withSkills.scriptViolations}+${withSkills.storyboardViolations} violations · without ${withoutSkills.scriptViolations}+${withoutSkills.storyboardViolations}`)
    }
  }
  const summarise = (pick: (row: (typeof rows)[number]) => ArmResult) => {
    const arms = rows.map(pick)
    const mean = (values: number[]) => Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
    return {
      runs: arms.length,
      scriptCleanFirstTry: `${arms.filter((arm) => arm.scriptViolations === 0).length}/${arms.length}`,
      storyboardCleanFirstTry: `${arms.filter((arm) => arm.storyboardViolations === 0).length}/${arms.length}`,
      meanScriptViolations: mean(arms.map((arm) => arm.scriptViolations)),
      meanStoryboardViolations: mean(arms.map((arm) => arm.storyboardViolations)),
      meanSeconds: mean(arms.map((arm) => arm.seconds)),
    }
  }
  const report = {
    date: new Date().toISOString(), model: endpoints().planner.model, briefs: requests.length, repeats,
    method: 'one attempt per stage, thinking off, scored by src/agent/checks.ts plus two frame-level failure modes',
    withSkills: summarise((row) => row.withSkills), withoutSkills: summarise((row) => row.withoutSkills), rows,
  }
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2))
  return { withSkills: report.withSkills, withoutSkills: report.withoutSkills, output }
}
