#!/usr/bin/env node
/**
 * Discovers which clubs are on Caddee by probing slug variants,
 * then extracts from __NEXT_DATA__:
 *   - club website URL
 *   - hole images (full-res from S3)
 *   - par, handicap, distances per tee for every hole
 *
 * Updates: clubs.website, holes (par/hcp/dist/image_url), course_guides
 *
 * Run: node scripts/fetch-caddee-data.mjs
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

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; osm-course-info/1.0)' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ─── Slug generation ──────────────────────────────────────────────────────────

function normalise(str) {
  return str
    .toLowerCase()
    .replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o')
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/é/g, 'e')
    .replace(/ü/g, 'u').replace(/ó/g, 'o').replace(/ñ/g, 'n')
    .replace(/[&+]/g, '-')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function slugVariants(name) {
  const base = normalise(name)
  const variants = new Set([base])

  // Drop common suffixes to get shorter slug
  const stripped = base
    .replace(/-golfklubb$/, '').replace(/-golf-club$/, '')
    .replace(/-golf-resort$/, '').replace(/-gk$/, '')
    .replace(/-golf$/, '').replace(/-gc$/, '')
    .replace(/-country-club$/, '')
  if (stripped !== base) {
    variants.add(stripped)
    variants.add(stripped + '-golf')
    variants.add(stripped + '-golfklubb')
    variants.add(stripped + '-golf-club')
  }

  // Add golfklubb suffix if not present
  if (!base.includes('golf')) {
    variants.add(base + '-golf')
    variants.add(base + '-golfklubb')
  }

  return [...variants].filter((s) => s.length > 2)
}

// ─── Fetch Caddee page ────────────────────────────────────────────────────────

async function fetchCaddeePage(slug) {
  const url = `https://www.caddee.se/klubb/${slug}`
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(12_000),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const html = await res.text()

    // Extract __NEXT_DATA__
    const root = parse(html)
    const scriptEl = root.querySelector('script#__NEXT_DATA__')
    if (!scriptEl) return null

    const data = JSON.parse(scriptEl.text)
    const club = data?.props?.pageProps?.club
    if (!club) return null

    return { club, pageUrl: url }
  } catch {
    return null
  }
}

// ─── Parse hole data from Caddee club JSON ────────────────────────────────────

function extractHolesFromCaddee(caddeeCourse, clubId) {
  const holes = []
  for (const hole of caddeeCourse.holes ?? []) {
    const distM = hole.tees?.find((t) =>
      /gul|yellow|white|vit|blå|blue/i.test(t.name)
    )?.length ?? hole.tees?.[0]?.length ?? null

    holes.push({
      club_id: clubId,
      hole_number: hole.number,
      par: hole.par ?? null,
      handicap: hole.index ?? null,
      distance_m: distM,
      distance_y: null,
      image_url: hole.detail_image?.normal ?? null,
    })
  }
  return holes
}

// ─── Bootstrap-tabs style scraper (Hulta/LBC style) ──────────────────────────

function extractHolesFromBootstrapTabs(html, pageUrl, clubId) {
  const root = parse(html)
  const holes = []

  for (let n = 1; n <= 18; n++) {
    const pane = root.querySelector(`#hole-${n}`)
    if (!pane) continue

    // Skip first img (usually logo), take second (hole diagram)
    const imgs = pane.querySelectorAll('img[src]')
    const holeImg = imgs.length >= 2 ? imgs[1] : imgs[0]
    if (!holeImg) continue

    const rawSrc = holeImg.getAttribute('src')
    if (!rawSrc || rawSrc.includes('logo')) continue

    // Resolve relative URL
    let imgUrl
    try { imgUrl = new URL(rawSrc, pageUrl).toString() } catch { continue }

    // Extract par and index from the pane text
    const text = pane.text
    const parMatch = text.match(/par\s*[:\-]?\s*([345])/i)
    const idxMatch = text.match(/index\s*[:\-]?\s*(\d{1,2})/i)
    const distMatch = text.match(/(\d{3,4})\s*m\b/i)

    holes.push({
      club_id: clubId,
      hole_number: n,
      par: parMatch ? parseInt(parMatch[1], 10) : null,
      handicap: idxMatch ? parseInt(idxMatch[1], 10) : null,
      distance_m: distMatch ? parseInt(distMatch[1], 10) : null,
      distance_y: null,
      image_url: imgUrl,
    })
  }
  return holes
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Load all clubs
  const { data: clubs, error } = await supabase
    .from('clubs')
    .select('id, name, website, city')
    .order('name')
  if (error) { console.error(error.message); process.exit(1) }

  console.log(`Processing ${clubs.length} clubs...\n`)

  let caddeeFound = 0
  let websitesAdded = 0
  let holesUpserted = 0

  for (const club of clubs) {
    const variants = slugVariants(club.name)
    let caddeeResult = null

    // Probe each slug variant
    for (const slug of variants) {
      const result = await fetchCaddeePage(slug)
      if (result) { caddeeResult = result; break }
      await sleep(200)
    }

    if (!caddeeResult) {
      // ── Fallback: check existing guide_url for Bootstrap tabs ──────────────
      const { data: guide } = await supabase
        .from('course_guides')
        .select('guide_url')
        .eq('club_id', club.id)
        .single()

      if (guide?.guide_url) {
        try {
          const res = await fetch(guide.guide_url, { headers: HEADERS, signal: AbortSignal.timeout(12_000) })
          if (res.ok) {
            const html = await res.text()
            if (html.includes('id="hole-1"') || html.includes("id='hole-1'")) {
              const holes = extractHolesFromBootstrapTabs(html, res.url, club.id)
              if (holes.length >= 9) {
                const { error: hErr } = await supabase
                  .from('holes')
                  .upsert(holes, { onConflict: 'club_id,hole_number' })
                if (!hErr) {
                  holesUpserted += holes.length
                  console.log(`  ${club.name}: ${holes.length} holes via Bootstrap tabs ✓`)
                }
              }
            }
          }
        } catch { /* skip */ }
      }
      await sleep(300)
      continue
    }

    caddeeFound++
    const { club: caddeeClub } = caddeeResult

    // Update website if missing (Caddee uses 'url', not 'website')
    const caddeeWebsite = caddeeClub.url ?? caddeeClub.website ?? null
    if (!club.website && caddeeWebsite) {
      await supabase.from('clubs').update({ website: caddeeWebsite }).eq('id', club.id)
      websitesAdded++
    }

    process.stdout.write(`  ${club.name} [Caddee] `)

    // Process each course (most clubs have 1, some have 2-3)
    for (const course of caddeeClub.courses ?? []) {
      const holes = extractHolesFromCaddee(course, club.id)
      if (holes.length === 0) continue

      const { error: hErr } = await supabase
        .from('holes')
        .upsert(holes, { onConflict: 'club_id,hole_number' })
      if (!hErr) holesUpserted += holes.length

      // Upsert course guide
      const guideRecord = {
        club_id: club.id,
        source_url: caddeeWebsite ?? club.website,
        guide_url: `https://www.caddee.se/klubb/${slugVariants(club.name)[0]}`,
        description: course.description ?? null,
        hero_image_url: course.overview_image?.normal ?? null,
        scraped_at: new Date().toISOString(),
        scrape_status: 'success',
      }
      await supabase.from('course_guides').upsert(guideRecord, { onConflict: 'club_id' })
    }

    console.log(`${(caddeeClub.courses?.[0]?.holes?.length ?? 0)} holes ✓`)
    await sleep(800)
  }

  console.log('\n─────────────────────────────────────────')
  console.log(`Clubs found on Caddee:   ${caddeeFound}`)
  console.log(`Websites added:          ${websitesAdded}`)
  console.log(`Hole rows upserted:      ${holesUpserted}`)
  console.log(`Total clubs processed:   ${clubs.length}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
