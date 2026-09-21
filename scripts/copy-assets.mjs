// tsc only emits .js; the studio page is a static asset that must sit next to it.
import { cpSync } from 'node:fs'
cpSync('src/studio/public', 'dist/studio/public', { recursive: true })
