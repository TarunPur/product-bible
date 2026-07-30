import { readFileSync } from 'fs'
import { resolve } from 'path'

// Standalone scripts (run via tsx, not through Next.js) don't get .env.local
// loaded automatically the way Next.js routes do — mirrors WorkReview's
// scripts/import-linkedin.ts loader for consistency.
export function loadEnvFile(path: string = resolve(process.cwd(), '.env.local')) {
  try {
    const content = readFileSync(path, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let val = trimmed.slice(eqIdx + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = val
    }
  } catch {
    // .env.local is optional
  }
}
