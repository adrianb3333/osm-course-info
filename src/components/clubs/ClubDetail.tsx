'use client'

import { useEffect, useState } from 'react'
import type { Club, CourseGuide } from '@/lib/types'

type Props = {
  club: Club
}

export default function ClubDetail({ club }: Props) {
  const [guide, setGuide] = useState<CourseGuide | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setGuide(null)
    setLoading(true)
    fetch(`/api/clubs/${club.id}/guide`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setGuide(data)
        setLoading(false)
      })
  }, [club.id])

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-2xl font-bold text-green-800 mb-1">{club.name}</h2>
      {(club.city || club.region) && (
        <p className="text-gray-500 text-sm mb-4">
          {[club.city, club.region].filter(Boolean).join(', ')}
        </p>
      )}

      {loading && (
        <p className="text-gray-400 text-sm mt-4">Laddar baninformation...</p>
      )}

      {!loading && guide && (
        <div className="space-y-5">
          {guide.hero_image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={guide.hero_image_url}
              alt={club.name}
              className="w-full h-48 object-cover rounded-xl"
            />
          )}

          {guide.description && (
            <p className="text-gray-700 leading-relaxed">{guide.description}</p>
          )}

          {(guide.par || club.num_holes || guide.slope_rating || guide.green_fee_from) && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {guide.par && (
                <Stat label="Par" value={String(guide.par)} />
              )}
              {club.num_holes && (
                <Stat label="Hål" value={String(club.num_holes)} />
              )}
              {guide.slope_rating && (
                <Stat label="Slope" value={String(guide.slope_rating)} />
              )}
              {guide.green_fee_from && (
                <Stat label="Green fee" value={`${guide.green_fee_from} kr`} />
              )}
            </div>
          )}

          {club.website && (
            <a
              href={club.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-green-700 hover:underline text-sm"
            >
              Besök klubbens webbplats →
            </a>
          )}

          {guide.booking_url && (
            <a
              href={guide.booking_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center bg-green-700 text-white rounded-lg py-3 font-medium hover:bg-green-800 transition-colors text-sm"
            >
              Boka starttid
            </a>
          )}
        </div>
      )}

      {!loading && !guide && (
        <div className="mt-6 space-y-3">
          <p className="text-gray-400 italic text-sm">Ingen baninformation tillgänglig ännu.</p>
          {club.website && (
            <a
              href={club.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-green-700 hover:underline text-sm"
            >
              Besök klubbens webbplats →
            </a>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-green-50 rounded-xl p-3 text-center">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="font-bold text-lg text-green-900">{value}</p>
    </div>
  )
}
