'use client'

import { useEffect, useState, useMemo } from 'react'
import type { Club } from '@/lib/types'
import NearbyCard from './NearbyCard'

type Props = {
  clubs: Club[]
  userLat: number
  userLon: number
  selectedId?: string
  onSelect: (club: Club) => void
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const LIMIT = 50

export default function NearbyGrid({ clubs, userLat, userLon, selectedId, onSelect }: Props) {
  const [hole1Images, setHole1Images] = useState<Record<string, string>>({})
  // Track which set of IDs the images were fetched for to derive loading state without synchronous setState
  const [fetchedForKey, setFetchedForKey] = useState('')

  // Sort clubs by distance, take nearest 50
  const nearest = useMemo(() => {
    return clubs
      .map((c) => ({ club: c, km: haversineKm(userLat, userLon, c.lat, c.lon) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, LIMIT)
  }, [clubs, userLat, userLon])

  const currentKey = nearest.map((n) => n.club.id).join(',')
  const loadingImages = currentKey !== fetchedForKey

  // Batch-fetch hole 1 images for the 50 nearest clubs
  useEffect(() => {
    if (nearest.length === 0) return
    const ids = nearest.map((n) => n.club.id).join(',')
    fetch(`/api/clubs/hole-previews?ids=${ids}`)
      .then((r) => r.json())
      .then((map) => { setHole1Images(map); setFetchedForKey(ids) })
      .catch(() => setFetchedForKey(ids))
  }, [nearest])

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <h2 className="font-semibold text-green-900 text-sm">
          Närmaste golfklubbar
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">{LIMIT} närmaste — tryck på en bild för helskärm</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {nearest.map(({ club, km }) => (
            <NearbyCard
              key={club.id}
              club={club}
              distanceKm={km}
              hole1Image={loadingImages ? null : (hole1Images[club.id] ?? null)}
              selected={club.id === selectedId}
              onClick={() => onSelect(club)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
