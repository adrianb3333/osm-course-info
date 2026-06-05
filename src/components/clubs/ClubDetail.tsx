'use client'

import { useEffect, useState } from 'react'
import type { Club, GuideResponse, Hole } from '@/lib/types'

type Props = {
  club: Club
  onClose?: () => void
}

export default function ClubDetail({ club, onClose }: Props) {
  const [data, setData] = useState<GuideResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setData(null)
    setLoading(true)
    fetch(`/api/clubs/${club.id}/guide`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setData(d); setLoading(false) })
  }, [club.id])

  const guide = data?.guide ?? null
  const holes = data?.holes ?? []
  const totalPar = holes.reduce((s, h) => s + (h.par ?? 0), 0)
  const totalDist = holes.reduce((s, h) => s + (h.distance_m ?? 0), 0)

  return (
    <div className="p-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-1">
        <h2 className="text-2xl font-bold text-green-800 leading-tight">{club.name}</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none flex-shrink-0 mt-1"
            aria-label="Close"
          >
            ✕
          </button>
        )}
      </div>

      {(club.city || club.region) && (
        <p className="text-gray-500 text-sm mb-3">
          {[club.city, club.region].filter(Boolean).join(', ')}
        </p>
      )}

      {/* Website link */}
      {club.website && (
        <a
          href={club.website}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-green-700 hover:underline text-sm mb-4 block"
        >
          🌐 {club.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
        </a>
      )}

      {loading && <p className="text-gray-400 text-sm mt-4">Laddar baninformation...</p>}

      {!loading && (
        <>
          {/* Hero image */}
          {guide?.hero_image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={guide.hero_image_url}
              alt={club.name}
              className="w-full h-44 object-cover rounded-xl mb-4"
            />
          )}

          {/* Description */}
          {guide?.description && (
            <p className="text-gray-700 text-sm leading-relaxed mb-4">{guide.description}</p>
          )}

          {/* Summary stats */}
          {(guide?.par || club.num_holes || guide?.slope_rating || guide?.green_fee_from) && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
              {guide?.par && <Stat label="Par" value={String(guide.par)} />}
              {club.num_holes && <Stat label="Hål" value={String(club.num_holes)} />}
              {guide?.slope_rating && <Stat label="Slope" value={String(guide.slope_rating)} />}
              {guide?.green_fee_from && (
                <Stat label="Green fee" value={`${guide.green_fee_from} kr`} />
              )}
            </div>
          )}

          {/* Hole-by-hole table */}
          {holes.length > 0 ? (
            <div className="mt-2">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-green-800 text-sm">Banguide – Hålinformation</h3>
                {guide?.guide_url && (
                  <a
                    href={guide.guide_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-green-600 hover:underline"
                  >
                    Se original →
                  </a>
                )}
              </div>
              <div className="overflow-x-auto rounded-lg border border-gray-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-green-700 text-white">
                      <th className="px-3 py-2 text-center font-medium">Hål</th>
                      <th className="px-3 py-2 text-center font-medium">Par</th>
                      <th className="px-3 py-2 text-center font-medium">Meter</th>
                      <th className="px-3 py-2 text-center font-medium">HCP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holes.map((hole, i) => (
                      <HoleRow key={hole.hole_number} hole={hole} alt={i % 2 === 1} />
                    ))}
                  </tbody>
                  {holes.length >= 9 && (
                    <tfoot>
                      <tr className="bg-green-50 font-semibold text-green-900 border-t border-green-200">
                        <td className="px-3 py-2 text-center">Total</td>
                        <td className="px-3 py-2 text-center">{totalPar || '–'}</td>
                        <td className="px-3 py-2 text-center">{totalDist || '–'}</td>
                        <td className="px-3 py-2 text-center">–</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          ) : (
            !loading && (
              <div className="mt-3 text-gray-400 text-sm italic">
                {guide
                  ? 'Banguide hittad men ingen håltabell kunde läsas – besök klubbens webbplats.'
                  : 'Ingen banguide tillgänglig ännu.'}
                {guide?.guide_url && (
                  <>
                    {' '}
                    <a
                      href={guide.guide_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-green-600 not-italic hover:underline"
                    >
                      Öppna banguide →
                    </a>
                  </>
                )}
              </div>
            )
          )}

          {/* Booking button */}
          {guide?.booking_url && (
            <a
              href={guide.booking_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 block w-full text-center bg-green-700 text-white rounded-lg py-3 font-medium hover:bg-green-800 transition-colors text-sm"
            >
              Boka starttid
            </a>
          )}
        </>
      )}
    </div>
  )
}

function HoleRow({ hole, alt }: { hole: Hole; alt: boolean }) {
  return (
    <tr className={alt ? 'bg-gray-50' : 'bg-white'}>
      <td className="px-3 py-1.5 text-center font-medium text-gray-700">{hole.hole_number}</td>
      <td className={`px-3 py-1.5 text-center font-semibold ${
        hole.par === 3 ? 'text-blue-600' : hole.par === 5 ? 'text-orange-600' : 'text-gray-800'
      }`}>
        {hole.par ?? '–'}
      </td>
      <td className="px-3 py-1.5 text-center text-gray-600">{hole.distance_m ?? '–'}</td>
      <td className="px-3 py-1.5 text-center text-gray-500">{hole.handicap ?? '–'}</td>
    </tr>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-green-50 rounded-xl p-3 text-center">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="font-bold text-lg text-green-900">{value}</p>
    </div>
  )
}
