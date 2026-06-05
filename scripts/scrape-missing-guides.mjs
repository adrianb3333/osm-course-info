#!/usr/bin/env node
/**
 * Targeted banguide scraper for clubs that have a website but no 18-hole data.
 * Tries multiple URL patterns, then navigates the site following links.
 * Handles:
 *   - HTML tables (par/dist/hcp columns)
 *   - Bootstrap tabs (#hole-1 … #hole-18) with images
 *   - Div/section-based layouts
 *
 * Run: node scripts/scrape-missing-guides.mjs
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

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; osm-course-info/1.0)',
  Accept: 'text/html,application/xhtml+xml',
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ─── Candidate URL paths ──────────────────────────────────────────────────────

const GUIDE_PATHS = [
  '/banguide',
  '/spela/banguide',
  '/bana/banguide',
  '/golf/banguide',
  '/banan/banguide',
  '/spela/banan',
  '/banguide-och-scorecard',
  '/banguide-scorecard',
  '/course-guide',
  '/course',
  '/the-course',
  '/holes',
  '/banan',
  '/om-banan',
  '/baninfo',
  '/golfbanan',
  '/bana',
  '/play/course-guide',
  '/play/the-course',
  '/spela',
]

const GUIDE_LINK_RE =
  /banguide|course.?guide|course.?map|banan|hole.?by.?hole|om[- ]banan|baninfo|scorecard|h[aå]linformation/i

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(12_000),
      redirect: 'follow',
    })
    if (!res.ok) return null
    return { html: await res.text(), finalUrl: res.url }
  } catch {
    return null
  }
}

function base(website) {
  try { return new URL(website).origin } catch { return null }
}

async function findGuidePage(website) {
  const origin = base(website)
  if (!origin) return null

  // 1. Try known paths
  for (const path of GUIDE_PATHS) {
    const result = await fetchPage(origin + path)
    if (result && looksLikeGuide(result.html)) return result
    await sleep(250)
  }

  // 2. Crawl home page links
  const home = await fetchPage(website)
  if (!home) return null

  const root = parse(home.html)
  const hrefs = [...new Set(
    root.querySelectorAll('a[href]')
      .map(a => a.getAttribute('href'))
      .filter(h => h && GUIDE_LINK_RE.test(h))
  )]

  for (const href of hrefs.slice(0, 8)) {
    let url
    try { url = new URL(href, origin).toString() } catch { continue }
    const result = await fetchPage(url)
    if (result && looksLikeGuide(result.html)) return result
    await sleep(250)
  }

  // 3. Also check if the home page itself is the guide (some clubs do this)
  if (looksLikeGuide(home.html)) return home

  return null
}

// ─── Guide detection ──────────────────────────────────────────────────────────

function looksLikeGuide(html) {
  const pars = (html.match(/\b[345]\b/g) ?? []).length
  const holeRefs = (html.match(/\b(h[aå]l|hole|hål)\b/gi) ?? []).length
  const hasTable = /<table/i.test(html)
  const hasBootstrapHoles = /id=["']hole-\d+["']/i.test(html)
  return hasBootstrapHoles || ((pars >= 10 || hasTable) && holeRefs >= 1)
}

// ─── Bootstrap tabs extraction (Hulta / LBC Borås style) ─────────────────────

function extractBootstrapHoles(html, pageUrl, clubId) {
  const root = parse(html)
  const holes = []

  for (let n = 1; n <= 18; n++) {
    const pane = root.querySelector(`#hole-${n}`)
    if (!pane) continue

    const imgs = pane.querySelectorAll('img[src]')
    const holeImg = imgs.length >= 2 ? imgs[1] : imgs[0]
    let imgUrl = null
    if (holeImg) {
      const src = holeImg.getAttribute('src')
      if (src && !src.includes('logo')) {
        try { imgUrl = new URL(src, pageUrl).toString() } catch { /* skip */ }
      }
    }

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
  return holes.length >= 9 ? holes : []
}

// ─── Table extraction ─────────────────────────────────────────────────────────

function extractTableHoles(html, clubId) {
  const root = parse(html)

  for (const table of root.querySelectorAll('table')) {
    const holes = parseHoleTable(table, clubId)
    if (holes.length >= 9) return holes
  }
  return []
}

