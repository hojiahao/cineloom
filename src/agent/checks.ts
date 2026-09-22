/**
 * Deterministic checks for what the skills require. The director uses them to accept or
 * reject an agent's work; the evals use the same functions to score runs with and without
 * a skill, so "the skill helped" is a count of rule violations, not an opinion.
 */
import { scanCopy, type Category } from '../lib/compliance.js'

export interface Brief {
  id: string
  title: string
  product: string
  category: Category
  audience: string
  message: string
  ratio: '9:16' | '16:9' | '1:1'
  durationSeconds: number
  tone: string
  brandText: string
}

export interface Beat {
  beat: number
  job: string
  see: string
  vo: string
  text: string
}

export interface Script {
  structure: string
  beats: Beat[]
}

export interface Shot {
  shot: number
  seconds: number
  framing: string
  camera: string
  image_prompt: string
  video_prompt: string
  on_screen_text: string
  must_show: string
}

export interface Storyboard {
  style: string
  /** One visual description of the product, written once and reused in every shot so it cannot drift. */
  product: string
  shots: Shot[]
}

export const VO_MAX_CHARS = 18
/** Below this a 5-second beat is mostly silence, which is how a model 'passes' a length limit without writing copy. */
export const VO_MIN_CHARS = 8
export const TEXT_MAX_CHARS = 8
const CJK = /[一-鿿]/

// Everything a caption may contain: CJK, Latin letters, digits and ordinary punctuation. Anything else
// (emoji, replacement characters, stray symbols, other scripts) is how garbage reaches the screen.
const CAPTION_ALLOWED = /^[\u4e00-\u9fffA-Za-z0-9 ，。！？、：；“”‘’·—…%％℃°+\-]*$/
const REPEATED_PUNCTUATION = /[，。！？、：；·—…]{2,}|[,.!?;:]{1,}/

/** Problems that would make an on-screen line look wrong, whatever it says. */
export function captionProblems(label: string, text: string, isTitle: boolean): string[] {
  const problems: string[] = []
  const value = text ?? ''
  if (!CAPTION_ALLOWED.test(value)) problems.push(`${label}: contains characters that must not appear on screen (${[...value].filter((char) => !CAPTION_ALLOWED.test(char)).join(' ')}); use Chinese characters, digits and ordinary Chinese punctuation only`)
  if (REPEATED_PUNCTUATION.test(value)) problems.push(`${label}: repeated or half-width punctuation; use single full-width marks`)
  if (/^[，。！？、：；·—…]/.test(value.trim())) problems.push(`${label}: starts with punctuation`)
  if (isTitle && /[，。！？、：；]$/.test(value.trim())) problems.push(`${label}: a title has no closing punctuation`)
  return problems
}

