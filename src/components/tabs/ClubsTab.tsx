'use client'

import { useState, useEffect } from 'react'
import ClubList from '@/components/clubs/ClubList'
import ClubDetail from '@/components/clubs/ClubDetail'
import type { Club } from '@/lib/types'

export default function ClubsTab() {
  const [clubs, setClubs] = useState<Club[]>([])
  const [selectedClub, setSelectedClub] = useState<Club | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/clubs')
      .then((r) => r.json())
      .then((data) => {
        setClubs(data)
        setLoading(false)
      })
  }, [])

  return (
    <div className="flex h-[calc(100vh-48px)]">
      <aside className="w-72 border-r border-gray-200 overflow-y-auto flex-shrink-0">
        <ClubList
          clubs={clubs}
          loading={loading}
          selectedId={selectedClub?.id}
          onSelect={setSelectedClub}
        />
      </aside>
      <section className="flex-1 overflow-y-auto">
        {selectedClub ? (
          <ClubDetail club={selectedClub} />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Välj en klubb i listan för att se mer information
          </div>
        )}
      </section>
    </div>
  )
}
