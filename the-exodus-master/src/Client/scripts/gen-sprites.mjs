// Generates placeholder PNG sprite files for character body parts.
// Run with: node scripts/gen-sprites.mjs  (from the src/Client directory)
// Replace the output PNGs with your own pixel art at the same dimensions.
//
// Sizes:  head 20x22,  torso 12x28,  arm 8x20,  leg 8x22
// Torso/arms/legs are white-base — tinted per player colour at runtime.
// Head is not tinted — draw it with the intended face colours.

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync }              from 'node:zlib';

// ── Minimal PNG encoder ───────────────────────────────────────────────────────

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function makePNG(w, h, px) {
  const sl  = 1 + w * 4;
  const raw = Buffer.alloc(sl * h);
  for (let y = 0; y < h; y++) {
    raw[y * sl] = 0;                          // filter: None
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = px(x, y);
      const i = y * sl + 1 + x * 4;
      raw[i] = r; raw[i+1] = g; raw[i+2] = b; raw[i+3] = a;
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  const chunk = (t, d) => {
    const tb = Buffer.from(t, 'ascii');
    const lb = Buffer.alloc(4); lb.writeUInt32BE(d.length);
    const cb = Buffer.alloc(4); cb.writeUInt32BE(crc32(Buffer.concat([tb, d])));
    return Buffer.concat([lb, tb, d, cb]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;                  // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Pixel functions ───────────────────────────────────────────────────────────

// head.png  20×22  — oval face, skin tone, outline, two eyes, mouth
function headPx(x, y) {
  const d = ((x - 9.5) / 8.5) ** 2 + ((y - 10.5) / 9.5) ** 2;
  if (d > 1.00) return [0, 0, 0, 0];                              // outside oval
  if (d > 0.76) return [44, 22, 8, 255];                          // outline
  if (y >= 8 && y <= 9  && x >= 4  && x <= 6)  return [50, 28, 12, 255]; // left eye
  if (y >= 8 && y <= 9  && x >= 13 && x <= 15) return [50, 28, 12, 255]; // right eye
  if (y === 14           && x >= 7  && x <= 12) return [160, 80, 55, 255]; // mouth
  return [240, 200, 166, 255];                                     // skin
}

// torso.png  12×28  — white base, grey border (tinted per player)
function torsoPx(x, y) {
  if (x === 0 || x === 11 || y === 0 || y === 27) return [180, 180, 180, 255];
  return [255, 255, 255, 255];
}

// arm.png   8×20  — white base, grey border (tinted per player, pivot near top)
function armPx(x, y) {
  if (x === 0 || x === 7 || y === 0 || y === 19) return [180, 180, 180, 255];
  return [255, 255, 255, 255];
}

// leg.png   8×22  — white base, grey border (tinted per player, pivot near top)
function legPx(x, y) {
  if (x === 0 || x === 7 || y === 0 || y === 21) return [180, 180, 180, 255];
  return [255, 255, 255, 255];
}

// gun.png  18×14  — barrel right (+x), grip down (+y), wrist row at y=5
// Origin at (0, 5/14) so the wrist attachment point aligns with (0,0) in scene space.
// Layout:  rows 0-2 = barrel top, rows 3-4 = slide, rows 5-10 = frame/slide, rows 7-13 = grip
function gunPx(x, y) {
  // barrel: cols 1-17, rows 0-2
  if (y >= 0 && y <= 2 && x >= 1 && x <= 17) {
    if (x === 1 || x === 17 || y === 0) return [80, 80, 80, 255];   // outline
    if (x >= 15 && y === 2)             return [200, 200, 200, 255]; // muzzle highlight
    return [120, 120, 120, 255];                                      // barrel body
  }
  // slide / frame: cols 0-11, rows 3-7
  if (y >= 3 && y <= 7 && x >= 0 && x <= 11) {
    if (x === 0 || x === 11 || y === 3 || y === 7) return [60, 60, 60, 255]; // outline
    return [90, 90, 90, 255];
  }
  // grip: cols 0-5, rows 5-13
  if (y >= 5 && y <= 13 && x >= 0 && x <= 5) {
    if (x === 0 || x === 5 || y === 13) return [40, 40, 40, 255]; // outline
    return [70, 60, 55, 255];                                       // dark grip
  }
  return [0, 0, 0, 0]; // transparent
}

// fireball.png  36×36  — concentric glow: yellow core → orange → red fringe, transparent outside
function fireballPx(x, y) {
  const cx = 17.5, cy = 17.5;
  const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  if (d > 17)  return [0, 0, 0, 0];
  const t = d / 17;
  if (t < 0.27) return [255, 238, 136, 255]; // yellow core
  if (t < 0.56) return [255, 102,   0, 230]; // orange mid
  if (t < 0.80) return [255,  68,   0, 150]; // dark orange
  return [200, 40, 0, Math.round((1 - t) / 0.2 * 80)]; // faint red fringe
}

// life_dot.png  10×10  — white circle with grey outline (tinted red/grey at runtime)
function lifeDotPx(x, y) {
  const d = Math.sqrt((x - 4.5) ** 2 + (y - 4.5) ** 2);
  if (d > 4.5) return [0, 0, 0, 0];
  if (d > 3.5) return [150, 150, 150, 255]; // outline
  return [255, 255, 255, 255];               // white base — tinted at runtime
}

// platform.png  64×26  — surface stripe (y 0-5), body (y 6-19), underside shadow (y 20-25)
function platformPx(x, y) {
  if (y <= 1) return [100,  60,  20, 255]; // top edge
  if (y <= 5) return [154,  95,  46, 255]; // dark surface
  if (y === 6) return [212, 164,  98, 255]; // highlight stripe
  if (y <= 19) return [180, 110,  60, 255]; // body
  return [120, 70, 30, Math.round((1 - (y - 20) / 5) * 180)]; // fading underside
}

// ── Write files ───────────────────────────────────────────────────────────────

// scale2x: doubles canvas size of any pixel function without changing shapes
const scale2x = (fn) => (x, y) => fn(x / 2, y / 2);

mkdirSync('public/sprites', { recursive: true });
// Character body parts — 2× resolution for detailed pixel art; display sizes in app.ts unchanged
writeFileSync('public/sprites/head.png',  makePNG(40, 44, scale2x(headPx)));
writeFileSync('public/sprites/torso.png', makePNG(24, 56, scale2x(torsoPx)));
writeFileSync('public/sprites/arm.png',   makePNG(16, 40, scale2x(armPx)));
writeFileSync('public/sprites/leg.png',   makePNG(16, 44, scale2x(legPx)));
writeFileSync('public/sprites/gun.png',   makePNG(36, 28, scale2x(gunPx)));
// Other sprites — unchanged
writeFileSync('public/sprites/fireball.png', makePNG(36, 36, fireballPx));
writeFileSync('public/sprites/life_dot.png', makePNG(10, 10, lifeDotPx));
writeFileSync('public/sprites/platform.png', makePNG(64, 26, platformPx));

console.log('Wrote public/sprites/head.png      (40×44,  2× — display 20×22)');
console.log('Wrote public/sprites/torso.png     (24×56,  2× — display 12×28)');
console.log('Wrote public/sprites/arm.png       (16×40,  2× — display 8×20)');
console.log('Wrote public/sprites/leg.png       (16×44,  2× — display 8×22)');
console.log('Wrote public/sprites/gun.png       (36×28,  2× — display 38×14)');
console.log('Wrote public/sprites/fireball.png  (36×36)');
console.log('Wrote public/sprites/life_dot.png  (10×10)');
console.log('Wrote public/sprites/platform.png  (64×26)');
