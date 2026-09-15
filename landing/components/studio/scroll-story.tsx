import Image from "next/image"
import { studioArtwork } from "@/lib/studio-artwork"

export function ScrollStory() {
  return (
    <section className="studio-scroll-story" data-scroll-scene aria-labelledby="scroll-story-title">
      <div className="studio-story-sticky">
        <div className="studio-story-copy">
          <p className="studio-eyebrow">You see the story. Shape every frame.</p>
          <h2 id="scroll-story-title">From first thought.<br /><span>To final frame.</span></h2>
          <p>A little less between your imagination and your edit.</p>
        </div>
        <div className="studio-story-frames" aria-hidden="true">
          {(["collection", "sequence", "finish"] as const).map((key, index) => (
            <div className={`studio-story-frame studio-story-frame-${index + 1}`} key={key}>
              <picture>
                <source media="(max-width: 767px)" srcSet={studioArtwork[key].mobileSrc} />
                <Image src={studioArtwork[key].src} alt="" width={1600} height={914} loading="lazy" sizes="(max-width: 767px) 70vw, 45vw" />
              </picture>
              <span>0{index + 1} / {key === "collection" ? "Find your focus" : key === "sequence" ? "Shape the story" : "Make it yours"}</span>
            </div>
          ))}
        </div>
        <p className="studio-story-caption">Your direction. Your decisions. Every step of the edit.</p>
      </div>
    </section>
  )
}