/** Visible characters, ignoring whitespace and punctuation - what a voice actually has to read. */
export const spokenLength = (text: string) => [...text.replace(/[\s，。！？、,.!?：:；;“”"'…—-]/g, '')].length

export function checkBrief(brief: Brief): string[] {
  const problems: string[] = []
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(brief.id ?? '')) problems.push('id must be lowercase letters, digits and dashes')
  if (!['9:16', '16:9', '1:1'].includes(brief.ratio)) problems.push('ratio must be 9:16, 16:9 or 1:1')
  if (!Number.isInteger(brief.durationSeconds) || brief.durationSeconds % 5 !== 0 || brief.durationSeconds < 5 || brief.durationSeconds > 30)
    problems.push('durationSeconds must be a multiple of 5 between 5 and 30, because clips are generated in 5-second segments')
  if (!['general', 'food', 'health_food', 'cosmetics', 'medical'].includes(brief.category)) problems.push('category must be general, food, health_food, cosmetics or medical')
  for (const field of ['title', 'product', 'audience', 'message', 'tone'] as const) if (!brief[field]?.trim()) problems.push(`${field} is empty`)
  return problems
}

export function checkScript(script: Script, brief: Brief): string[] {
  const problems: string[] = []
  const expected = brief.durationSeconds / 5
  const beats = Array.isArray(script.beats) ? script.beats : []
  if (!script.structure?.trim()) problems.push('structure is missing: name the one structure the script follows')
  if (beats.length !== expected) problems.push(`the script must have exactly ${expected} beats of 5 seconds (one beat becomes one generated clip); it has ${beats.length}`)
  for (const beat of beats) {
    const label = `beat ${beat.beat}`
    if (!beat.see?.trim()) problems.push(`${label}: "see" is empty`)
    if (!beat.vo?.trim()) problems.push(`${label}: "vo" is empty`)
    else {
      if (!CJK.test(beat.vo)) problems.push(`${label}: voiceover must be in Chinese`)
      if (spokenLength(beat.vo) < VO_MIN_CHARS) problems.push(`${label}: voiceover has only ${spokenLength(beat.vo)} characters; write ${VO_MIN_CHARS}-${VO_MAX_CHARS} so the beat is not mostly silence`)
      if (spokenLength(beat.vo) > VO_MAX_CHARS) problems.push(`${label}: voiceover has ${spokenLength(beat.vo)} characters; at most ${VO_MAX_CHARS} fit in 5 seconds`)
    }
    problems.push(...captionProblems(`${label} voiceover`, beat.vo ?? '', false), ...captionProblems(`${label} on-screen text`, beat.text ?? '', true))
    if (spokenLength(beat.text ?? '') > TEXT_MAX_CHARS) problems.push(`${label}: on-screen text has ${spokenLength(beat.text)} characters; at most ${TEXT_MAX_CHARS}`)
  }
  const copy = beats.map((beat) => `${beat.vo}\n${beat.text ?? ''}`).join('\n')
  for (const finding of scanCopy(copy, brief.category).filter((item) => item.severity === 'block'))
    problems.push(`restricted wording "${finding.text}" (${finding.rule}): ${finding.reason}`)
  return problems
}

export function checkStoryboard(storyboard: Storyboard, script: Script, brief?: Pick<Brief, 'brandText' | 'product'>): string[] {
  const problems: string[] = []
  const shots = Array.isArray(storyboard.shots) ? storyboard.shots : []
  if (!storyboard.style?.trim()) problems.push('style line is missing')
  if (!storyboard.product?.trim()) problems.push('product description is missing: describe container type, material, colours and label once')
  // The hero still is generated from this sentence. A copied example (a soda can for a face cream) went unnoticed once.
  else if (brief?.brandText && !storyboard.product.includes(brief.brandText)) problems.push(`product must describe THIS brief's product (${brief.product}) with the label text "${brief.brandText}" in quotes; it does not mention "${brief.brandText}"`)
  if (storyboard.product?.trim() && brief && /\b(aluminium|aluminum|tin|soda|drink|beverage)?\s*cans?\b|气泡水|易拉罐/i.test(storyboard.product) && !/\bcan\b|aluminium|气泡|饮料|汽水|可乐|啤酒|soda|drink|beverage|water|beer|cola|tea|coffee|juice/i.test(brief.product)) problems.push('product describes a drink can but the brief is not for a canned drink; describe the actual product from the brief')
  if (brief && storyboard.product?.includes('matte-silver aluminium can') && !/can|罐|铝/i.test(brief.product)) problems.push('product is the example from the skill, not this brief\'s product')
  if (shots.length !== script.beats.length) problems.push(`one shot per beat: expected ${script.beats.length} shots, got ${shots.length}`)
  for (const shot of shots) {
    const label = `shot ${shot.shot}`
    if (!shot.image_prompt?.trim()) problems.push(`${label}: image_prompt is empty`)
    else {
      if (CJK.test(shot.image_prompt.replace(/"[^"]*"/g, ''))) problems.push(`${label}: image_prompt must be in English; Chinese is only allowed inside the quoted on-screen text`)
    }
    if (!shot.video_prompt?.trim()) problems.push(`${label}: video_prompt is empty`)
    else if (CJK.test(shot.video_prompt)) problems.push(`${label}: video_prompt must be in English and must not contain on-screen text`)
    if (!shot.camera?.trim() || /\b(and|then)\b|,/.test(shot.camera)) problems.push(`${label}: camera must be exactly one move`)
    if (!shot.must_show?.trim()) problems.push(`${label}: must_show is empty; the quality gate needs something visible to check`)
    if (spokenLength(shot.on_screen_text ?? '') > TEXT_MAX_CHARS) problems.push(`${label}: on_screen_text is longer than ${TEXT_MAX_CHARS} characters and will warp`)
  }
  return problems
}

/** Lens specs and other short numeric tokens get painted into the image as text ("50mm" appeared as a caption), so drop them. */
export const sanitizeStyle = (style: string) =>
  style.replace(/\b\d+(\.\d+)?\s?mm\b/gi, '').replace(/\bf\/?\d+(\.\d+)?\b/gi, '').replace(/\b\d+k\b/gi, '').replace(/\s*,\s*(?=,|$)/g, '').replace(/^\s*,\s*/, '').replace(/\s{2,}/g, ' ').trim()

const NO_TEXT = 'No captions, no subtitles, no slogans, no watermark, no numbers and no lettering anywhere except the label printed on the product itself'

/** The hero still that every shot is anchored to. */
export function composeProductPrompt(storyboard: Storyboard): string {
  return `Studio product photograph of ${storyboard.product.trim().replace(/[.。]$/, '')}. The product stands upright, centred, fully visible, on a seamless neutral backdrop with soft even light. ${NO_TEXT}. ${sanitizeStyle(storyboard.style)}`
}

/**
 * Product, no-text rule and style are appended by code, not by the model, so every shot
 * carries them verbatim. `withReference` is set when the frame is generated from the hero still.
 */
export function composeImagePrompt(shot: Shot, storyboard: Storyboard, withReference = false): string {
  const scene = shot.image_prompt.trim().replace(/[.。]$/, '')
  const product = withReference
    ? 'Image 1 is the product: keep its shape, proportions, colours, material and label exactly as in image 1'
    : `The product: ${storyboard.product.trim().replace(/[.。]$/, '')}`
  return `${scene}. ${product}. ${NO_TEXT}. ${sanitizeStyle(storyboard.style)}`
}
