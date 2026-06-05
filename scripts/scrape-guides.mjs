#!/usr/bin/env node
/**
 * Scrapes each club's website for their course guide / banguide.
 * Finds hole-by-hole data (par, distance, handicap) and stores it in:
 *   - course_guides  (summary + guide URL)
 *   - holes          (one row per hole per club)
 *
 * Run: node scripts/scrape-guides.mjs
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

// ─── Fetching ─────────────────────────────────────────────────────────────────

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(12_000),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const html = await res.text()
    return { html, finalUrl: res.url }
  } catch {
    return null
  }
}

// ─── URL discovery ────────────────────────────────────────────────────────────

// Common Swedish golf site paths for course guides
const GUIDE_PATH_CANDIDATES = [
  '/banguide',
  '/golf/banguide',
  '/banan/banguide',
  '/banan',
  '/course-guide',
  '/om-banan',
  '/om-banorna',
  '/golfbanan',
  '/baninfo',
  '/course',
  '/the-course',
]

const GUIDE_LINK_PATTERN =
  /banguide|bangu[íi]a|course.?guide|course.?map|banan|hole.?by.?hole|om[- ]banan|baninfo/i

function normalizeBase(website) {
  try {
    const u = new URL(website)
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

async function findGuideUrl(website) {
  const base = normalizeBase(website)
  if (!base) return null

  // 1. Try well-known paths first
  for (const path of GUIDE_PATH_CANDIDATES) {
    const candidate = base + path
    const result = await fetchPage(candidate)
    if (result) {
      // Confirm it has hole-like content
      if (looksLikeGuide(result.html)) return { url: result.finalUrl, html: result.html }
    }
    await sleep(300)
  }

  // 2. Scrape the home page and follow matching links
  const home = await fetchPage(website)
  if (!home) return null

  const root = parse(home.html)
  const links = root
    .querySelectorAll('a[href]')
    .map((a) => a.getAttribute('href'))
    .filter(Boolean)

  const guideLinks = links.filter((href) => GUIDE_LINK_PATTERN.test(href))

  for (const href of guideLinks.slice(0, 5)) {
    let fullUrl
    try {
      fullUrl = new URL(href, base).toString()
    } catch {
      continue
    }
    const result = await fetchPage(fullUrl)
    if (result && looksLikeGuide(result.html)) {
      return { url: result.finalUrl, html: result.html }
    }
    await sleep(300)
  }

  return null
}

// ─── Guide detection ──────────────────────────────────────────────────────────

function looksLikeGuide(html) {
  // Must contain at least 3 references to par values (3, 4, or 5) and hole numbers
  const parMatches = (html.match(/\b[345]\b/g) ?? []).length
  const holeMatches = (html.match(/\b(h[aå]l|hole|hål)\b/gi) ?? []).length
  const hasTable = /<table/i.test(html)
  return (parMatches >= 10 || hasTable) && holeMatches >= 1
}

// ─── Hole parsing ─────────────────────────────────────────────────────────────

function parseHoles(html, clubId) {
  const root = parse(html)

  // Strategy 1: Look for a table where rows contain hole numbers 1-18
  const tables = root.querySelectorAll('table')
  for (const table of tables) {
    const holes = extractHolesFromTable(table, clubId)
    if (holes.length >= 9) return holes
  }

  // Strategy 2: Look for repeated divs/sections with hole info
  const holes = extractHolesFromDivs(root, clubId)
  if (holes.length >= 9) return holes

  return []
}

function extractHolesFromTable(table, clubId) {
  const rows = table.querySelectorAll('tr')
  if (rows.length < 9) return []

  // Find header row to identify column positions
  let parCol = -1
  let distCol = -1
  let hcpCol = -1
  let holeCol = 0 // default: first column is hole number

  const headerRow = rows[0]
  const headers = headerRow.querySelectorAll('th,td').map((c) => c.text.trim().toLowerCase())

  for (let i = 0; i < headers.length; i++) {
    if (/^(hål|hole|h[aå]l|nr|#)$/i.test(headers[i])) holeCol = i
    if (/^(par)$/i.test(headers[i])) parCol = i
    if (/^(meter|metres?|meters?|m|längd|length|distance|dist)$/i.test(headers[i])) distCol = i
    if (/^(hcp|handicap|index|si)$/i.test(headers[i])) hcpCol = i
  }

  // If no par column found, try to infer from values in data rows
  if (parCol === -1) {
    for (let col = 0; col < headers.length; col++) {
      let parCount = 0
      for (let r = 1; r < Math.min(rows.length, 19); r++) {
        const cells = rows[r].querySelectorAll('td,th')
        const val = parseInt(cells[col]?.text.trim(), 10)
        if (val >= 3 && val <= 5) parCount++
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
    const rawDist = distCol >= 0 ? cells[distCol]?.text.trim() : null
    const dist = rawDist ? parseInt(rawDist, 10) : tryInferDistance(cells)
    const hcp = hcpCol >= 0 ? parseInt(cells[hcpCol]?.text.trim(), 10) : null

    if (!par && !dist) continue

    holes.push({
      club_id: clubId,
      hole_number: holeNum,
      par: (par >= 3 && par <= 5) ? par : null,
      distance_m: (dist > 30 && dist < 700) ? dist : null,
      distance_y: null,
      handicap: (hcp >= 1 && hcp <= 18) ? hcp : null,
    })
  }

  return holes
}

function tryInferDistance(cells) {
  for (const cell of cells) {
    const val = parseInt(cell.text.trim(), 10)
    if (val > 50 && val < 700) return val
  }
  return null
}

function extractHolesFromDivs(root, clubId) {
  // Look for elements with hole numbers as text + par nearby
  const holes = []
  const holePattern = /^(hål|hole)\s*(\d{1,2})$/i

  const candidates = root.querySelectorAll(
    'h2,h3,h4,.hole-title,.hole-header,.hole-name,[class*="hole"],[class*="hal"],[class*="hål"]'
  )

  for (const el of candidates) {
    const text = el.text.trim()
    const match = text.match(holePattern) || text.match(/^(\d{1,2})$/)
    if (!match) continue

    const holeNum = parseInt(match[match.length - 1], 10)
    if (holeNum < 1 || holeNum > 18) continue

    // Look for par and distance in nearby sibling/parent text
    const context = (el.parentNode?.text ?? '').replace(/\s+/g, ' ')
    const parMatch = context.match(/par\s*[:\-]?\s*([345])/i)
    const distMatch = context.match(/(\d{2,3})\s*(m\b|meter)/i)

    holes.push({
      club_id: clubId,
      hole_number: holeNum,
      par: parMatch ? parseInt(parMatch[1], 10) : null,
      distance_m: distMatch ? parseInt(distMatch[1], 10) : null,
      distance_y: null,
      handicap: null,
    })
  }

  return holes
}

// ─── Metadata extraction ──────────────────────────────────────────────────────

function extractMeta(html) {
  const root = parse(html)
  root.querySelectorAll('script,style,nav,footer,header,aside').forEach((el) => el.remove())

  const description = (
    root.querySelector('meta[name="description"]')?.getAttribute('content') ??
    root.querySelector('meta[property="og:description"]')?.getAttribute('content') ??
    root.querySelector('.entry-content p')?.text ??
    root.querySelector('article p')?.text ??
    root.querySelector('main p')?.text ??
    ''
  ).trim().slice(0, 500)

  const heroImg =
    root.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? null

  return { description: description || null, hero_image_url: heroImg }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { data: clubs, error } = await supabase
    .from('clubs')
    .select('id, name, website')
    .not('website', 'is', null)
    .order('name')

  if (error) { console.error(error.message); process.exit(1) }

  console.log(`Scraping ${clubs.length} clubs with websites...\n`)

  let withGuide = 0
  let withHoles = 0
  let noGuide = 0

  for (const club of clubs) {
    process.stdout.write(`  ${club.name}... `)

    const guideResult = await findGuideUrl(club.website)

    let guideRecord = {
      club_id: club.id,
      source_url: club.website,
      guide_url: null,
      scraped_at: new Date().toISOString(),
      scrape_status: 'failed',
      scrape_error: 'no guide found',
    }

    if (guideResult) {
      const { description, hero_image_url } = extractMeta(guideResult.html)
      const holes = parseHoles(guideResult.html, club.id)

      guideRecord = {
        club_id: club.id,
        source_url: club.website,
        guide_url: guideResult.url,
        description,
        hero_image_url,
        scraped_at: new Date().toISOString(),
        scrape_status: holes.length > 0 ? 'success' : 'guide_only',
        scrape_error: null,
      }

      if (holes.length > 0) {
        // Upsert holes
        const { error: holeErr } = await supabase
          .from('holes')
          .upsert(holes, { onConflict: 'club_id,hole_number' })
        if (holeErr) {
          console.log(`⚠ holes DB error: ${holeErr.message}`)
        } else {
          withHoles++
          process.stdout.write(`${holes.length} holes `)
        }
      }
      withGuide++
      process.stdout.write(holes.length > 0 ? '✓\n' : '(guide found, no structured holes) ✓\n')
    } else {
      noGuide++
      process.stdout.write('no guide\n')
    }

    // Upsert course guide record
    const { error: guideErr } = await supabase
      .from('course_guides')
      .upsert(guideRecord, { onConflict: 'club_id' })
    if (guideErr) console.log(`  ⚠ guide DB error: ${guideErr.message}`)

    await sleep(1_500)
  }

  console.log(`\n─────────────────────────────────────────`)
  console.log(`Clubs with guide found:   ${withGuide}`)
  console.log(`Clubs with hole data:     ${withHoles}`)
  console.log(`No guide found:           ${noGuide}`)
  console.log(`Total clubs processed:    ${clubs.length}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
