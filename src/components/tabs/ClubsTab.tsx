'use client'

import { useState, useEffect } from 'react'
import ClubList from '@/components/clubs/ClubList'
import ClubDetail from '@/components/clubs/ClubDetail'
import NearbyGrid from '@/components/clubs/NearbyGrid'
import type { Club } from '@/lib/types'

type GeoState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'granted'; lat: number; lon: number }
  | { status: 'denied' }

export default function ClubsTab() {
  const [clubs, setClubs] = useState<Club[]>([])
  const [selectedClub, setSelectedClub] = useState<Club | null>(null)
  const [loading, setLoading] = useState(true)
  // Initialise synchronously so the effect never needs a synchronous setState call
  const [geo, setGeo] = useState<GeoState>(() =>
    typeof navigator !== 'undefined' && navigator.geolocation
      ? { status: 'requesting' }
      : { status: 'denied' }
  )

  useEffect(() => {
    fetch('/api/clubs')
      .then((r) => r.json())
      .then((data) => { setClubs(data); setLoading(false) })
  }, [])

  // Start the geolocation request once (status is already 'requesting' from useState init)
  useEffect(() => {
    if (geo.status !== 'requesting') return
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({ status: 'granted', lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => setGeo({ status: 'denied' }),
      { timeout: 10_000, maximumAge: 5 * 60 * 1000 }
    )
  }, [geo.status])

  const showNearby = geo.status === 'granted' && clubs.length > 0

  return (
    <div className="flex h-[calc(100vh-48px)]">
      {/* Left sidebar — search list */}
      <aside className="w-64 border-r border-gray-200 overflow-y-auto flex-shrink-0">
        <ClubList
          clubs={clubs}
          loading={loading}
          selectedId={selectedClub?.id}
          onSelect={setSelectedClub}
        />
      </aside>

      {/* Middle — nearby grid or empty state */}
      <section className={`flex-1 overflow-hidden ${selectedClub ? 'hidden lg:flex lg:flex-col' : 'flex flex-col'}`}>
        {loading || geo.status === 'requesting' ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            {loading ? 'Laddar klubbar...' : 'Hämtar din position...'}
          </div>
        ) : showNearby ? (
          <NearbyGrid
            clubs={clubs}
            userLat={(geo as { status: 'granted'; lat: number; lon: number }).lat}
            userLon={(geo as { status: 'granted'; lat: number; lon: number }).lon}
            selectedId={selectedClub?.id}
            onSelect={setSelectedClub}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm gap-2">
            {geo.status === 'denied' ? (
              <>
                <span className="text-2xl">📍</span>
                <p>Platstillstånd nekades</p>
                <p className="text-xs text-center max-w-xs">
                  Aktivera platsåtkomst i webbläsarens inställningar för att se närmaste klubbar.
                </p>
              </>
            ) : (
              <p>Välj en klubb i listan för att se mer information</p>
            )}
          </div>
        )}
      </section>

      {/* Right — club detail panel */}
      {selectedClub && (
        <aside className="w-full lg:w-[440px] border-l border-gray-100 overflow-y-auto flex-shrink-0">
          <ClubDetail
            key={selectedClub.id}
            club={selectedClub}
            onClose={() => setSelectedClub(null)}
          />
        </aside>
      )}
    </div>
  )
}
