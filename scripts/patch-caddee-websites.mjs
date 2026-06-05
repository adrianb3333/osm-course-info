#!/usr/bin/env node
/**
 * One-time fix: the Caddee fetch used caddeeClub.website but the field is caddeeClub.url.
 * Re-probes Caddee for every club still missing a website and saves the URL.
 *
 * Run: node scripts/patch-caddee-websites.mjs
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

function normalise(str) {
  return str
    .toLowerCase()
    .replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o')
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/é/g, 'e')
    .replace(/ü/g, 'u').replace(/ó/g, 'o').replace(/ñ/g, 'n')
    .replace(/[&+]/g, '-').replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

function slugVariants(name) {
  const base = normalise(name)
  const variants = new Set([base])
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
  if (!base.includes('golf')) {
    variants.add(base + '-golf')
    variants.add(base + '-golfklubb')
  }
  return [...variants].filter((s) => s.length > 2)
}

async function getCaddeeUrl(name) {
  for (const slug of slugVariants(name)) {
    const url = `https://www.caddee.se/klubb/${slug}`
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12_000), redirect: 'follow' })
      if (!res.ok) { await sleep(150); continue }
      const html = await res.text()
      const root = parse(html)
      const scriptEl = root.querySelector('script#__NEXT_DATA__')
      if (!scriptEl) { await sleep(150); continue }
      const data = JSON.parse(scriptEl.text)
      const club = data?.props?.pageProps?.club
      if (!club) { await sleep(150); continue }
      // Caddee stores website in 'url', not 'website'
      return club.url ?? club.website ?? null
    } catch {
      await sleep(150)
    }
  }
  return undefined
}

async function main() {
  const { data: clubs, error } = await supabase
    .from('clubs')
    .select('id, name')
    .is('website', null)
    .order('name')

  if (error) { console.error(error.message); process.exit(1) }
  console.log(`Patching websites for ${clubs.length} clubs via Caddee...\n`)

  let found = 0
  for (const club of clubs) {
    process.stdout.write(`  ${club.name}... `)
    const website = await getCaddeeUrl(club.name)
    if (website) {
      await supabase.from('clubs').update({ website }).eq('id', club.id)
      console.log(website)
      found++
    } else {
      console.log('not found')
    }
    await sleep(600)
  }

  console.log('\n─────────────────────────────────────────')
  console.log(`Websites added: ${found} / ${clubs.length}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
