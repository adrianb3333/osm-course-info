#!/usr/bin/env node
/**
 * Targeted Caddee retry for Swedish clubs (.se websites) that still lack 18 holes.
 * Uses broader slug variants than the original run to catch missed matches.
 *
 * Run: node scripts/retry-caddee-swedish.mjs
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
  return str.toLowerCase()
    .replace(/å/g,'a').replace(/ä/g,'a').replace(/ö/g,'o')
    .replace(/ø/g,'o').replace(/æ/g,'ae').replace(/é/g,'e')
    .replace(/ü/g,'u').replace(/[&+]/g,'-')
    .replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-')
    .replace(/-+/g,'-').replace(/^-|-$/g,'')
}

function slugVariants(name) {
  // Strip parenthetical suffixes: "Jarlabanke GK (Prästgården)" → "Jarlabanke GK"
  const cleanName = name.replace(/\s*\(.*?\)\s*/g, '').replace(/\s*;.*$/, '').trim()
  const base = normalise(cleanName)
  const variants = new Set([base])

  const suffixes = ['-golfklubb','-golf-club','-golf-resort','-gk','-golf','-gc','-country-club','-golfcenter','-golf-center']
  let stripped = base
  for (const s of suffixes) {
    if (base.endsWith(s)) { stripped = base.slice(0, -s.length); break }
  }

  if (stripped !== base) {
    variants.add(stripped)
    variants.add(stripped + '-golf')
    variants.add(stripped + '-golfklubb')
    variants.add(stripped + '-golf-club')
    variants.add(stripped + '-gk')
  }
  if (!base.includes('golf') && !base.includes('gk')) {
    variants.add(base + '-golf')
    variants.add(base + '-golfklubb')
  }

  // Also try original (un-cleaned) name slug
  const origBase = normalise(name)
  if (origBase !== base) {
    variants.add(origBase)
    const origStripped = origBase.replace(/-golfklubb$/,'').replace(/-gk$/,'').replace(/-golf$/,'')
    if (origStripped !== origBase) variants.add(origStripped)
  }

  return [...variants].filter(s => s.length > 2)
}

function extractHoles(caddeeClub, clubId) {
  const holes = []
  for (const course of caddeeClub.courses ?? []) {
    for (const hole of course.holes ?? []) {
      const distM = hole.tees?.find(t => /gul|yellow|white|vit|blå|blue/i.test(t.name))?.length
        ?? hole.tees?.[0]?.length ?? null
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
    break // take first course only (matches original behaviour)
  }
  return holes
}

async function probeCaddee(name) {
  for (const slug of slugVariants(name)) {
    const url = `https://www.caddee.se/klubb/${slug}`
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12_000), redirect: 'follow' })
      if (!res.ok) { await sleep(200); continue }
      const html = await res.text()
      const root = parse(html)
      const scriptEl = root.querySelector('script#__NEXT_DATA__')
      if (!scriptEl) { await sleep(200); continue }
      const data = JSON.parse(scriptEl.text)
      const club = data?.props?.pageProps?.club
      if (!club) { await sleep(200); continue }
      return { club, slug }
    } catch { await sleep(200) }
  }
  return null
}

async function main() {
  const { data: clubs18 } = await supabase.from('holes').select('club_id').eq('hole_number', 18)
  const ids18 = clubs18.map(r => r.club_id)

  // Only Swedish clubs (.se or known Swedish domains) still missing 18 holes
  const { data: clubs, error } = await supabase
    .from('clubs').select('id, name, website')
    .not('id', 'in', `(${ids18.join(',')})`)
    .order('name')
  if (error) { console.error(error.message); process.exit(1) }

  const swedish = clubs.filter(c =>
    !c.website || /\.(se|nu)\b/.test(c.website) ||
    (c.website && !c.website.match(/\.(no|dk|fi|lt|com|net|org)\b/))
  )

  console.log(`Retrying Caddee for ${swedish.length} Swedish clubs without 18-hole data...\n`)

  let found = 0, holesAdded = 0

  for (const club of swedish) {
    process.stdout.write(`  ${club.name}... `)
    const result = await probeCaddee(club.name)

    if (!result) {
      console.log('not on Caddee')
      await sleep(400)
      continue
    }

    found++
    const holes = extractHoles(result.club, club.id)
    if (holes.length === 0) {
      console.log(`found (${result.slug}) but 0 holes`)
      await sleep(600)
      continue
    }

    const { error: hErr } = await supabase
      .from('holes').upsert(holes, { onConflict: 'club_id,hole_number' })
    if (hErr) {
      console.log(`DB error: ${hErr.message}`)
    } else {
      holesAdded += holes.length
      const hasImg = holes.some(h => h.image_url)
      console.log(`${holes.length} holes${hasImg ? ' + images' : ''} ✓  [${result.slug}]`)
    }

    // Update website if missing
    const caddeeUrl = result.club.url ?? result.club.website ?? null
    if (!club.website && caddeeUrl) {
      await supabase.from('clubs').update({ website: caddeeUrl }).eq('id', club.id)
    }

    // Upsert course guide
    await supabase.from('course_guides').upsert({
      club_id: club.id,
      source_url: club.website,
      guide_url: `https://www.caddee.se/klubb/${result.slug}`,
      description: result.club.courses?.[0]?.description ?? null,
      hero_image_url: result.club.courses?.[0]?.overview_image?.normal ?? null,
      scraped_at: new Date().toISOString(),
      scrape_status: 'success',
    }, { onConflict: 'club_id' })

    await sleep(700)
  }

  console.log('\n─────────────────────────────────────────')
  console.log(`Clubs found on Caddee: ${found}`)
  console.log(`Hole rows added:       ${holesAdded}`)
  console.log(`Clubs processed:       ${swedish.length}`)
}

main().catch(err => { console.error(err); process.exit(1) })
