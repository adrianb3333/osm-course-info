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
      .select('*')
      .eq('club_id', id)
      .single(),
    supabase
      .from('holes')
      .select('hole_number, par, distance_m, distance_y, handicap, description')
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
