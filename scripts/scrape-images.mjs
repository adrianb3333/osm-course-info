#!/usr/bin/env node
/**
 * Downloads hole layout images and overall course maps from each club's banguide.
 * Uploads them to Supabase Storage bucket "course-images" and stores the URLs in:
 *   - holes.image_url          (individual hole diagrams)
 *   - course_guides.course_map_url  (full course overview map)
 *
 * Run AFTER scrape-guides.mjs has finished:
 *   node scripts/scrape-images.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { parse } from 'node-html-parser'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env.local')
const envContent = readFileSync(envPath, 'utf-8')
for (const line of envContent.split('\n')) {
  const eqIdx = line.indexOf('=')
  if (eqIdx > 0 && !line.startsWith('#')) {
    process.env[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim()
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BUCKET = 'course-images'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; osm-course-info/1.0)',
  Accept: 'text/html,image/*,*/*',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ─── Image URL helpers ────────────────────────────────────────────────────────

// Patterns that suggest a hole layout/diagram image (not a photo)
const HOLE_IMG_PATTERN =
  /h[aå]l|hole|hul[0-9]|hole[0-9]|baninfo|layout|diagram|course.?map|banhul|banguide|green|fairway/i

// Patterns that suggest an overall course map
const MAP_IMG_PATTERN =
  /course.?map|ban(översikt|oversikt|karta|schema|plan|layout)|overview|aerial|drone|hela.?banan/i

function resolveUrl(src, base) {
  try {
    if (!src || src.startsWith('data:')) return null
    return new URL(src, base).toString()
  } catch {
    return null
  }
}

function guessContentType(url) {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase()
  const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' }
  return map[ext] ?? 'image/jpeg'
}

function storageExt(contentType) {
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' }
  return map[contentType] ?? 'jpg'
}

// ─── Download + upload ────────────────────────────────────────────────────────

async function downloadImage(url) {
  try {
    const res = await fetch(url, {
      headers: { ...HEADERS, Accept: 'image/*,*/*' },
      signal: AbortSignal.timeout(15_000),
      redirect: 'follow',
    })
    if (!res.ok) return null

    const contentType = res.headers.get('content-type')?.split(';')[0]?.trim()
      ?? guessContentType(url)

    // Skip HTML responses (redirected to error page)
    if (contentType.includes('text/html')) return null

    const buffer = await res.arrayBuffer()
    const bytes = new Uint8Array(buffer)

    // Sanity check: must be at least 2KB (skip tiny tracking pixels)
    if (bytes.length < 2_000) return null

    return { bytes, contentType }
  } catch {
    return null
  }
}

