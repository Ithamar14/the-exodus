import Phaser from "phaser";

// ── constants — must stay in sync with GameWorld.cs ──────────────────────────
const W = 1024;
const H = 768;
const GROUND_Y = H - 88;   // player center Y at ground (680)
const HALF_H = 27;          // player center → feet offset
const GRAVITY = 900;
const JUMP_VY = -560;
const WALK_SPEED = 220;

// (cx, surfaceY, w) — surfaceY is the top edge; landing center Y = surfaceY - HALF_H
const PLATFORMS = [
  { cx: 150, sy: 597, w: 200 },
  { cx: 512, sy: 587, w: 180 },
  { cx: 850, sy: 597, w: 200 },
  { cx: 280, sy: 447, w: 140 },
  { cx: 730, sy: 457, w: 140 },
  { cx: 512, sy: 337, w: 120 },
] as const;

// ─────────────────────────────────────────────────────────────────────────────

class SandboxScene extends Phaser.Scene {
  private px = W / 2;
  private py = GROUND_Y;
  private vx = 0;
  private vy = 0;
  private grounded = false;
  private facingDir = 1;
  private walkPhase = 0;

  private figure!: Phaser.GameObjects.Container;
  private shadow!: Phaser.GameObjects.Ellipse;
  private infoText!: Phaser.GameObjects.Text;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;

  constructor() { super("sandbox"); }

  create(): void {
    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.keyA = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyD = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keyW = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keySpace = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // Background
    const bg = this.add.graphics();
    bg.fillGradientStyle(0xf0dca8, 0xf0dca8, 0xe8c07a, 0xe8c07a, 1);
    bg.fillRect(0, 0, W, H);
    bg.fillStyle(0xd4a05a, 0.35);
    bg.fillEllipse(200, H - 80, 520, 130);
    bg.fillEllipse(700, H - 70, 680, 110);
    bg.fillEllipse(1000, H - 85, 380, 120);

    // Ground
    const gsy = GROUND_Y + HALF_H;
    const groundH = H - gsy;
    this.add.rectangle(W / 2, gsy + groundH / 2, W, groundH + 4, 0xc8864e).setDepth(2);
    const gg = this.add.graphics().setDepth(3);
    gg.fillStyle(0x9a5f2e, 1); gg.fillRect(0, gsy, W, 6);
    gg.fillStyle(0xd4a462, 0.5); gg.fillRect(0, gsy + 6, W, 5);

    // Platforms
    for (const p of PLATFORMS) {
      this.add.rectangle(p.cx, p.sy + 10, p.w, 20, 0xc8864e).setDepth(5);
      this.add.rectangle(p.cx, p.sy + 23, p.w, 6, 0x7a4820, 0.45).setDepth(5);
      const pg = this.add.graphics().setDepth(6);
      pg.fillStyle(0x9a5f2e, 1); pg.fillRect(p.cx - p.w / 2, p.sy, p.w, 6);
      pg.fillStyle(0xd4a462, 0.55); pg.fillRect(p.cx - p.w / 2, p.sy + 6, p.w, 4);
    }

    // Player — container at (px, py) = player center
    this.figure = this.add.container(this.px, this.py).setDepth(100);
    this.shadow = this.add.ellipse(0, HALF_H, 42, 12, 0x000000, 0.22);
    const torso = this.add.rectangle(0, -2, 8, 26, 0x2a6fdb);
    torso.setStrokeStyle(2, 0x332010, 0.25);
    const head = this.add.ellipse(0, -28, 18, 20, 0xf0c8a6);
    head.setStrokeStyle(2, 0x332010, 0.18);
    const eyeL = this.add.ellipse(-4, -30, 2.2, 2.2, 0x2c1c12);
    const eyeR = this.add.ellipse(4, -30, 2.2, 2.2, 0x2c1c12);
    const legL = this.add.rectangle(-4, 14, 4, 18, 0x2a6fdb).setOrigin(0.5, 0);
    const legR = this.add.rectangle(4, 14, 4, 18, 0x2a6fdb).setOrigin(0.5, 0);
    this.figure.add([this.shadow, legL, legR, torso, head, eyeL, eyeR]);

    // Info overlay
    this.infoText = this.add.text(10, 10, "", {
      fontFamily: "monospace",
      fontSize: "13px",
      color: "#301d0a",
      backgroundColor: "rgba(255,240,200,0.78)",
      padding: { x: 8, y: 6 }
    }).setDepth(200);
  }

  update(_time: number, delta: number): void {
    const dt = delta / 1000;
    const left = this.cursors.left.isDown || this.keyA.isDown;
    const right = this.cursors.right.isDown || this.keyD.isDown;
    const jump = Phaser.Input.Keyboard.JustDown(this.cursors.up)
      || Phaser.Input.Keyboard.JustDown(this.keyW)
      || Phaser.Input.Keyboard.JustDown(this.keySpace);

    const dirX = (right ? 1 : 0) - (left ? 1 : 0);

    // ── physics — mirrors MovePlayerPhysics in GameWorld.cs exactly ──────────
    this.vx = dirX * WALK_SPEED;
    this.vy += GRAVITY * dt;

    if (jump && this.grounded) {
      this.vy = JUMP_VY;
      this.grounded = false;
    }

    const prevFeetY = this.py + HALF_H;
    this.px += this.vx * dt;
    this.py += this.vy * dt;
    this.px = Phaser.Math.Clamp(this.px, 0, W);
    const newFeetY = this.py + HALF_H;

    if (this.py >= GROUND_Y) {
      this.py = GROUND_Y;
      this.vy = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
      if (this.vy >= 0) {
        for (const p of PLATFORMS) {
          if (prevFeetY > p.sy || newFeetY < p.sy) continue;
          if (this.px < p.cx - p.w * 0.5 || this.px > p.cx + p.w * 0.5) continue;
          this.py = p.sy - HALF_H;
          this.vy = 0;
          this.grounded = true;
          break;
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (dirX !== 0) this.facingDir = dirX;

    const moving = Math.abs(this.vx) > 0.1 || !this.grounded;
    this.walkPhase += delta * (moving ? 0.012 : 0.004);
    const step = Math.sin(this.walkPhase);

    // Shadow stays on the surface below the player (same logic as app.ts)
    const heightAboveGround = Math.max(0, GROUND_Y - this.py);
    const shadowScale = Math.max(0.35, 1 - heightAboveGround / 350);
    this.shadow.y = heightAboveGround + HALF_H;
    this.shadow.scaleX = shadowScale;
    this.shadow.scaleY = shadowScale;

    this.figure.x = this.px;
    this.figure.y = this.py;
    this.figure.scaleX = this.facingDir * (moving ? 1 + Math.abs(step) * 0.02 : 1);

    this.infoText.setText([
      "A/D or ←/→ to move  •  W / ↑ / Space to jump",
      `x=${this.px.toFixed(0)}  y=${this.py.toFixed(0)}  vy=${this.vy.toFixed(0)}  grounded=${this.grounded}`,
      "Sandbox — no server needed",
    ].join("\n"));
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: W,
  height: H,
  backgroundColor: "#dca15a",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [SandboxScene]
});
