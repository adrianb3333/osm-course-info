import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createServerClient()

  const [guideRes, holesRes] = await Promise.all([
    supabase
      .from('course_guides')
      .select('id, club_id, description, par, slope_rating, course_rating, green_fee_from, booking_url, hero_image_url, course_map_url, source_url, guide_url, scraped_at, scrape_status')
      .eq('club_id', id)
      .single(),
    supabase
      .from('holes')
      .select('hole_number, par, distance_m, distance_y, handicap, description, image_url')
      .eq('club_id', id)
      .order('hole_number'),
  ])

  const guide = guideRes.data ?? null
  const holes = holesRes.data ?? []

  if (!guide && holes.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  return NextResponse.json({ guide, holes })
}
