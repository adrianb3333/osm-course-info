# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev       # start dev server at http://localhost:3000
npm run build     # production build
npm run lint      # ESLint (eslint.config.mjs, Next.js rules)
```

No test suite exists yet.

### Data pipeline scripts (Node ESM, run once to populate Supabase)

```bash
node scripts/seed-clubs.mjs            # Overpass API → clubs table (~587 Swedish golf courses)
node scripts/scrape-guides.mjs         # Probes club websites → course_guides table
node scripts/scrape-images.mjs         # Downloads hole images → Supabase Storage bucket "course-images"
node scripts/fetch-caddee-data.mjs     # caddee.se → holes table + club websites (primary hole data source)
node scripts/fetch-golf-se-websites.mjs # golf.se → clubs.website for clubs still missing one
```

Scripts read `.env.local` manually (no dotenv). All scripts are idempotent — safe to re-run.

## Architecture

### Navigation
Tab switching is `useState`-only in `TabShell.tsx` — no URL routing. Three tabs: Hem / Karta / Klubbar.

### Data flow
- All clubs are fetched once from `GET /api/clubs` (1h cache) and held in component state.
- Course guide + holes are fetched lazily at `GET /api/clubs/[id]/guide` only when a club is selected.
- API routes use the **service-role** Supabase client (`src/lib/supabase/server.ts`). The browser uses the **anon** client (`src/lib/supabase/client.ts`). Never call the server client from a Client Component.

### Leaflet constraint
`LeafletMap.tsx` is a Client Component that imports `leaflet/dist/leaflet.css` directly. It is wrapped in `dynamic(..., { ssr: false })` inside `MapTab.tsx`. Do not move that CSS import to `globals.css` and do not render the map server-side.

### Hole display logic (`ClubDetail.tsx`)
If `holes.some(h => h.image_url)` → renders `HoleCards` (2-column grid with diagrams).  
Otherwise → renders `HoleTable` (compact par/dist/HCP table).  
Hole image URLs point to Caddee's S3 CDN (`caddee-prod-media.s3.amazonaws.com`) or Supabase Storage. Add new image hosts to `next.config.ts` `images.remotePatterns` before using `<Image>`.

### Supabase schema (3 tables + 1 storage bucket)
- `clubs` — OSM-sourced, 587 rows, has `lat/lon/website/city/region`
- `course_guides` — one row per club, `UNIQUE(club_id)`, holds description/par/slope/hero image/guide URL
- `holes` — up to 18 rows per club, `UNIQUE(club_id, hole_number)`, holds par/handicap/distance_m/image_url
- Storage bucket `course-images` — path pattern `clubs/{club_id}/holes/hole-{n}.{ext}`

RLS is enabled on all tables with a public `SELECT` policy for the `anon` role.

### Environment variables
`.env.local` (never committed):
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```
`SUPABASE_SERVICE_ROLE_KEY` has no `NEXT_PUBLIC_` prefix — it must stay server-side only.
