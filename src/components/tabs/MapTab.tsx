import dynamic from 'next/dynamic'

const LeafletMap = dynamic(() => import('@/components/map/LeafletMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[calc(100vh-48px)] flex items-center justify-center">
      <span className="text-gray-400 text-sm">Laddar karta...</span>
    </div>
  ),
})

export default function MapTab() {
  return <LeafletMap />
}
