export interface Shot {
  index: number
  start: number
  end: number
  duration: number
  keyframe: string
}

/** Turn cut timestamps into shot ranges, merging anything shorter than `minShot` seconds. */
export function buildShots(cuts: number[], duration: number, minShot: number): Array<[number, number]> {
  const boundaries = [0]
  for (const cut of [...cuts].sort((a, b) => a - b)) {
    if (cut - boundaries.at(-1)! >= minShot && duration - cut >= minShot) boundaries.push(cut)
  }
  boundaries.push(duration)
  return boundaries.slice(0, -1).map((start, index) => [start, boundaries[index + 1]!])
}