function parseHoleTable(table, clubId) {
  const rows = table.querySelectorAll('tr')
  if (rows.length < 9) return []

  let holeCol = 0, parCol = -1, distCol = -1, hcpCol = -1

  const headers = rows[0].querySelectorAll('th,td').map(c => c.text.trim().toLowerCase())
  for (let i = 0; i < headers.length; i++) {
    if (/^(hål|hole|h[aå]l|nr|#)$/i.test(headers[i])) holeCol = i
    if (/^(par)$/i.test(headers[i])) parCol = i
    if (/^(meter|metres?|meters?|m|längd|length|dist(ance)?)$/i.test(headers[i])) distCol = i
    if (/^(hcp|handicap|index|si)$/i.test(headers[i])) hcpCol = i
  }

  // Infer par column from values if not found
  if (parCol === -1) {
    for (let col = 0; col < headers.length; col++) {
      let parCount = 0
      for (let r = 1; r < Math.min(rows.length, 20); r++) {
        const v = parseInt(rows[r].querySelectorAll('td,th')[col]?.text.trim(), 10)
        if (v >= 3 && v <= 5) parCount++
      }
      if (parCount >= 9) { parCol = col; break }
    }
  }

  const holes = []
  for (const row of rows) {
    const cells = row.querySelectorAll('td,th')
    if (cells.length < 2) continue
    const holeNum = parseInt(cells[holeCol]?.text.trim(), 10)
    if (!holeNum || holeNum < 1 || holeNum > 18) continue
    const par = parCol >= 0 ? parseInt(cells[parCol]?.text.trim(), 10) : null
    const dist = distCol >= 0
      ? parseInt(cells[distCol]?.text.trim(), 10)
      : inferDist(cells)
    const hcp = hcpCol >= 0 ? parseInt(cells[hcpCol]?.text.trim(), 10) : null
    if (!par && !dist) continue
    holes.push({
      club_id: clubId,
      hole_number: holeNum,
      par: (par >= 3 && par <= 5) ? par : null,
      distance_m: (dist > 30 && dist < 700) ? dist : null,
      distance_y: null,
      handicap: (hcp >= 1 && hcp <= 18) ? hcp : null,
      image_url: null,
    })
  }
  return holes
}

function inferDist(cells) {
  for (const c of cells) {
    const v = parseInt(c.text.trim(), 10)
    if (v > 50 && v < 700) return v
  }
  return null
}

// ─── Div/section extraction ───────────────────────────────────────────────────

function extractDivHoles(html, clubId) {
  const root = parse(html)
  const holes = []
  const seen = new Set()

  const candidates = root.querySelectorAll(
    'h2,h3,h4,.hole-title,.hole-header,.hole-name,[class*="hole"],[class*="hal"],[class*="hål"]'
  )

  for (const el of candidates) {
    const text = el.text.trim()
    const m = text.match(/^(hål|hole)\s*(\d{1,2})$/i) || text.match(/^(\d{1,2})$/)
    if (!m) continue
    const holeNum = parseInt(m[m.length - 1], 10)
    if (holeNum < 1 || holeNum > 18 || seen.has(holeNum)) continue
    seen.add(holeNum)

    const ctx = (el.parentNode?.text ?? '').replace(/\s+/g, ' ')
    const parM = ctx.match(/par\s*[:\-]?\s*([345])/i)
    const distM = ctx.match(/(\d{2,3})\s*(m\b|meter)/i)

    holes.push({
      club_id: clubId,
      hole_number: holeNum,
      par: parM ? parseInt(parM[1], 10) : null,
      distance_m: distM ? parseInt(distM[1], 10) : null,
      distance_y: null,
      handicap: null,
      image_url: null,
    })
  }
  return holes.length >= 9 ? holes : []
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Load clubs that have a website but no hole 18 yet
  const { data: clubs18 } = await supabase.from('holes').select('club_id').eq('hole_number', 18)
  const ids18 = clubs18.map(r => r.club_id)

  let query = supabase.from('clubs').select('id, name, website').not('website', 'is', null).order('name')
  if (ids18.length) query = query.not('id', 'in', `(${ids18.join(',')})`)

  const { data: clubs, error } = await query
  if (error) { console.error(error.message); process.exit(1) }

  console.log(`Scraping ${clubs.length} clubs with website but no 18-hole guide...\n`)

  let found = 0, withHoles = 0, noGuide = 0

  for (const club of clubs) {
    process.stdout.write(`  ${club.name}... `)

    const page = await findGuidePage(club.website)

    if (!page) {
      console.log('no guide found')
      noGuide++
      await sleep(800)
      continue
    }

    found++

    // Try extraction strategies in order of richness
    let holes = extractBootstrapHoles(page.html, page.finalUrl, club.id)
    if (!holes.length) holes = extractTableHoles(page.html, club.id)
    if (!holes.length) holes = extractDivHoles(page.html, club.id)

    const hasImages = holes.some(h => h.image_url)

    if (holes.length > 0) {
      const { error: hErr } = await supabase
        .from('holes')
        .upsert(holes, { onConflict: 'club_id,hole_number' })
      if (hErr) {
        console.log(`⚠ DB error: ${hErr.message}`)
      } else {
        withHoles++
        process.stdout.write(`${holes.length} holes${hasImages ? ' + images' : ''} ✓\n`)
      }
    } else {
      process.stdout.write('guide found, no structured holes\n')
    }

    // Update/insert course guide record
    const meta = extractMeta(page.html)
    await supabase.from('course_guides').upsert({
      club_id: club.id,
      source_url: club.website,
      guide_url: page.finalUrl,
      description: meta.description,
      hero_image_url: meta.hero_image_url,
      scraped_at: new Date().toISOString(),
      scrape_status: holes.length > 0 ? 'success' : 'guide_only',
      scrape_error: null,
    }, { onConflict: 'club_id' })

    await sleep(1_200)
  }

  console.log('\n─────────────────────────────────────────')
  console.log(`Guide pages found:    ${found}`)
  console.log(`Clubs with hole data: ${withHoles}`)
  console.log(`No guide found:       ${noGuide}`)
  console.log(`Total processed:      ${clubs.length}`)
}

function extractMeta(html) {
  const root = parse(html)
  root.querySelectorAll('script,style,nav,footer,header,aside').forEach(el => el.remove())
  const description = (
    root.querySelector('meta[name="description"]')?.getAttribute('content') ??
    root.querySelector('meta[property="og:description"]')?.getAttribute('content') ??
    root.querySelector('main p')?.text ??
    ''
  ).trim().slice(0, 500)
  const hero_image_url =
    root.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? null
  return { description: description || null, hero_image_url }
}

main().catch(err => { console.error(err); process.exit(1) })
