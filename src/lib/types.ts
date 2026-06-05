export type Club = {
  id: string
  osm_id: number | null
  name: string
  short_name: string | null
  lat: number
  lon: number
  website: string | null
  phone: string | null
  email: string | null
  city: string | null
  region: string | null
  num_holes: number | null
  has_images: boolean
}

export type CourseGuide = {
  id: string
  club_id: string
  description: string | null
  course_description_html: string | null
  par: number | null
  slope_rating: number | null
  course_rating: number | null
  green_fee_from: number | null
  booking_url: string | null
  hero_image_url: string | null
  course_map_url: string | null
  source_url: string | null
  guide_url: string | null
  scraped_at: string | null
  scrape_status: string | null
}

export type Hole = {
  hole_number: number
  par: number | null
  distance_m: number | null
  distance_y: number | null
  handicap: number | null
  description: string | null
  image_url: string | null
}

export type GuideResponse = {
  guide: CourseGuide | null
  holes: Hole[]
}
