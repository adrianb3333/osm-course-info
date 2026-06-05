import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = createServerClient()

  const [clubsRes, imagesRes] = await Promise.all([
    supabase
      .from('clubs')
      .select('id, name, short_name, lat, lon, city, region, num_holes, website')
      .order('name'),
    // Clubs that have at least hole 18 with an image (= full image set)
    supabase
      .from('holes')
      .select('club_id')
      .eq('hole_number', 18)
      .not('image_url', 'is', null),
  ])

  if (clubsRes.error) return NextResponse.json({ error: clubsRes.error.message }, { status: 500 })

  const withImages = new Set((imagesRes.data ?? []).map((r) => r.club_id))

  const data = (clubsRes.data ?? []).map((club) => ({
    ...club,
    has_images: withImages.has(club.id),
  }))

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
  })
}
