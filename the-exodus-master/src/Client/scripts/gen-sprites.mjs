// Generates placeholder PNG sprite files for character body parts.
// Run with: node scripts/gen-sprites.mjs  (from the src/Client directory)
// Replace the output PNGs with your own pixel art at the same dimensions.
//
// Sizes:  head 20x22,  torso 12x28,  arm 8x20,  leg 8x22
// Torso/arms/legs are white-base — tinted per player colour at runtime.
// Head is not tinted — draw it with the intended face colours.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { deflateSync }                          from 'node:zlib';

// Only writes a file if it doesn't already exist — preserves custom art.
// Pass --force to regenerate all files regardless.
const FORCE = process.argv.includes('--force');
function writeSprite(filePath, buffer) {
  if (!FORCE && existsSync(filePath)) {
    console.log(`Skipped  ${filePath}  (already exists — use --force to overwrite)`);
    return;
  }
  writeFileSync(filePath, buffer);
}

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

// monster_head.png  60×60  — blob creature: green body, yellow eyes, white fangs
function monsterHeadPx(x, y) {
  const cx = 29.5, cy = 29.5;
  const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  if (d > 29) return [0, 0, 0, 0];                              // outside blob
  if (d > 24) return [30, 90, 20, 255];                         // dark outline
  // left eye: small yellow circle at (14,18)
  const el = Math.sqrt((x - 14) ** 2 + (y - 18) ** 2);
  if (el < 7) return el < 4 ? [20, 20, 20, 255] : [255, 220, 40, 255];
  // right eye: small yellow circle at (45,18)
  const er = Math.sqrt((x - 45) ** 2 + (y - 18) ** 2);
  if (er < 7) return er < 4 ? [20, 20, 20, 255] : [255, 220, 40, 255];
  // mouth grin (y 36-42, x 12-48)
  if (y >= 36 && y <= 42 && x >= 12 && x <= 48) {
    if (y === 36 || y === 42) return [30, 90, 20, 255];          // mouth border
    // fangs
    if ((x >= 16 && x <= 20) || (x >= 24 && x <= 28) ||
        (x >= 32 && x <= 36) || (x >= 40 && x <= 44)) return [245, 245, 245, 255];
    return [20, 20, 20, 255];                                     // dark mouth interior
  }
  return [60, 160, 40, 255];                                     // green body
}

// monster_leg.png  10×30  — stubby orange-green leg, pivot at top
function monsterLegPx(x, y) {
  if (x === 0 || x === 9 || y === 29) return [30, 90, 20, 255]; // outline
  if (y < 10)  return [80, 180, 50, 255];                        // upper lighter
  return [50, 140, 30, 255];                                     // lower darker
}

// weapon_staff.png  38×14  — same wrist-mount slot as gun; origin (0, 5/14)
// A gnarled wooden shaft with a glowing blue orb at the tip.
function weaponStaffPx(x, y) {
  // orb at right (x 28-37)
  const orbCx = 33, orbCy = 6.5;
  const od = Math.sqrt((x - orbCx) ** 2 + (y - orbCy) ** 2);
  if (x >= 28 && od <= 5.5) {
    if (od <= 2.5) return [200, 230, 255, 255]; // bright core
    if (od <= 4)   return [100, 160, 255, 240]; // blue glow
    return [60, 100, 220, 160];                 // faint rim
  }
  // shaft: rows 5-8, cols 0-28
  if (y >= 5 && y <= 8 && x <= 28) {
    if (y === 5 || y === 8) return [80, 50, 20, 255];  // outline
    if (x % 7 < 2)          return [100, 65, 25, 255]; // knot texture
    return [140, 90, 40, 255];                          // wood
  }
  return [0, 0, 0, 0];
}

// weapon_bow.png  38×14  — bow pointing right, arc curving up/down
function weaponBowPx(x, y) {
  // bowstring: thin vertical line at x=33, y 1-12
  if (x === 33 && y >= 1 && y <= 12) return [200, 190, 160, 255];
  // limb: curved arc from (0,7) to (33,1) and (33,12) — quadratic-ish
  const t = x / 33;
  const midY = 7 - 6 * (t * (1 - t)) * 2; // curve upward in middle
  if (x < 34 && Math.abs(y - midY) < 1.2) return [120, 80, 30, 255]; // upper limb
  const midY2 = 7 + 6 * (t * (1 - t)) * 2; // curve downward
  if (x < 34 && Math.abs(y - midY2) < 1.2) return [120, 80, 30, 255]; // lower limb
  // grip wrap at x 15-18
  if (x >= 15 && x <= 18 && y >= 4 && y <= 10) return [80, 50, 20, 255];
  return [0, 0, 0, 0];
}

