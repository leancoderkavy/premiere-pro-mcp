import sharp from "sharp"
import { fileURLToPath } from "node:url"

// Generate delivery derivatives without changing the original artwork.
const publicDirectory = new URL("../public/", import.meta.url)
const images = [
  ["marketing/premiere-pro-mcp-mark-v1.png", "marketing/premiere-pro-mcp-mark-96.webp", 96],
  ["premiere-pro-mcp-demo-poster.png", "premiere-pro-mcp-demo-poster-640.webp", 640],
  ["premiere-pro-mcp-demo-poster.png", "premiere-pro-mcp-demo-poster-1280.webp", 1280],
]

for (const [source, destination, width] of images) {
  const result = await sharp(fileURLToPath(new URL(source, publicDirectory)))
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 85, effort: 6 })
    .toFile(fileURLToPath(new URL(destination, publicDirectory)))
  console.log(`${destination}: ${result.width} x ${result.height}, ${result.size} bytes`)
}
