'use client'

import { useEffect, useState, useCallback } from 'react'

export type LightboxImage = {
  src: string
  alt: string
  label?: string
}

type Props = {
  images: LightboxImage[]
  initialIndex?: number
  onClose: () => void
}

export default function ImageLightbox({ images, initialIndex = 0, onClose }: Props) {
  const [index, setIndex] = useState(initialIndex)

  const prev = useCallback(() => setIndex((i) => (i - 1 + images.length) % images.length), [images.length])
  const next = useCallback(() => setIndex((i) => (i + 1) % images.length), [images.length])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, prev, next])

  const current = images[index]
  if (!current) return null

  const multiple = images.length > 1

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/92 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white text-3xl leading-none hover:text-gray-300 transition-colors z-10"
        aria-label="Stäng"
      >
        ✕
      </button>

      {/* Counter */}
      {multiple && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white text-sm bg-black/40 rounded-full px-3 py-1 backdrop-blur-sm">
          {current.label ?? `${index + 1} / ${images.length}`}
        </div>
      )}

      {/* Prev arrow */}
      {multiple && (
        <button
          onClick={(e) => { e.stopPropagation(); prev() }}
          className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 text-white bg-black/40 hover:bg-black/70 rounded-full w-11 h-11 flex items-center justify-center text-xl transition-colors backdrop-blur-sm z-10"
          aria-label="Föregående hål"
        >
          ‹
        </button>
      )}

      {/* Image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={current.src}
        alt={current.alt}
        className="max-h-[88vh] max-w-[88vw] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />

      {/* Next arrow */}
      {multiple && (
        <button
          onClick={(e) => { e.stopPropagation(); next() }}
          className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 text-white bg-black/40 hover:bg-black/70 rounded-full w-11 h-11 flex items-center justify-center text-xl transition-colors backdrop-blur-sm z-10"
          aria-label="Nästa hål"
        >
          ›
        </button>
      )}

      {/* Label below image */}
      {current.label && (
        <p className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white text-sm bg-black/40 rounded-full px-3 py-1 backdrop-blur-sm whitespace-nowrap">
          {current.label}
        </p>
      )}
    </div>
  )
}