// weapon_sword.png  38×14  — blade pointing right, guard at x~10, grip on left
function weaponSwordPx(x, y) {
  // blade: y 5-8, x 10-37 (tapering tip)
  if (x >= 10 && y >= 5 && y <= 8) {
    const w = 37 - x; // taper near tip
    const half = 1.5 + 1.5 * Math.min(1, (37 - x) / 20);
    if (Math.abs(y - 6.5) > half) return [0, 0, 0, 0];
    if (Math.abs(y - 6.5) > half - 0.8) return [150, 160, 180, 255]; // edge
    return [200, 215, 235, 255]; // blade face
  }
  // guard: x 7-12, full height
  if (x >= 7 && x <= 11 && y >= 2 && y <= 11) {
    if (x === 7 || x === 11 || y === 2 || y === 11) return [80, 70, 20, 255];
    return [180, 150, 40, 255]; // gold guard
  }
  // grip: y 5-8, x 0-7
  if (x < 7 && y >= 5 && y <= 8) {
    if (y === 5 || y === 8) return [60, 35, 15, 255];
    return [100, 60, 25, 255]; // leather
  }
  return [0, 0, 0, 0];
}

// arrow.png  24×8  — horizontal, tip on right, fletching on left
function arrowPx(x, y) {
  // shaft: y 3-4, x 3-20
  if (y >= 3 && y <= 4 && x >= 3 && x <= 20) return [160, 120, 60, 255];
  // arrowhead: triangle on right
  const tipX = 23, tipY = 3.5;
  if (x >= 17 && Math.abs(y - tipY) <= (23 - x) * 0.5) return [180, 190, 210, 255];
  // fletching: left end, two angled fins
  if (x <= 4) {
    if ((y <= 2 && x >= 1) || (y >= 5 && x >= 1)) return [180, 60, 60, 255]; // red feather
  }
  return [0, 0, 0, 0];
}

// sword_swing.png  60×60  — white arc flash in top-right quadrant
function swordSwingPx(x, y) {
  const cx = 0, cy = 60; // arc center at bottom-left
  const r = Math.sqrt(x * x + (y - 60) ** 2);
  if (r < 15 || r > 55) return [0, 0, 0, 0];
  // only the top-right quadrant
  if (x < 0 || y > 60) return [0, 0, 0, 0];
  const t = (r - 15) / 40; // 0=inner, 1=outer
  const alpha = Math.round(220 * (1 - Math.abs(t - 0.5) * 2));
  if (alpha <= 0) return [0, 0, 0, 0];
  return [255, 240, 160, alpha];
}

// ── Write files ───────────────────────────────────────────────────────────────

// scale2x: doubles canvas size of any pixel function without changing shapes
const scale2x = (fn) => (x, y) => fn(x / 2, y / 2);

mkdirSync('public/sprites', { recursive: true });
// Character body parts — 2× resolution for detailed pixel art; display sizes in app.ts unchanged
writeSprite('public/sprites/head.png',  makePNG(40, 44, scale2x(headPx)));
writeSprite('public/sprites/torso.png', makePNG(24, 56, scale2x(torsoPx)));
writeSprite('public/sprites/arm.png',   makePNG(16, 40, scale2x(armPx)));
writeSprite('public/sprites/leg.png',   makePNG(16, 44, scale2x(legPx)));
writeSprite('public/sprites/gun.png',   makePNG(36, 28, scale2x(gunPx)));
// Monster parts — 2× resolution; display 60×60 head, 10×30 legs
writeSprite('public/sprites/monster_head.png', makePNG(120, 120, scale2x(monsterHeadPx)));
writeSprite('public/sprites/monster_leg.png',  makePNG(20,  60,  scale2x(monsterLegPx)));
// Other sprites — unchanged
writeSprite('public/sprites/fireball.png', makePNG(36, 36, fireballPx));
writeSprite('public/sprites/life_dot.png', makePNG(10, 10, lifeDotPx));
writeSprite('public/sprites/platform.png', makePNG(64, 26, platformPx));
// Weapon sprites — same wrist-mount convention as gun (origin 0, 5/14 when held)
writeSprite('public/sprites/weapon_staff.png',  makePNG(76, 28, scale2x(weaponStaffPx)));
writeSprite('public/sprites/weapon_bow.png',    makePNG(76, 28, scale2x(weaponBowPx)));
writeSprite('public/sprites/weapon_sword.png',  makePNG(76, 28, scale2x(weaponSwordPx)));
writeSprite('public/sprites/arrow.png',         makePNG(24,  8, arrowPx));
writeSprite('public/sprites/sword_swing.png',   makePNG(60, 60, swordSwingPx));

console.log('Done. Run with --force to regenerate all sprites regardless of existing files.');
