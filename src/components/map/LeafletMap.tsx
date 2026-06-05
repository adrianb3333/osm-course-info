'use client'

import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { Club } from '@/lib/types'
import ClubDetail from '@/components/clubs/ClubDetail'

export default function LeafletMap() {
  const [clubs, setClubs] = useState<Club[]>([])
  const [selected, setSelected] = useState<Club | null>(null)

  useEffect(() => {
    fetch('/api/clubs').then((r) => r.json()).then(setClubs)
  }, [])

  return (
    <div className="relative" style={{ height: 'calc(100vh - 48px)' }}>
      <MapContainer
        center={[62.5, 16.0]}
        zoom={5}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        {clubs.map((club) => (
          <CircleMarker
            key={club.id}
            center={[club.lat, club.lon]}
            radius={6}
            pathOptions={{
              fillColor: selected?.id === club.id ? '#f59e0b' : '#15803d',
              fillOpacity: 0.9,
              color: '#ffffff',
              weight: 1.5,
            }}
            eventHandlers={{ click: () => setSelected(club) }}
          />
        ))}
      </MapContainer>

      {/* Side panel — slides in from the right when a club is selected */}
      {selected && (
        <div className="absolute top-0 right-0 h-full w-full sm:w-[420px] bg-white shadow-2xl overflow-y-auto z-[1000] border-l border-gray-100">
          <ClubDetail key={selected.id} club={selected} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  )
}
