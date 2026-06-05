#!/usr/bin/env node
/**
 * Seeds the `clubs` table from the OpenStreetMap Overpass API.
 * Run once after setting up the Supabase schema:
 *   node scripts/seed-clubs.mjs
 */

import { createClient } from '@supabase/supabase-js'
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

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const SWEDEN_BBOX = '55.3,10.9,69.1,24.2'

const QUERY = `
[out:json][timeout:90];
(
  way["leisure"="golf_course"]["name"](${SWEDEN_BBOX});
  relation["leisure"="golf_course"]["name"](${SWEDEN_BBOX});
);
out center tags;
`

async function fetchGolfCourses() {
  console.log('Querying Overpass API for Swedish golf courses (this may take ~60s)...')
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(QUERY)}`,
  })
  if (!res.ok) throw new Error(`Overpass HTTP error: ${res.status} ${res.statusText}`)
  const json = await res.json()
  return json.elements
}

async function main() {
  const elements = await fetchGolfCourses()
  console.log(`Found ${elements.length} elements`)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const clubs = elements
    .map((el) => {
      const tags = el.tags ?? {}
      const center = el.center ?? {}
      const lat = el.lat ?? center.lat
      const lon = el.lon ?? center.lon
      if (!lat || !lon || !tags.name) return null
      return {
        osm_id: el.id,
        osm_type: el.type,
        name: tags.name,
        short_name: tags['short_name'] ?? tags['name:en'] ?? null,
        lat,
        lon,
        website: tags.website ?? tags['contact:website'] ?? null,
        phone: tags.phone ?? tags['contact:phone'] ?? null,
        email: tags.email ?? tags['contact:email'] ?? null,
        address: tags['addr:street']
          ? `${tags['addr:street']} ${tags['addr:housenumber'] ?? ''}`.trim()
          : null,
        city: tags['addr:city'] ?? null,
        region: null,
        num_holes: tags['golf:holes'] ? parseInt(tags['golf:holes'], 10) : null,
      }
    })
    .filter(Boolean)

  console.log(`Upserting ${clubs.length} clubs into Supabase...`)

  const BATCH = 100
  for (let i = 0; i < clubs.length; i += BATCH) {
    const batch = clubs.slice(i, i + BATCH)
    const { error } = await supabase
      .from('clubs')
      .upsert(batch, { onConflict: 'osm_id', ignoreDuplicates: false })
    if (error) {
      console.error(`Batch ${i}–${i + BATCH} error:`, error.message)
      process.exit(1)
    }
    console.log(`  Inserted batch ${i + 1}–${Math.min(i + BATCH, clubs.length)}`)
  }

  console.log('\nDone! All clubs seeded successfully.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