async function uploadToStorage(path, bytes, contentType) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType, upsert: true })

  if (error) {
    console.error(`    Storage upload error (${path}): ${error.message}`)
    return null
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

// ─── Page parsing ─────────────────────────────────────────────────────────────

/**
 * Extract all candidate images from a banguide page.
 * Returns { courseMapImgs: string[], holeImgs: Map<number, string[]> }
 */
function extractImageCandidates(html, pageUrl) {
  const root = parse(html)
  const allImgs = root.querySelectorAll('img[src]')

  const courseMapImgs = []
  const holeImgs = new Map() // hole_number → [url, ...]

  for (const img of allImgs) {
    const src = resolveUrl(img.getAttribute('src'), pageUrl)
    if (!src) continue

    const alt = (img.getAttribute('alt') ?? '').toLowerCase()
    const title = (img.getAttribute('title') ?? '').toLowerCase()
    const srcLower = src.toLowerCase()
    const combined = `${alt} ${title} ${srcLower}`

    // Try to extract a hole number from alt/title/src
    const holeNumMatch =
      combined.match(/h[aå]l\s*(\d{1,2})/i) ??
      combined.match(/hole[\s_-]?(\d{1,2})/i) ??
      combined.match(/hul[\s_-]?(\d{1,2})/i) ??
      combined.match(/[/_-](\d{1,2})[/_.-]/i)

    if (holeNumMatch) {
      const n = parseInt(holeNumMatch[1], 10)
      if (n >= 1 && n <= 18) {
        const existing = holeImgs.get(n) ?? []
        existing.push(src)
        holeImgs.set(n, existing)
        continue
      }
    }

    // Overall course map?
    if (MAP_IMG_PATTERN.test(combined)) {
      courseMapImgs.push(src)
      continue
    }

    // Generic hole-related image (no number, but looks like a layout)
    if (HOLE_IMG_PATTERN.test(combined)) {
      courseMapImgs.push(src) // treat as course map candidate
    }
  }

  // Fallback: if we found images near table cells containing hole numbers,
  // associate them with those cells
  if (holeImgs.size === 0) {
    const rows = root.querySelectorAll('tr')
    for (const row of rows) {
      const cells = row.querySelectorAll('td,th')
      const imgEl = row.querySelector('img[src]')
      if (!imgEl) continue

      const src = resolveUrl(imgEl.getAttribute('src'), pageUrl)
      if (!src) continue

      // Find the hole number in this row's cells
      for (const cell of cells) {
        const n = parseInt(cell.text.trim(), 10)
        if (n >= 1 && n <= 18) {
          const existing = holeImgs.get(n) ?? []
          existing.push(src)
          holeImgs.set(n, existing)
          break
        }
      }
    }
  }

  return { courseMapImgs, holeImgs }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Get all clubs that have a guide_url (scraped in previous step)
  const { data: guides, error: gErr } = await supabase
    .from('course_guides')
    .select('club_id, guide_url, source_url')
    .not('guide_url', 'is', null)

  if (gErr) { console.error(gErr.message); process.exit(1) }

  console.log(`Processing ${guides.length} clubs with guide URLs...\n`)

  let mapCount = 0
  let holeImgCount = 0

  for (const guide of guides) {
    const { club_id, guide_url } = guide

    // Fetch the guide page
    let html, finalUrl
    try {
      const res = await fetch(guide_url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(12_000),
        redirect: 'follow',
      })
      if (!res.ok) { process.stdout.write(`  [skip ${res.status}]\n`); continue }
      html = await res.text()
      finalUrl = res.url
    } catch {
      process.stdout.write(`  [fetch error]\n`)
      continue
    }

    const { courseMapImgs, holeImgs } = extractImageCandidates(html, finalUrl)
    let foundAnything = false

    // ── Course map image ────────────────────────────────────────────────────
    for (const imgUrl of courseMapImgs.slice(0, 3)) {
      const img = await downloadImage(imgUrl)
      if (!img) continue

      const ext = storageExt(img.contentType)
      const path = `clubs/${club_id}/course-map.${ext}`
      const publicUrl = await uploadToStorage(path, img.bytes, img.contentType)
      if (publicUrl) {
        await supabase.from('course_guides')
          .update({ course_map_url: publicUrl })
          .eq('club_id', club_id)
        process.stdout.write(`  [map] `)
        mapCount++
        foundAnything = true
        break
      }
      await sleep(200)
    }

    // ── Hole images ─────────────────────────────────────────────────────────
    let savedHoles = 0
    for (const [holeNum, urls] of holeImgs.entries()) {
      for (const imgUrl of urls.slice(0, 2)) {
        const img = await downloadImage(imgUrl)
        if (!img) continue

        const ext = storageExt(img.contentType)
        const path = `clubs/${club_id}/holes/hole-${holeNum}.${ext}`
        const publicUrl = await uploadToStorage(path, img.bytes, img.contentType)
        if (publicUrl) {
          await supabase.from('holes')
            .update({ image_url: publicUrl })
            .eq('club_id', club_id)
            .eq('hole_number', holeNum)
          savedHoles++
          holeImgCount++
          foundAnything = true
          break
        }
        await sleep(200)
      }
    }

    if (savedHoles > 0) process.stdout.write(`  [${savedHoles} hole imgs] `)
    if (foundAnything) process.stdout.write('✓\n')
    else process.stdout.write('  no images found\n')

    await sleep(1_000)
  }

  console.log('\n─────────────────────────────────────────')
  console.log(`Course maps uploaded:   ${mapCount}`)
  console.log(`Hole images uploaded:   ${holeImgCount}`)
  console.log(`Clubs processed:        ${guides.length}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
