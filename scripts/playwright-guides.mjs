#!/usr/bin/env node
/**
 * Headless Chromium scraper for Swedish clubs that have a website but no 18-hole guide.
 * Uses Playwright to fully render JavaScript before extracting hole data.
 *
 * Targets: clubs with .se or .nu websites, missing hole 18 in DB.
 *
 * Run: node scripts/playwright-guides.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ─── URL discovery paths ───────────────────────────────────────────────────────

const GUIDE_PATHS = [
  '/banguide', '/spela/banguide', '/bana/banguide', '/golf/banguide',
  '/banan/banguide', '/spela/banan', '/banguide-och-scorecard',
  '/banguide-scorecard', '/course-guide', '/course', '/the-course',
  '/holes', '/banan', '/om-banan', '/baninfo', '/golfbanan', '/bana',
  '/play/course-guide', '/play/the-course', '/spela',
]

const GUIDE_LINK_RE =
  /banguide|course.?guide|course.?map|h[åa]linformation|hole.?by.?hole|om[- ]banan|baninfo|scorecard/i

// ─── Extraction — runs inside the browser page context ───────────────────────

async function extractHolesFromPage(page, clubId) {
  return page.evaluate((clubId) => {
    const holes = []

    // ── Strategy 1: Bootstrap tabs (#hole-1 … #hole-18) ─────────────────────
    let bootstrapCount = 0
    for (let n = 1; n <= 18; n++) {
      const pane = document.getElementById(`hole-${n}`)
      if (!pane) continue
      bootstrapCount++

      const imgs = pane.querySelectorAll('img[src]')
      const holeImg = imgs.length >= 2 ? imgs[1] : imgs[0]
      let imgUrl = null
      if (holeImg) {
        const src = holeImg.getAttribute('src')
        if (src && !src.toLowerCase().includes('logo')) {
          try { imgUrl = new URL(src, location.href).toString() } catch { /* skip */ }
        }
      }

      const text = pane.innerText || pane.textContent || ''
      const parM = text.match(/par\s*[:\-]?\s*([345])/i)
      const idxM = text.match(/index\s*[:\-]?\s*(\d{1,2})/i)
      const distM = text.match(/(\d{3,4})\s*m\b/i)

      holes.push({
        club_id: clubId, hole_number: n,
        par: parM ? parseInt(parM[1]) : null,
        handicap: idxM ? parseInt(idxM[1]) : null,
        distance_m: distM ? parseInt(distM[1]) : null,
        distance_y: null, image_url: imgUrl,
      })
    }
    if (bootstrapCount >= 9) return holes

    holes.length = 0

    // ── Strategy 2: HTML tables ──────────────────────────────────────────────
    for (const table of document.querySelectorAll('table')) {
      const rows = Array.from(table.querySelectorAll('tr'))
      if (rows.length < 9) continue

      // Identify columns from header row
      let holeCol = 0, parCol = -1, distCol = -1, hcpCol = -1
      const headerCells = Array.from(rows[0].querySelectorAll('th,td'))
        .map(c => (c.innerText || c.textContent || '').trim().toLowerCase())

      for (let i = 0; i < headerCells.length; i++) {
        if (/^(hål|hole|nr|#)$/i.test(headerCells[i])) holeCol = i
        if (/^par$/i.test(headerCells[i])) parCol = i
        if (/^(meter|metres?|meters?|m|längd|length|dist(ance)?)$/i.test(headerCells[i])) distCol = i
        if (/^(hcp|handicap|index|si)$/i.test(headerCells[i])) hcpCol = i
      }

      // Infer par column by values if not found
      if (parCol === -1) {
        for (let col = 0; col < headerCells.length; col++) {
          let parCount = 0
          for (let r = 1; r < Math.min(rows.length, 20); r++) {
            const v = parseInt((rows[r].querySelectorAll('td,th')[col]?.innerText || '').trim())
            if (v >= 3 && v <= 5) parCount++
          }
          if (parCount >= 9) { parCol = col; break }
        }
      }

      const tableHoles = []
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td,th'))
        if (cells.length < 2) continue
        const holeNum = parseInt((cells[holeCol]?.innerText || '').trim())
        if (!holeNum || holeNum < 1 || holeNum > 18) continue
        const par = parCol >= 0 ? parseInt((cells[parCol]?.innerText || '').trim()) : null
        let dist = distCol >= 0 ? parseInt((cells[distCol]?.innerText || '').trim()) : null
        if (!dist) {
          for (const c of cells) {
            const v = parseInt((c.innerText || '').trim())
            if (v > 50 && v < 700) { dist = v; break }
          }
        }
        const hcp = hcpCol >= 0 ? parseInt((cells[hcpCol]?.innerText || '').trim()) : null
        if (!par && !dist) continue
        tableHoles.push({
          club_id: clubId, hole_number: holeNum,
          par: (par >= 3 && par <= 5) ? par : null,
          distance_m: (dist > 30 && dist < 700) ? dist : null,
          distance_y: null,
          handicap: (hcp >= 1 && hcp <= 18) ? hcp : null,
          image_url: null,
        })
      }
      if (tableHoles.length >= 9) return tableHoles
    }

    // ── Strategy 3: Rendered div/card layouts ────────────────────────────────
    const seen = new Set()
    const divHoles = []
    const selectors = [
      '[class*="hole"]', '[class*="hål"]', '[class*="hal-"]',
      '[data-hole]', '[id*="hole-"]',
    ]
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const text = (el.innerText || el.textContent || '').trim()
        const numM = text.match(/^(\d{1,2})\b/) ||
          text.match(/h[åa]l\s*(\d{1,2})/i) ||
          text.match(/hole\s*(\d{1,2})/i)
        if (!numM) continue
        const holeNum = parseInt(numM[1])
        if (holeNum < 1 || holeNum > 18 || seen.has(holeNum)) continue
        seen.add(holeNum)
        const parM = text.match(/par\s*[:\-]?\s*([345])/i)
        const distM = text.match(/(\d{3,4})\s*m\b/i)
        const hcpM = text.match(/(?:hcp|handicap|index)\s*[:\-]?\s*(\d{1,2})/i)

        // Look for image in element
        const img = el.querySelector('img[src]')
        let imgUrl = null
        if (img) {
          try { imgUrl = new URL(img.getAttribute('src'), location.href).toString() } catch { /* skip */ }
        }

        divHoles.push({
          club_id: clubId, hole_number: holeNum,
          par: parM ? parseInt(parM[1]) : null,
          distance_m: distM ? parseInt(distM[1]) : null,
          distance_y: null,
          handicap: hcpM ? parseInt(hcpM[1]) : null,
          image_url: imgUrl,
        })
      }
      if (divHoles.length >= 9) return divHoles
    }

    return []
  }, clubId)
}

