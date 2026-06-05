'use client'

import { useState } from 'react'
import HomeTab from './tabs/HomeTab'
import MapTab from './tabs/MapTab'
import ClubsTab from './tabs/ClubsTab'

const TABS = [
  { id: 'home', label: 'Hem' },
  { id: 'map', label: 'Karta' },
  { id: 'clubs', label: 'Klubbar' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function TabShell() {
  const [activeTab, setActiveTab] = useState<TabId>('home')

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <nav className="border-b border-gray-200 sticky top-0 bg-white z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 flex items-center gap-4">
          <span className="text-green-800 font-bold text-sm py-3 mr-2 hidden sm:inline">
            OSM Course Info
          </span>
          <div className="flex gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? 'border-green-700 text-green-700'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>
      <main className="flex-1">
        {activeTab === 'home' && <HomeTab />}
        {activeTab === 'map' && <MapTab />}
        {activeTab === 'clubs' && <ClubsTab />}
      </main>
    </div>
  )
}
