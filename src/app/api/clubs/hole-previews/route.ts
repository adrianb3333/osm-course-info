import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// GET /api/clubs/hole-previews?ids=id1,id2,...
// Returns { clubId: imageUrl | null } for hole 1 of each requested club.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const raw = searchParams.get('ids') ?? ''
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean)

  if (ids.length === 0) return NextResponse.json({})

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('holes')
    .select('club_id, image_url')
    .eq('hole_number', 1)
    .not('image_url', 'is', null)
    .in('club_id', ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const map: Record<string, string> = {}
  for (const row of data ?? []) {
    if (row.image_url) map[row.club_id] = row.image_url
  }

  return NextResponse.json(map, {
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
  })
}
