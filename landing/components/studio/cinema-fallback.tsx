import Image from "next/image"
import { cinemaAtlas, cinemaAtlasMobile } from "./cinema-content"

/** The same dimensional composition is present in the server-rendered page. */
export function CinemaFallback({ chapter }: { chapter: number }) {
  return (
    <div
      className="studio-film-plane cinema-fallback"
      role="img"
      aria-label="Three coastal film shots floating above a sculpted violet editing timeline"
    >
      <div className="cinema-fallback-beam" />
      <div className="cinema-fallback-orbit" />
      {[0, 1, 2].map((slot) => (
        <div className={`cinema-still cinema-still-${slot}`} key={slot}>
          <div className="cinema-still-image" data-shot={(chapter + slot + 2) % 3}>
            <picture>
              <source media="(max-width: 767px)" srcSet={cinemaAtlasMobile} />
              <Image
                src={cinemaAtlas}
                alt=""
                width={1536}
                height={1024}
                sizes="(max-width: 767px) 800px, 1536px"
                loading="eager"
                fetchPriority={slot === 1 ? "high" : "auto"}
              />
            </picture>
          </div>
          <div className="cinema-still-sprockets" />
          <span className="cinema-still-edge">
            35 MM · SELECT {String(((chapter + slot + 2) % 3) + 1).padStart(2, "0")}
          </span>
        </div>
      ))}
    </div>
  )
}
