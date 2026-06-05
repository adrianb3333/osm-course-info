import type { Club } from '@/lib/types'

type Props = {
  club: Club
  selected: boolean
  onClick: () => void
}

export default function ClubListItem({ club, selected, onClick }: Props) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-colors ${
          selected
            ? 'bg-green-50 border-l-4 border-l-green-600'
            : 'hover:bg-gray-50 border-l-4 border-l-transparent'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm font-medium leading-tight ${selected ? 'text-green-800' : 'text-gray-800'}`}>
            {club.name}
          </p>
          {!club.has_images && (
            <span className="text-red-500 text-xs font-bold flex-shrink-0 mt-0.5" title="Ingen banguide tillgänglig">
              ✕
            </span>
          )}
        </div>
        {(club.city || club.num_holes) && (
          <p className="text-xs text-gray-400 mt-0.5">
            {[club.city, club.num_holes ? `${club.num_holes} hål` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </button>
    </li>
  )
}