// ─── Find the banguide page ───────────────────────────────────────────────────

async function findAndExtract(page, website, clubId) {
  let origin
  try { origin = new URL(website).origin } catch { return null }

  // 1. Try known paths
  for (const path of GUIDE_PATHS) {
    try {
      const res = await page.goto(origin + path, { waitUntil: 'networkidle', timeout: 15_000 })
      if (!res || !res.ok()) continue

      // Wait a bit extra for JS frameworks to render
      await sleep(1_500)

      if (await looksLikeGuide(page)) {
        const holes = await extractHolesFromPage(page, clubId)
        if (holes.length >= 9) return { holes, url: page.url() }
      }
    } catch { /* timeout or nav error, try next */ }
    await sleep(300)
  }

  // 2. Crawl home page for guide links
  try {
    await page.goto(website, { waitUntil: 'networkidle', timeout: 15_000 })
    await sleep(1_000)

    const guideLinks = await page.evaluate((re) => {
      return Array.from(document.querySelectorAll('a[href]'))
        .map(a => a.href)
        .filter(href => href && new RegExp(re).test(href))
        .slice(0, 6)
    }, GUIDE_LINK_RE.source)

    for (const href of guideLinks) {
      try {
        await page.goto(href, { waitUntil: 'networkidle', timeout: 15_000 })
        await sleep(1_500)
        if (await looksLikeGuide(page)) {
          const holes = await extractHolesFromPage(page, clubId)
          if (holes.length >= 9) return { holes, url: page.url() }
        }
      } catch { /* skip */ }
      await sleep(300)
    }
  } catch { /* skip home page crawl */ }

  return null
}

