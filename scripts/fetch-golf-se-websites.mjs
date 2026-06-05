#!/usr/bin/env node
/**
 * Fetches club websites from golf.se by scraping each club's profile page.
 * golf.se has individual club pages at /golfklubbar/{slug} via their Strife CMS.
 * Updates clubs.website for any club currently missing one.
 *
 * Run: node scripts/fetch-golf-se-websites.mjs
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

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; osm-course-info/1.0)', Accept: 'text/html' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function normalise(str) {
  return str
    .toLowerCase()
    .replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o')
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/é/g, 'e')
    .replace(/[&+]/g, '-').replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

function golfSeSlugVariants(name) {
  const base = normalise(name)
  const variants = new Set([base])

  // golf.se uses patterns like:
  //   "Stockholms Golfklubb" → "stockholms-golfklubb"
  //   "Barsebäck Golf & Resort" → "barseback-golf-resort"
  const stripped = base
    .replace(/-golfklubb$/, '').replace(/-golf-club$/, '')
    .replace(/-golf-resort$/, '').replace(/-gk$/, '')
    .replace(/-golf$/, '').replace(/-gc$/, '')

  if (stripped !== base) {
    variants.add(stripped + '-golfklubb')
    variants.add(stripped + '-golf-club')
    variants.add(stripped + '-golf')
    variants.add(stripped)
  }
  return [...variants]
}

async function fetchGolfSeClubWebsite(name) {
  const slugs = golfSeSlugVariants(name)

  for (const slug of slugs) {
    const url = `https://golf.se/golfklubbar/${slug}/`
    try {
      const res = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(10_000),
        redirect: 'follow',
      })
      if (!res.ok) continue

      const html = await res.text()
      const root = parse(html)

      // Look for the club's external website link in the page
      // golf.se club pages typically have a "Webbplats" link
      const links = root.querySelectorAll('a[href]')
      for (const link of links) {
        const href = link.getAttribute('href') ?? ''
        const text = link.text.trim().toLowerCase()
        if (
          /^https?:\/\//.test(href) &&
          !href.includes('golf.se') &&
          !href.includes('facebook') &&
          !href.includes('instagram') &&
          !href.includes('twitter') &&
          (text.includes('webbplats') || text.includes('hemsida') ||
           text.includes('website') || text.includes('homepage') ||
           text.includes('besök') || link.closest('.contact') !== null)
        ) {
          return href
        }
      }

      // Fallback: look for og:url or canonical that points to an external domain
      const ogUrl = root.querySelector('meta[property="og:url"]')?.getAttribute('content')
      if (ogUrl && !ogUrl.includes('golf.se')) return ogUrl

      // Second fallback: find any external link in a "kontakt" or "info" section
      const contactSection = root.querySelector('[class*="contact"], [class*="kontakt"], [id*="contact"]')
      if (contactSection) {
        const extLink = contactSection.querySelector('a[href^="http"]')
        const href = extLink?.getAttribute('href')
        if (href && !href.includes('golf.se')) return href
      }

      return null // Page exists but no external website found
    } catch {
      // try next slug
    }
    await sleep(200)
  }
  return undefined // no page found at all
}

async function main() {
  // Only process clubs without a website
  const { data: clubs, error } = await supabase
    .from('clubs')
    .select('id, name')
    .is('website', null)
    .order('name')

  if (error) { console.error(error.message); process.exit(1) }
  console.log(`Looking up ${clubs.length} clubs without websites on golf.se...\n`)

  let found = 0
  let notFound = 0

  for (const club of clubs) {
    process.stdout.write(`  ${club.name}... `)
    const website = await fetchGolfSeClubWebsite(club.name)

    if (website) {
      await supabase.from('clubs').update({ website }).eq('id', club.id)
      console.log(website)
      found++
    } else if (website === null) {
      console.log('(page found, no website link)')
    } else {
      console.log('not found')
      notFound++
    }
    await sleep(500)
  }

  console.log('\n─────────────────────────────────────────')
  console.log(`Websites found:   ${found}`)
  console.log(`Not found:        ${notFound}`)
  console.log(`Clubs processed:  ${clubs.length}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
