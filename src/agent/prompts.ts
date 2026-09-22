import type { Brief, Script } from './checks.js'

/** User prompts for the stage agents. Shared by the director and the evals so both measure the same task. */

export const scriptUser = (brief: Brief) => `Brief:\n${JSON.stringify(brief, null, 2)}\n\nWrite the script with EXACTLY ${brief.durationSeconds / 5} beats of 5 seconds each (${brief.durationSeconds} s in total; one beat becomes one generated clip). Voiceover ("vo") is 8-18 Chinese characters per beat, on-screen text ("text") at most 8; "see" is in English.
Return JSON only: {"structure": "...", "beats": [{"beat": 1, "job": "hook|proof|payoff|cta", "see": "...", "vo": "...", "text": "..."}]}`

export const storyboardUser = (brief: Brief, script: Script) => `Brief:\n${JSON.stringify(brief, null, 2)}\n\nApproved script:\n${JSON.stringify(script, null, 2)}

No reference photos exist. The product label reads "${brief.brandText}".
Write EXACTLY ${script.beats.length} shots, numbered 1 to ${script.beats.length}, one per beat, in beat order.
Return JSON only: {"style": "...", "product": "...", "shots": [{"shot": 1, "seconds": 5, "framing": "...", "camera": "...", "image_prompt": "...", "video_prompt": "...", "on_screen_text": "", "must_show": "..."}]}`

export const agentSystem = (role: string, rules: string, skill?: { name: string; body: string }) =>
  [`You are the ${role} of CineLoom, an advertising studio running on one DGX Spark.`, rules, skill ? `# Skill: ${skill.name}\n\n${skill.body}` : ''].filter(Boolean).join('\n\n')