async function looksLikeGuide(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText || ''
    const html = document.body?.innerHTML || ''
    const pars = (text.match(/\b[345]\b/g) ?? []).length
    const holeRefs = (text.match(/\b(h[åa]l|hole)\b/gi) ?? []).length
    const hasTable = /<table/i.test(html)
    const hasBootstrap = /id=["']hole-\d+["']/i.test(html)
    const hasHoleClass = /class=["'][^"']*hole[^"']*["']/i.test(html)
    return hasBootstrap || hasHoleClass || ((pars >= 10 || hasTable) && holeRefs >= 1)
  })
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { data: clubs18 } = await supabase.from('holes').select('club_id').eq('hole_number', 18)
  const ids18 = clubs18.map(r => r.club_id)

  const { data: clubs, error } = await supabase
    .from('clubs').select('id, name, website')
    .not('id', 'in', `(${ids18.join(',')})`)
    .not('website', 'is', null)
    .order('name')
  if (error) { console.error(error.message); process.exit(1) }

  // Swedish only
  const targets = clubs.filter(c => {
    try { const h = new URL(c.website).hostname; return /\.(se|nu)$/.test(h) }
    catch { return false }
  })

  console.log(`Playwright scraping ${targets.length} Swedish clubs...\n`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'sv-SE',
    timezoneId: 'Europe/Stockholm',
  })

  let found = 0, withHoles = 0

  for (const club of targets) {
    const page = await context.newPage()
    // Block images/fonts/media to speed up loading
    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,mp4,mp3}', r => r.abort())

    process.stdout.write(`  ${club.name}... `)

    try {
      const result = await findAndExtract(page, club.website, club.id)

      if (!result || result.holes.length === 0) {
        console.log('no guide found')
      } else {
        found++
        const { error: hErr } = await supabase
          .from('holes').upsert(result.holes, { onConflict: 'club_id,hole_number' })
        if (hErr) {
          console.log(`⚠ DB: ${hErr.message}`)
        } else {
          withHoles++
          const hasImg = result.holes.some(h => h.image_url)
          console.log(`${result.holes.length} holes${hasImg ? ' + images' : ''} ✓`)
        }

        // Upsert course guide record
        const meta = await page.evaluate(() => ({
          description: document.querySelector('meta[name="description"]')?.content
            || document.querySelector('meta[property="og:description"]')?.content
            || null,
          hero: document.querySelector('meta[property="og:image"]')?.content || null,
        }))

        await supabase.from('course_guides').upsert({
          club_id: club.id,
          source_url: club.website,
          guide_url: result.url,
          description: meta.description?.slice(0, 500) || null,
          hero_image_url: meta.hero || null,
          scraped_at: new Date().toISOString(),
          scrape_status: 'success',
          scrape_error: null,
        }, { onConflict: 'club_id' })
      }
    } catch (err) {
      console.log(`error: ${err.message?.slice(0, 60)}`)
    }

    await page.close()
    await sleep(800)
  }

  await browser.close()

  console.log('\n─────────────────────────────────────────')
  console.log(`Guides found:         ${found}`)
  console.log(`Clubs with hole data: ${withHoles}`)
  console.log(`Total processed:      ${targets.length}`)
}

main().catch(err => { console.error(err); process.exit(1) })
