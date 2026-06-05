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

  // Parent renders <ClubDetail key={club.id} />, so this component remounts on club change.
  // No synchronous setState needed — initial state (loading=true, data=null) is correct on mount.
  useEffect(() => {
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
          {/* Course map overview image */}
          {guide?.course_map_url ? (
            <div className="mb-5">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Banöversikt</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={guide.course_map_url}
                alt={`${club.name} – banöversikt`}
                className="w-full rounded-xl border border-gray-100 object-contain max-h-72 bg-gray-50"
              />
            </div>
          ) : guide?.hero_image_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={guide.hero_image_url}
              alt={club.name}
              className="w-full h-44 object-cover rounded-xl mb-4"
            />
          ) : null}

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
                <h3 className="font-semibold text-green-800 text-sm">
                  Banguide – Hålinformation
                </h3>
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

              {/* Show hole cards if we have images, otherwise compact table */}
              {holes.some((h) => h.image_url) ? (
                <HoleCards holes={holes} />
              ) : (
                <HoleTable holes={holes} totalPar={totalPar} totalDist={totalDist} />
              )}
            </div>
          ) : (
            <div className="mt-3 text-gray-400 text-sm italic">
              {guide
                ? 'Banguide hittad – besök klubbens webbplats för hålinformation.'
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
          )}

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

// ── Hole cards — used when images are available ──────────────────────────────

function HoleCards({ holes }: { holes: Hole[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {holes.map((hole) => (
        <div
          key={hole.hole_number}
          className="rounded-xl border border-gray-100 overflow-hidden bg-white shadow-sm"
        >
          {hole.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={hole.image_url}
              alt={`Hål ${hole.hole_number}`}
              className="w-full h-36 object-cover bg-gray-50"
            />
          )}
          <div className="flex items-center gap-4 px-3 py-2">
            <span className="text-xl font-bold text-green-800 w-8 text-center">
              {hole.hole_number}
            </span>
            <div className="flex gap-4 text-sm">
              {hole.par && (
                <span>
                  <span className="text-gray-400 text-xs">Par </span>
                  <span className={`font-semibold ${
                    hole.par === 3 ? 'text-blue-600' : hole.par === 5 ? 'text-orange-600' : 'text-gray-800'
                  }`}>{hole.par}</span>
                </span>
              )}
              {hole.distance_m && (
                <span>
                  <span className="text-gray-400 text-xs">Meter </span>
                  <span className="font-medium text-gray-700">{hole.distance_m}</span>
                </span>
              )}
              {hole.handicap && (
                <span>
                  <span className="text-gray-400 text-xs">HCP </span>
                  <span className="font-medium text-gray-600">{hole.handicap}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Compact table — used when no images available ─────────────────────────────

function HoleTable({
  holes,
  totalPar,
  totalDist,
}: {
  holes: Hole[]
  totalPar: number
  totalDist: number
}) {
  return (
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
            <tr key={hole.hole_number} className={i % 2 === 1 ? 'bg-gray-50' : 'bg-white'}>
              <td className="px-3 py-1.5 text-center font-medium text-gray-700">
                {hole.hole_number}
              </td>
              <td className={`px-3 py-1.5 text-center font-semibold ${
                hole.par === 3 ? 'text-blue-600' : hole.par === 5 ? 'text-orange-600' : 'text-gray-800'
              }`}>
                {hole.par ?? '–'}
              </td>
              <td className="px-3 py-1.5 text-center text-gray-600">
                {hole.distance_m ?? '–'}
              </td>
              <td className="px-3 py-1.5 text-center text-gray-500">
                {hole.handicap ?? '–'}
              </td>
            </tr>
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
