// Generate PWA PNG icons from the SVG using sharp.
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svg = await readFile(path.join(__dirname, "..", "public", "icon.svg"));

for (const size of [192, 512]) {
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(__dirname, "..", "public", `icon-${size}.png`));
  console.log(`✓ icon-${size}.png`);
}

// Apple touch icon (180x180, no transparency, full-bleed background).
const innerSvg = svg.toString().replace(/^<\?xml[^>]*\?>/, "").replace(/<svg[^>]*>/, "").replace("</svg>", "");
const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180">
  <rect width="180" height="180" fill="#d97f3a"/>
  <g transform="scale(0.3515625)">${innerSvg}</g>
</svg>`;
await sharp(Buffer.from(bgSvg)).png().toFile(path.join(__dirname, "..", "public", "icon-apple.png"));
console.log("✓ icon-apple.png");
