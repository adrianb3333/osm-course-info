'use client'

import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { Club } from '@/lib/types'

export default function LeafletMap() {
  const [clubs, setClubs] = useState<Club[]>([])

  useEffect(() => {
    fetch('/api/clubs')
      .then((r) => r.json())
      .then(setClubs)
  }, [])

  return (
    <MapContainer
      center={[62.5, 16.0]}
      zoom={5}
      style={{ height: 'calc(100vh - 48px)', width: '100%' }}
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
            fillColor: '#15803d',
            fillOpacity: 0.85,
            color: '#ffffff',
            weight: 1.5,
          }}
        >
          <Popup>
            <strong className="text-green-800">{club.name}</strong>
            {club.city && (
              <>
                <br />
                <span className="text-gray-500 text-xs">{club.city}</span>
              </>
            )}
            {club.num_holes && (
              <>
                <br />
                <span className="text-xs">{club.num_holes} hål</span>
              </>
            )}
            {club.website && (
              <>
                <br />
                <a
                  href={club.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-green-700 text-xs underline"
                >
                  Webbplats
                </a>
              </>
            )}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
