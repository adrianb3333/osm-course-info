'use client'

import { useState } from 'react'
import type { Club } from '@/lib/types'
import ImageLightbox from '@/components/ui/ImageLightbox'

type Props = {
  club: Club
  distanceKm: number
  hole1Image: string | null
  selected: boolean
  onClick: () => void
}

export default function NearbyCard({ club, distanceKm, hole1Image, selected, onClick }: Props) {
  const [lightbox, setLightbox] = useState(false)

  return (
    <>
      <div
        className={`rounded-xl border overflow-hidden bg-white shadow-sm cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 ${
          selected ? 'border-green-500 ring-2 ring-green-200' : 'border-gray-100'
        }`}
        onClick={onClick}
      >
        {/* Hole 1 image — tappable for fullscreen */}
        <div className="relative w-full h-36 bg-gray-100 flex items-center justify-center overflow-hidden">
          {hole1Image ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={hole1Image}
                alt={`${club.name} – hål 1`}
                className="w-full h-full object-cover"
              />
              <button
                onClick={(e) => { e.stopPropagation(); setLightbox(true) }}
                className="absolute inset-0 flex items-end justify-end p-2 opacity-0 hover:opacity-100 transition-opacity"
                aria-label="Fullskärm"
              >
                <span className="bg-black/50 text-white text-xs rounded px-2 py-1 backdrop-blur-sm">
                  ⛳ Hål 1
                </span>
              </button>
            </>
          ) : (
            <span className="text-gray-300 text-4xl">⛳</span>
          )}
        </div>

        {/* Club info */}
        <div className="px-3 py-2">
          <p className="font-semibold text-green-900 text-sm leading-tight truncate">{club.name}</p>
          <div className="flex items-center justify-between mt-0.5">
            <p className="text-xs text-gray-400 truncate">
              {[club.city, club.region].filter(Boolean).join(', ')}
            </p>
            <p className="text-xs font-medium text-green-700 ml-2 flex-shrink-0">
              {distanceKm < 1
                ? `${Math.round(distanceKm * 1000)} m`
                : `${distanceKm.toFixed(1)} km`}
            </p>
          </div>
        </div>
      </div>

      {lightbox && hole1Image && (
        <ImageLightbox
          images={[{ src: hole1Image, alt: `${club.name} – hål 1`, label: 'Hål 1' }]}
          onClose={() => setLightbox(false)}
        />
      )}
    </>
  )
}
