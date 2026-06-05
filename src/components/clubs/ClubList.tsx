'use client'

import { useState } from 'react'
import type { Club } from '@/lib/types'
import ClubListItem from './ClubListItem'

type Props = {
  clubs: Club[]
  loading: boolean
  selectedId?: string
  onSelect: (club: Club) => void
}

export default function ClubList({ clubs, loading, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState('')

  const filtered = clubs.filter((c) =>
    `${c.name} ${c.city ?? ''} ${c.region ?? ''}`.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-100 sticky top-0 bg-white z-10">
        <input
          type="search"
          placeholder="Sök klubb eller stad..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-600 focus:border-transparent"
        />
        {!loading && (
          <p className="text-xs text-gray-400 mt-1 px-1">{filtered.length} klubbar</p>
        )}
      </div>

      {loading ? (
        <div className="p-4 text-gray-400 text-sm text-center mt-8">Laddar klubbar...</div>
      ) : (
        <ul className="flex-1">
          {filtered.map((club) => (
            <ClubListItem
              key={club.id}
              club={club}
              selected={club.id === selectedId}
              onClick={() => onSelect(club)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
