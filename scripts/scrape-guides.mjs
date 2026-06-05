#!/usr/bin/env node
/**
 * Scrapes each club's website and stores course guide info in `course_guides`.
 * Run after seed-clubs.mjs:
 *   node scripts/scrape-guides.mjs
 *
 * Rate-limited to 1 request per 2 seconds out of courtesy to club servers.
 * Failed scrapes are stored with scrape_status='failed' so the club still
 * appears in the UI without a guide.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function scrapeClub(club) {
  if (!club.website) return { scrape_status: 'failed', scrape_error: 'no website' }

  try {
    const res = await fetch(club.website, {
      headers: {
        'User-Agent':
          'OSMCourseInfo/1.0 (+https://github.com/adrianb3333/osm-course-info; golf course directory)',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    })

    if (!res.ok) {
      return { scrape_status: 'failed', scrape_error: `HTTP ${res.status}` }
    }

    const html = await res.text()
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

    const contentEl =
      root.querySelector('.entry-content') ??
      root.querySelector('article') ??
      root.querySelector('main')

    const courseHtml = contentEl?.innerHTML?.slice(0, 10_000) ?? null

    return {
      description: description || null,
      hero_image_url: heroImg,
      course_description_html: courseHtml,
      scrape_status: 'success',
    }
  } catch (err) {
    return { scrape_status: 'failed', scrape_error: String(err.message).slice(0, 200) }
  }
}

async function main() {
  const { data: clubs, error } = await supabase
    .from('clubs')
    .select('id, name, website')
    .order('name')

  if (error) {
    console.error('Failed to load clubs:', error.message)
    process.exit(1)
  }

  console.log(`Scraping ${clubs.length} clubs (2s delay between requests)...\n`)

  let success = 0
  let failed = 0

  for (const club of clubs) {
    process.stdout.write(`  ${club.name}... `)

    const scraped = await scrapeClub(club)
    const guide = {
      club_id: club.id,
      source_url: club.website,
      scraped_at: new Date().toISOString(),
      ...scraped,
    }

    const { error: upsertError } = await supabase
      .from('course_guides')
      .upsert(guide, { onConflict: 'club_id' })

    if (upsertError) {
      console.log(`DB ERROR: ${upsertError.message}`)
    } else if (scraped.scrape_status === 'success') {
      console.log('ok')
      success++
    } else {
      console.log(`skipped (${scraped.scrape_error})`)
      failed++
    }

    await sleep(2_000)
  }

  console.log(`\nDone. ${success} scraped successfully, ${failed} skipped.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
