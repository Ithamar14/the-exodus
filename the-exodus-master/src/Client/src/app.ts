import Phaser from "phaser";
import { version as APP_VERSION } from "../package.json";
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel
} from "@microsoft/signalr";
import {
  clamp,
  computeComicKnockback,
  computeWaveFoamDots,
  computeWaveSegments,
  deriveRoundView,
  deriveRoundControlState,
  formatStatusLabel,
  formatRoundStatusLabel,
  hashString,
  type RoundControlAction,
  type GameEventSnapshot,
  type PlayerView,
  type RoundView,
  type MannaPickupSnapshot,
  type WorldSnapshot,
  type CloudSnapshot,
  type WaveSnapshot,
  type FireballSnapshot,
  GROUND_Y,
  WORLD_HEIGHT,
  WORLD_WIDTH
} from "./model";
import "./style.css";

type TunableField = {
  key: string;
  label: string;
  category: string;
  min: number;
  max: number;
  step: number;
  value: number;
};

type UiRefs = {
  app: HTMLDivElement;
  layout: HTMLDivElement;
  sidebar: HTMLDivElement;
  stage: HTMLDivElement;
  gameRoot: HTMLDivElement;
  roundState: HTMLDivElement;
  roundDetail: HTMLDivElement;
  roundAction: HTMLButtonElement;
  statusText: HTMLDivElement;
  banner: HTMLDivElement;
  waveWarning: HTMLDivElement;
  waveNotice: HTMLDivElement;
  cloudNotice: HTMLDivElement;
  mannaNotice: HTMLDivElement;
  joinPanel: HTMLFormElement;
  joinButton: HTMLButtonElement;
  nameInput: HTMLInputElement;
  playerList: HTMLUListElement;
  playerCount: HTMLSpanElement;
  roomBadge: HTMLSpanElement;
  connectionBadge: HTMLSpanElement;
  tuningPanel: HTMLElement;
  tuningFields: HTMLDivElement;
  tuningApply: HTMLButtonElement;
  tuningNotice: HTMLDivElement;
};

type SceneHooks = {
  onInput: (dirX: number, jump: boolean) => void;
};

type AvatarDebugState = {
  id: string;
  x: number;
  y: number;
  depth: number;
  moving: boolean;
  figureRotation: number;
  rootRotation: number;
  legFrontRotation: number;
  legBackRotation: number;
  armFrontRotation: number;
  armBackRotation: number;
  emoteText: string;
  emoteVisible: boolean;
  emoteExpiresInMs: number;
};

type SceneDebugState = {
  serverTimeMs: number;
  cloudActive: boolean;
  waveActive: boolean;
  mannaActive: boolean;
  mannaPhase: "inactive" | "steady" | "blink" | "expired";
  avatars: AvatarDebugState[];
};

// Must match GameWorld.Platforms in GameWorld.cs: { cx, surfaceY, w }
const PLATFORMS = [
  { cx: 150, sy: 597, w: 200 },
  { cx: 512, sy: 587, w: 180 },
  { cx: 850, sy: 597, w: 200 },
  { cx: 280, sy: 447, w: 140 },
  { cx: 730, sy: 457, w: 140 },
  { cx: 512, sy: 337, w: 120 },
] as const;

type FireballVisual = {
  x: number;
  y: number;
  dirX: number;
  trail: Array<{ x: number; y: number }>;
  trailTimer: number;
};
let FIREBALL_SPEED = 680;        // px/s — kept in sync with server FireballSpeed rule
const FIREBALL_TRAIL_EVERY = 3;  // frames between trail samples
const FIREBALL_TRAIL_MAX = 10;   // how many trail points to keep

type EmoteCode = "dove" | "trumpet" | "bread" | "laugh" | "wave";
const MANNA_NOTICE_TEXT = "הִנְנִי מַמְטִיר לָכֶם מָן מִן-הַשָּׁמָיִם";
const WAVE_NOTICE_TEXT = "וַיָּבֹאוּ בְנֵי-יִשְׂרָאֵל בְּתוֹךְ הַיָּם, בַּיַּבָּשָׁה";
const CLOUD_NOTICE_TEXT = "וַה' הֹלֵךְ לִפְנֵיהֶם יוֹמָם בְּעַמּוּד עָנָן לַנְחֹתָם הַדֶּרֶךְ";

declare global {
  interface Window {
    __desertDebugState?: SceneDebugState;
  }
}

class SoundBoard {
  private context: AudioContext | null = null;
  private unlocked = false;

  public unlock(): void {
    if (typeof window === "undefined") {
      return;
    }

    if (!this.context) {
      this.context = new window.AudioContext();
    }

    if (this.context.state === "suspended") {
      void this.context.resume();
    }

    this.unlocked = true;
  }

  public playBump(): void {
    this.ensureUnlocked();
    this.pluck([
      { frequency: 220, type: "square", gain: 0.05 },
      { frequency: 132, type: "triangle", gain: 0.04 }
    ], 0.11);
  }

  public playDeath(): void {
    this.ensureUnlocked();
    this.pluck([
      { frequency: 96, type: "sawtooth", gain: 0.06 },
      { frequency: 58, type: "triangle", gain: 0.05 }
    ], 0.22);
  }

  public playWin(): void {
    this.ensureUnlocked();
    this.pluck([
      { frequency: 392, type: "sine", gain: 0.04, delay: 0 },
      { frequency: 494, type: "sine", gain: 0.04, delay: 0.08 },
      { frequency: 587, type: "sine", gain: 0.05, delay: 0.16 }
    ], 0.45);
  }

  private ensureUnlocked(): void {
    if (!this.unlocked) {
      this.unlock();
    }
  }

  private pluck(
    notes: Array<{ frequency: number; type: OscillatorType; gain: number; delay?: number }>,
    duration: number
  ): void {
    if (!this.context) {
      return;
    }

    const now = this.context.currentTime;
    for (const note of notes) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = note.type;
      oscillator.frequency.value = note.frequency;
      gain.gain.setValueAtTime(0.0001, now + (note.delay ?? 0));
      gain.gain.exponentialRampToValueAtTime(note.gain, now + 0.02 + (note.delay ?? 0));
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration + (note.delay ?? 0));
      oscillator.connect(gain);
      gain.connect(this.context.destination);
      oscillator.start(now + (note.delay ?? 0));
      oscillator.stop(now + duration + 0.1 + (note.delay ?? 0));
    }
  }
}

class PlayerAvatar {
  public readonly id: string;
  private readonly scene: Phaser.Scene;
  private readonly root: Phaser.GameObjects.Container;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly mannaHalo: Phaser.GameObjects.Ellipse;
  private readonly figure: Phaser.GameObjects.Container;
  private readonly torso: Phaser.GameObjects.Image;
  private readonly head: Phaser.GameObjects.Image;
  private readonly armBack: Phaser.GameObjects.Image;
  private readonly armFront: Phaser.GameObjects.Image;
  private readonly gun: Phaser.GameObjects.Image;
  private readonly legBack: Phaser.GameObjects.Image;
  private readonly legFront: Phaser.GameObjects.Image;
  private readonly nameLabel: Phaser.GameObjects.Text;
  private readonly emoteLabel: Phaser.GameObjects.Text;
  private readonly liveDots: Phaser.GameObjects.Arc[];
  private targetX: number;
  private targetY: number;
  private facingDir = 1;
  private isAlive = true;
  private isInvincible = false;
  private isWinner = false;
  private isMoving = false;
  private hasCollectedMannaThisCycle = false;
  private victoryMode = false;
  private walkPhase = 0;
  private recoilTimer = 0;
  private emoteText = "";
  private emoteExpiresAtMs = 0;
  private readonly bobSeed: number;
  private bodyColor: number;

  public constructor(scene: Phaser.Scene, view: PlayerView) {
    this.scene = scene;
    this.id = view.id;
    this.bobSeed = (hashString(`${view.id}:bob`) % 1000) / 1000;
    this.bodyColor = view.color;
    this.targetX = view.x;
    this.targetY = view.y;

    this.root = scene.add.container(view.x, view.y);
    this.root.setDepth(500);

    this.shadow = scene.add.ellipse(0, 27, 42, 12, 0x000000, 0.22);
    this.mannaHalo = scene.add.ellipse(0, -10, 34, 22, 0xffd85d, 0);
    this.mannaHalo.setStrokeStyle(2, 0xfff4b5, 0);
    this.figure = scene.add.container(0, 0);
    this.nameLabel = scene.add.text(0, 50, view.name, {
      fontFamily: '"Trebuchet MS", "Gill Sans", sans-serif',
      fontSize: "15px",
      color: "#301d0a",
      stroke: "#fff4d8",
      strokeThickness: 4
    }).setOrigin(0.5, 0);
    this.emoteLabel = scene.add.text(0, -60, "", {
      fontFamily: '"Trebuchet MS", "Gill Sans", sans-serif',
      fontSize: "24px",
      stroke: "#2b1708",
      strokeThickness: 5
    }).setOrigin(0.5, 1);
    this.emoteLabel.setAlpha(0);

    this.liveDots = [-7, 0, 7].map((dx) => {
      const dot = scene.add.circle(dx, -52, 4, 0xff2222, 1);
      dot.setStrokeStyle(1.5, 0x880000, 0.9);
      return dot;
    });

    this.torso   = scene.add.image(0,  -2, 'char_torso').setOrigin(0.5, 0.5 ).setDisplaySize(12, 28);
    this.head    = scene.add.image(0, -23, 'char_head' ).setOrigin(0.5, 0.5 ).setDisplaySize(20, 22);
    this.armBack = scene.add.image(-8, -9, 'char_arm'  ).setOrigin(0.5, 0.08).setDisplaySize(8,  20);
    this.armFront= scene.add.image( 8, -9, 'char_arm'  ).setOrigin(0.5, 0.08).setDisplaySize(8,  20);

    // Gun — wrist pivot at origin row 5 of sprite. Barrel points right (+x). Follows armFront each frame.
    this.gun = scene.add.image(0, 0, 'char_gun').setOrigin(0, 5 / 14).setDisplaySize(38, 14);

    this.legBack = scene.add.image(-5, 12, 'char_leg').setOrigin(0.5, 0.08).setDisplaySize(8, 22);
    this.legFront= scene.add.image( 5, 12, 'char_leg').setOrigin(0.5, 0.08).setDisplaySize(8, 22);

    this.figure.add([
      this.legBack,
      this.legFront,
      this.torso,
      this.armBack,
      this.armFront,
      this.gun,
      this.head,
    ]);
    this.root.add([this.shadow, this.mannaHalo, this.figure, ...this.liveDots, this.nameLabel, this.emoteLabel]);
    this.sync(view);
  }

  public sync(view: PlayerView): void {
    this.facingDir = view.facingDir;
    this.targetX = view.x;
    this.targetY = view.y;
    this.bodyColor = view.color;
    this.nameLabel.setText(view.name);
    this.nameLabel.setColor(view.isWinner
      ? "#8b3f04"
      : (view.isAlive ? (view.hasCollectedMannaThisCycle ? "#9a7200" : "#301d0a") : "#6d5845"));
    this.shadow.setAlpha(view.isAlive ? 0.22 : 0.12);
    this.figure.setAlpha(view.isAlive ? 1 : 0.34);
    this.mannaHalo.setAlpha(view.isAlive && view.hasCollectedMannaThisCycle ? 0.38 : 0);
    this.applyColors();
    this.isAlive = view.isAlive;
    this.isWinner = view.isWinner;
    this.isMoving = view.isMoving;
    this.hasCollectedMannaThisCycle = view.hasCollectedMannaThisCycle;
    this.isInvincible = view.isInvincible;

    const lives = view.lives;
    for (let i = 0; i < this.liveDots.length; i++) {
      this.liveDots[i].setFillStyle(i < lives ? 0xff2222 : 0x444444, i < lives ? 1 : 0.35);
      this.liveDots[i].setVisible(view.isAlive);
    }
  }

  public update(deltaMs: number, nowMs: number, wind: { x: number; y: number }): void {
    const lerp = Math.min(1, deltaMs / 100);
    const destinationX = this.victoryMode && this.isWinner ? (WORLD_WIDTH * 0.5) : this.targetX;
    const destinationY = this.victoryMode && this.isWinner ? (WORLD_HEIGHT * 0.54) : this.targetY;
    this.root.x = Phaser.Math.Linear(this.root.x, destinationX, lerp);
    this.root.y = Phaser.Math.Linear(this.root.y, destinationY, lerp);
    this.root.setDepth(this.victoryMode && this.isWinner ? 965 : 500);

    const distanceToTarget = Math.hypot(destinationX - this.root.x, destinationY - this.root.y);
    const moving = this.isAlive && this.isMoving && !this.victoryMode;
    const pace = moving ? 0.010 + (distanceToTarget * 0.0015) : 0.0035;
    this.walkPhase += deltaMs * pace;

    const step = Math.sin(this.walkPhase + (this.bobSeed * Math.PI * 2));
    const bob = Math.abs(step);
    const facing = this.facingDir;
    const bodyBob = moving ? bob : Math.sin(this.walkPhase + 1.3) * 0.35 + 0.35;
    const bodySquish = moving ? (1 + (bob * 0.02)) : (1 - (Math.abs(Math.sin(this.walkPhase)) * 0.055));
    const bodyLean = moving ? step * 0.08 : 0;

    if (this.victoryMode && this.isWinner) {
      this.root.scaleX = 1.68;
      this.root.scaleY = 1.68;
      this.figure.scaleX = facing;
      this.figure.scaleY = 1;
      this.figure.x = 0;
      this.figure.y = 0;
      this.figure.rotation = 0;
      this.root.rotation = 0;
      this.torso.y = -2;
      this.head.y = -23;
      this.head.scaleX = 1; // figure.scaleX = facing, so combined = facing
    } else {
      this.root.scaleX = 1;
      this.root.scaleY = 1;
      this.figure.scaleX = facing * bodySquish;
      this.figure.scaleY = moving ? 1 + (bob * 0.02) : 1 + (bodyBob * 0.03);
      this.figure.x = (moving ? step * 0.7 : 0) + (wind.x * 0.24);
      this.figure.y = (moving ? -bob * 0.9 : -bodyBob * 0.85) + (wind.y * 0.24);
      this.figure.rotation = bodyLean;
      this.root.rotation = 0;
      this.torso.y = moving ? -2 + (bob * 0.6) : -2 + (bodyBob * 0.85);
      this.head.y = moving ? -23 + (bob * 0.15) : -23 + (bodyBob * 0.78);
      this.head.scaleX = 1 / bodySquish; // cancel container squish → effective scaleX = facing
    }

    if (this.victoryMode && this.isWinner) {
      const seed = this.bobSeed * 10;
      this.armBack.rotation = Math.sin((nowMs / 95) + seed) * 2.3;
      this.armFront.rotation = Math.sin((nowMs / 88) + seed + 1.6) * 2.3;
      this.legBack.rotation = Math.sin((nowMs / 72) + seed + 3.3) * 2.5;
      this.legFront.rotation = Math.sin((nowMs / 66) + seed + 4.7) * 2.5;
    } else if (moving) {
      this.armBack.rotation = -step * 0.4;
      this.armFront.rotation = step * 0.4;
      this.legBack.rotation = step * 0.72;
      this.legFront.rotation = -step * 0.72;
    } else {
      this.armBack.rotation = 0;
      this.armFront.rotation = 0;
      this.legBack.rotation = 0;
      this.legFront.rotation = 0;
    }

    if (this.recoilTimer > 0) {
      this.recoilTimer = Math.max(0, this.recoilTimer - deltaMs);
      const progress = this.recoilTimer / 220;
      const kick = Math.sin(progress * Math.PI / 2) * 0.7;
      this.armFront.rotation -= kick;
    }

    // Track gun to armFront's hand: arm is 20px tall, pivot at 0.08 → 18.4px to bottom
    const armR = this.armFront.rotation;
    this.gun.x = 8 - 18.4 * Math.sin(armR);
    this.gun.y = -9 + 18.4 * Math.cos(armR);
    this.gun.rotation = armR;
    this.gun.setVisible(this.isAlive && !this.victoryMode);

    const heightAboveGround = Math.max(0, GROUND_Y - this.root.y);
    const shadowGroundOffset = heightAboveGround + 27;
    const shadowScale = Math.max(0.35, 1 - heightAboveGround / 350);
    this.shadow.x = wind.x * 0.3;
    this.shadow.y = shadowGroundOffset + (wind.y * 0.36);
    this.shadow.scaleX = this.isAlive ? (moving ? shadowScale * (1 + bob * 0.08) : shadowScale * 0.92) : shadowScale * 0.84;
    this.shadow.scaleY = this.isAlive ? (moving ? shadowScale * (1 + bob * 0.03) : shadowScale * 0.86) : shadowScale * 0.84;

    if (this.isInvincible && this.isAlive) {
      this.figure.setAlpha(Math.sin(nowMs / 70) > 0 ? 1 : 0.15);
    } else if (this.isAlive) {
      this.figure.setAlpha(1);
    }

    this.mannaHalo.y = -9 + (this.hasCollectedMannaThisCycle ? Math.sin(nowMs / 120) * 0.5 : 0);
    this.mannaHalo.scaleX = this.hasCollectedMannaThisCycle ? 1 + (Math.sin(nowMs / 180) * 0.03) : 1;
    this.mannaHalo.scaleY = this.hasCollectedMannaThisCycle ? 1 + (Math.cos(nowMs / 180) * 0.03) : 1;
    this.nameLabel.y = 50 + (moving ? bob * 0.7 : 0);
    const emoteVisible = this.emoteText.length > 0 && nowMs < this.emoteExpiresAtMs;
    if (emoteVisible) {
      const emotePhase = nowMs - (this.emoteExpiresAtMs - 5000);
      this.emoteLabel.setAlpha(1);
      this.emoteLabel.setText(this.emoteText);
      this.emoteLabel.setScale(1 + (Math.sin(emotePhase / 180) * 0.04));
      this.emoteLabel.y = -64 + (Math.sin(emotePhase / 220) * 2.4);
    } else {
      this.emoteLabel.setAlpha(0);
      this.emoteLabel.setText("");
      this.emoteLabel.setScale(1);
      this.emoteLabel.y = -60;
      this.emoteText = "";
    }
  }

  public showEmote(emote: string): void {
    this.emoteText = emote;
    this.emoteExpiresAtMs = this.scene.time.now + 5000;
    this.emoteLabel.setText(emote);
    this.emoteLabel.setAlpha(1);
    this.emoteLabel.setScale(1.08);
  }

  public triggerRecoil(): void {
    this.recoilTimer = 220;
  }

  public bump(impulseX: number, impulseY: number): void {
    if (!this.isAlive) {
      return;
    }

    const launch = computeComicKnockback(impulseX, impulseY, 240);
    this.scene.tweens.add({
      targets: this.figure,
      x: launch.x * 0.16,
      y: launch.y * 0.16,
      rotation: (launch.x >= 0 ? 1 : -1) * 0.28,
      duration: 170,
      yoyo: true,
      ease: "Sine.easeOut"
    });
  }

  public die(reason: string | null, drift: { x: number; y: number }): void {
    if (!this.isAlive) {
      return;
    }

    this.isAlive = false;
    const burstBias = reason === "wave" ? 0.014 : 0.01;
    this.scene.tweens.add({
      targets: this.figure,
      alpha: 0.18,
      scaleX: this.figure.scaleX * 0.96,
      scaleY: 0.72,
      duration: 220,
      ease: "Cubic.easeOut"
    });

    this.scene.tweens.add({
      targets: this.shadow,
      alpha: 0.08,
      scaleX: 0.78,
      scaleY: 0.78,
      duration: 220,
      ease: "Cubic.easeOut"
    });

    this.scene.tweens.add({
      targets: this.root,
      rotation: 0,
      x: this.root.x + (drift.x * burstBias),
      y: this.root.y + (drift.y * burstBias),
      duration: 220,
      ease: "Cubic.easeOut"
    });
  }

  public win(): void {
    this.isWinner = true;
  }

  public pulseManna(): void {
    if (!this.isAlive) {
      return;
    }

    this.scene.tweens.add({
      targets: this.mannaHalo,
      alpha: 0.85,
      scaleX: 1.45,
      scaleY: 1.45,
      duration: 120,
      yoyo: true,
      ease: "Quad.easeOut"
    });
  }

  public setVictoryMode(enabled: boolean): void {
    this.victoryMode = enabled;
    this.root.setAlpha(enabled ? (this.isWinner ? 1 : 0) : 1);
    this.shadow.setAlpha(enabled ? 0 : (this.isAlive ? 0.22 : 0.12));
    this.mannaHalo.setAlpha(enabled ? 0 : (this.hasCollectedMannaThisCycle && this.isAlive ? 0.38 : 0));
    for (const dot of this.liveDots) dot.setVisible(!enabled && this.isAlive);
    if (!enabled) {
      this.root.setScale(1);
    }
  }

  public get position(): { x: number; y: number } {
    return { x: this.root.x, y: this.root.y };
  }

  public get facing(): number {
    return this.facingDir;
  }

  public getDebugState(): AvatarDebugState {
    return {
      id: this.id,
      x: this.root.x,
      y: this.root.y,
      depth: this.root.depth,
      moving: this.isMoving,
      figureRotation: this.figure.rotation,
      rootRotation: this.root.rotation,
      legFrontRotation: this.legFront.rotation,
      legBackRotation: this.legBack.rotation,
      armFrontRotation: this.armFront.rotation,
      armBackRotation: this.armBack.rotation,
      emoteText: this.emoteText,
      emoteVisible: this.emoteText.length > 0 && this.scene.time.now < this.emoteExpiresAtMs,
      emoteExpiresInMs: Math.max(0, this.emoteExpiresAtMs - this.scene.time.now)
    };
  }

  public destroy(): void {
    this.root.destroy(true);
  }

  private applyColors(): void {
    this.torso.setTint(this.bodyColor);
    this.armBack.setTint(this.bodyColor);
    this.armFront.setTint(this.bodyColor);
    this.legBack.setTint(this.bodyColor);
    this.legFront.setTint(this.bodyColor);
  }
}

class CloudDarknessOverlay {
  private readonly darkness: Phaser.GameObjects.Rectangle;
  private readonly maskShape: Phaser.GameObjects.Graphics;
  private readonly darknessMask: Phaser.Display.Masks.GeometryMask;
  private readonly smoke: Phaser.GameObjects.Graphics;
  private cloud: CloudSnapshot;
  private alpha = 0;
  private centerX = WORLD_WIDTH * 0.5;
  private centerY = WORLD_HEIGHT * 0.5;
  private radius = 140;

  public constructor(scene: Phaser.Scene, initialCloud: CloudSnapshot) {
    this.darkness = scene.add.rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 0x020406, 0);
    this.darkness.setOrigin(0, 0);
    this.darkness.setDepth(880);
    this.maskShape = scene.make.graphics({ x: 0, y: 0, add: false });
    this.darknessMask = this.maskShape.createGeometryMask();
    this.darknessMask.invertAlpha = true;
    this.darkness.setMask(this.darknessMask);
    this.smoke = scene.add.graphics();
    this.smoke.setDepth(881);
    this.cloud = initialCloud;
    this.sync(initialCloud);
  }

  public sync(cloud: CloudSnapshot): void {
    this.cloud = cloud;
    if (cloud.x != null && cloud.y != null && cloud.radius != null) {
      this.centerX = cloud.x;
      this.centerY = cloud.y;
      this.radius = cloud.radius;
    }
  }

  public draw(nowMs: number): void {
    const targetAlpha = this.cloud.isActive ? 0.62 : 0;
    this.alpha = Phaser.Math.Linear(this.alpha, targetAlpha, this.cloud.isActive ? 0.08 : 0.05);

    this.darkness.setFillStyle(0x020406, this.alpha);
    this.maskShape.clear();
    this.smoke.clear();

    if (this.alpha <= 0.01) {
      return;
    }

    this.maskShape.fillStyle(0xffffff, 1);
    this.maskShape.fillCircle(this.centerX, this.centerY, this.radius);

    const smokeCount = 46;
    for (let index = 0; index < smokeCount; index += 1) {
      const seed = (index * 0.37) + (index % 7) * 0.13;
      const orbit = this.radius * (0.24 + (((index * 13) % 100) / 100) * 0.76);
      const angle = (nowMs / (1700 + (index * 11))) + seed;
      const drift = Math.sin((nowMs / 430) + seed * 4.2) * (this.radius * 0.16);
      const x = this.centerX + (Math.cos(angle) * orbit * 0.55) + drift;
      const y = this.centerY + (Math.sin(angle * 1.2) * orbit * 0.42) - (drift * 0.4);
      const radius = 5 + ((index % 5) * 1.9);
      const distanceFromCenter = Math.hypot(x - this.centerX, y - this.centerY);
      if ((distanceFromCenter + radius) > (this.radius * 0.96)) {
        continue;
      }

      const alpha = 0.07 + (((index * 17) % 100) / 100) * 0.12;
      this.smoke.fillStyle(0xf4f6f8, alpha * this.alpha);
      this.smoke.fillCircle(x, y, radius);
    }
  }
}

class WaveOverlay {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private wave: WaveSnapshot;
  private visible = false;

  public constructor(scene: Phaser.Scene, initialWave: WaveSnapshot) {
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(860);
    this.wave = initialWave;
  }

  public sync(wave: WaveSnapshot, visible: boolean): void {
    this.wave = wave;
    this.visible = visible;
  }

  public draw(nowMs: number): void {
    this.graphics.clear();
    if (!this.visible) {
      return;
    }

    if (!this.wave.isActive) {
      return;
    }

    const segments = computeWaveSegments(this.wave);
    const foamShift = Math.sin(nowMs / 180) * 3;

    for (const segment of segments) {
      this.graphics.fillStyle(0x356c8a, 1);
      this.graphics.fillRect(segment.x, segment.y, segment.width, segment.height);
      this.graphics.lineStyle(2, 0xf9fdff, 0.95);
      this.graphics.strokeRect(segment.x, segment.y, segment.width, segment.height);
    }

    const foamDots = computeWaveFoamDots(this.wave);
    for (const dot of foamDots) {
      const pulse = 0.86 + (Math.sin((nowMs / 180) + dot.segmentIndex + foamShift) * 0.08);
      const wavePhase = (nowMs / 160) + (dot.segmentIndex * 0.85) + ((dot.side === "left" || dot.side === "right" ? dot.y : dot.x) * 0.022);
      const waveOffset = Math.sin(wavePhase) * 2.6;
      const animatedX = dot.side === "left" || dot.side === "right" ? dot.x + waveOffset : dot.x;
      const animatedY = dot.side === "top" || dot.side === "bottom" ? dot.y + waveOffset : dot.y;
      this.graphics.fillStyle(0xfffdf5, clamp(0.68 + (pulse * 0.18), 0.55, 0.98));
      this.graphics.fillCircle(animatedX, animatedY, dot.radius);
      this.graphics.lineStyle(1, 0xfffdf5, clamp(0.5 + (pulse * 0.2), 0.35, 0.9));
      this.graphics.strokeCircle(animatedX, animatedY, dot.radius + 0.4);
    }
  }
}

class DecorationDirector {
  private readonly scene: Phaser.Scene;

  public constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  public spawnDustBurst(x: number, y: number, drift: { x: number; y: number }): void {
    const amount = 14;
    for (let index = 0; index < amount; index += 1) {
      const angle = (index / amount) * Math.PI * 2;
      const radius = 6 + Math.random() * 12;
      const piece = this.scene.add.circle(x, y, 2 + Math.random() * 2, 0xdab06d, 0.92);
      piece.setDepth(930);
      this.scene.tweens.add({
        targets: piece,
        x: x + (Math.cos(angle) * radius * 5) + (drift.x * 1.2),
        y: y + (Math.sin(angle) * radius * 5) + (drift.y * 1.2),
        alpha: 0,
        scaleX: 0.2,
        scaleY: 0.2,
        duration: 650 + (Math.random() * 220),
        ease: "Quad.easeOut",
        onComplete: () => piece.destroy()
      });
    }
  }

  public spawnConfetti(x: number, y: number): void {
    const colors = [0xffe66d, 0xff8f5e, 0x7ad9ff, 0xffffff, 0xc8ff77];
    for (let index = 0; index < 28; index += 1) {
      const piece = this.scene.add.rectangle(x, y, 6, 10, colors[index % colors.length], 1);
      piece.setDepth(940);
      piece.rotation = Math.random() * Math.PI;
      this.scene.tweens.add({
        targets: piece,
        x: x + (Math.random() * 280) - 140,
        y: y - 180 - (Math.random() * 220),
        rotation: piece.rotation + ((Math.random() * 6) - 3),
        alpha: 0,
        duration: 1400 + (Math.random() * 500),
        ease: "Cubic.easeOut",
        onComplete: () => piece.destroy()
      });
    }
  }

  public spawnMannaBurst(x: number, y: number): void {
    for (let index = 0; index < 14; index += 1) {
      const angle = (index / 14) * Math.PI * 2;
      const distance = 6 + (Math.random() * 16);
      const piece = this.scene.add.circle(x, y, 1.8 + (Math.random() * 1.8), 0xffdc63, 0.92);
      piece.setDepth(915);
      this.scene.tweens.add({
        targets: piece,
        x: x + (Math.cos(angle) * distance * 3.5),
        y: y - 10 + (Math.sin(angle) * distance * 3.5),
        alpha: 0,
        scaleX: 0.2,
        scaleY: 0.2,
        duration: 620 + (Math.random() * 180),
        ease: "Quad.easeOut",
        onComplete: () => piece.destroy()
      });
    }
  }
}

type MannaPickupVisual = {
  container: Phaser.GameObjects.Container;
  glow: Phaser.GameObjects.Ellipse;
  gem: Phaser.GameObjects.Ellipse;
  shine: Phaser.GameObjects.Rectangle;
  sparkle: Phaser.GameObjects.Ellipse;
  isCollected: boolean;
  baseY: number;
  pulseSeed: number;
};

class MannaDirector {
  private readonly scene: Phaser.Scene;
  private readonly decorations: DecorationDirector;
  private readonly pickups = new Map<string, MannaPickupVisual>();
  private currentCycleId: number | null = null;
  private currentView: RoundView | null = null;
  private localCollected = new Set<string>();

  public constructor(scene: Phaser.Scene, decorations: DecorationDirector) {
    this.scene = scene;
    this.decorations = decorations;
  }

  public sync(view: RoundView): void {
    this.currentView = view;
    const manna = view.manna;

    if (!manna.isActive) {
      this.currentCycleId = manna.cycleId;
      this.localCollected.clear();
      this.clearAll();
      return;
    }

    if (this.currentCycleId !== manna.cycleId) {
      this.clearAll();
      this.currentCycleId = manna.cycleId;
      this.localCollected.clear();
    }

    const seen = new Set<string>();
    const players = view.players.filter((player) => player.isAlive);
    const playback = this.getPlaybackState(view.serverTimeMs);

    for (const pickup of manna.pickups) {
      seen.add(pickup.id);
      const visual = this.pickups.get(pickup.id) ?? this.createPickupVisual(pickup);
      visual.baseY = pickup.y;
      this.updatePickupVisual(visual, pickup, view.serverTimeMs, playback.phase);
      this.pickups.set(pickup.id, visual);

      if (playback.phase !== "expired" && !pickup.isCollected && !this.localCollected.has(pickup.id)) {
        const collector = players.find((player) => Math.hypot(player.x - pickup.x, player.y - pickup.y) <= 28);
        if (collector) {
          this.localCollected.add(pickup.id);
          this.collectPickup(visual, pickup, collector);
        }
      }
    }

    for (const [pickupId, visual] of this.pickups.entries()) {
      if (seen.has(pickupId)) {
        continue;
      }

      visual.container.destroy(true);
      this.pickups.delete(pickupId);
    }
  }

  public update(nowMs: number): void {
    if (!this.currentView) {
      return;
    }

    const playback = this.getPlaybackState(nowMs);
    if (playback.phase === "inactive") {
      return;
    }

    for (const visual of this.pickups.values()) {
      const wave = Math.sin((nowMs / 220) + visual.pulseSeed) * 2.4;
      visual.container.y = visual.baseY + wave;
      visual.container.setDepth(visual.container.y + 1);
      if (!visual.isCollected) {
        if (playback.phase === "blink") {
          const blink = Math.sin(nowMs / 130 + visual.pulseSeed * 12) > 0 ? 1 : 0.18;
          visual.container.setAlpha(blink);
        } else if (playback.phase === "expired") {
          visual.container.setAlpha(0);
        } else {
          visual.container.setAlpha(0.86);
        }
        visual.container.scaleX = 1 + (Math.sin(nowMs / 420 + visual.pulseSeed) * 0.02);
        visual.container.scaleY = 1 + (Math.cos(nowMs / 420 + visual.pulseSeed) * 0.02);
      }
    }
  }

  public getPlaybackState(_nowMs: number): { cycleId: number | null; phase: "inactive" | "steady" | "blink" | "expired"; elapsedMs: number } {
    if (!this.currentView || this.currentCycleId == null) {
      return { cycleId: this.currentCycleId, phase: "inactive", elapsedMs: 0 };
    }
    const manna = this.currentView.manna;
    if (!manna.isActive) {
      return { cycleId: this.currentCycleId, phase: "inactive", elapsedMs: 0 };
    }

    const secondsUntilDisappear = Math.max(0, manna.secondsUntilDisappear ?? 0);
    const secondsUntilBlink = Math.max(0, manna.secondsUntilBlink ?? 0);
    const elapsedMs = Math.max(0, (10 - secondsUntilDisappear) * 1000);
    if (secondsUntilDisappear <= 0.01) {
      return { cycleId: this.currentCycleId, phase: "expired", elapsedMs };
    }

    if (manna.isBlinking || secondsUntilBlink <= 0.01) {
      return { cycleId: this.currentCycleId, phase: "blink", elapsedMs };
    }

    return { cycleId: this.currentCycleId, phase: "steady", elapsedMs };
  }

  private createPickupVisual(pickup: MannaPickupSnapshot): MannaPickupVisual {
    const container = this.scene.add.container(pickup.x, pickup.y);
    container.setDepth(pickup.y + 1);
    const glow = this.scene.add.ellipse(0, 2, 34, 14, 0xf8db72, 0.18);
    const gem = this.scene.add.ellipse(0, 0, 16, 11, 0xf2c84b, 0.88);
    gem.setStrokeStyle(1, 0xfff1b0, 0.7);
    const shine = this.scene.add.rectangle(-2, -1, 3, 11, 0xfff5cb, 0.72).setRotation(Math.PI / 5);
    const sparkle = this.scene.add.ellipse(4, -4, 4, 4, 0xffffff, 0.72);
    container.add([glow, gem, shine, sparkle]);

    return {
      container,
      glow,
      gem,
      shine,
      sparkle,
      isCollected: false,
      baseY: pickup.y,
      pulseSeed: (hashString(pickup.id) % 1000) / 1000
    };
  }

  private updatePickupVisual(
    visual: MannaPickupVisual,
    pickup: MannaPickupSnapshot,
    nowMs: number,
    phase: "inactive" | "steady" | "blink" | "expired"
  ): void {
    const collected = pickup.isCollected || this.localCollected.has(pickup.id);
    visual.isCollected = collected;
    visual.container.x = pickup.x;
    visual.container.y = pickup.y + (Math.sin(nowMs / 220 + visual.pulseSeed) * 2.4);
    visual.container.setDepth(visual.container.y + 1);
    if (collected || phase === "expired" || phase === "inactive") {
      visual.container.setAlpha(0);
    } else if (phase === "blink") {
      visual.container.setAlpha(Math.sin(nowMs / 130 + visual.pulseSeed * 12) > 0 ? 1 : 0.18);
    } else {
      visual.container.setAlpha(1);
    }
  }

  private collectPickup(visual: MannaPickupVisual, pickup: MannaPickupSnapshot, collector: PlayerView): void {
    visual.isCollected = true;
    this.decorations.spawnMannaBurst(pickup.x, pickup.y);
    visual.container.setDepth(930);
    this.scene.tweens.add({
      targets: visual.container,
      alpha: 0,
      scaleX: 1.28,
      scaleY: 1.28,
      duration: 180,
      ease: "Quad.easeOut",
      onComplete: () => {
        visual.container.setAlpha(0);
        visual.container.setScale(1);
      }
    });

    const avatar = (this.scene as DesertScene).getAvatar(collector.id);
    avatar?.pulseManna();
  }

  private clearAll(): void {
    for (const visual of this.pickups.values()) {
      visual.container.destroy(true);
    }
    this.pickups.clear();
  }
}

class DesertScene extends Phaser.Scene {
  private readonly hooks: SceneHooks;
  private readonly audio = new SoundBoard();
  private readonly avatars = new Map<string, PlayerAvatar>();
  private cloudOverlay: CloudDarknessOverlay | null = null;
  private waveOverlay: WaveOverlay | null = null;
  private decorations: DecorationDirector | null = null;
  private mannaDirector: MannaDirector | null = null;
  private victoryBackdrop: Phaser.GameObjects.Rectangle | null = null;
  private victoryTitle: Phaser.GameObjects.Text | null = null;
  private victorySubtitle: Phaser.GameObjects.Text | null = null;
  private nextVictoryConfettiAt = 0;
  private currentView: RoundView | null = null;
  private readonly fireballs = new Map<string, FireballVisual>();
  private fireballGfx!: Phaser.GameObjects.Graphics;

  public constructor(hooks: SceneHooks, initialWave: WaveSnapshot, initialCloud: CloudSnapshot) {
    super("desert");
    this.hooks = hooks;
    void initialWave;
    void initialCloud;
  }

  public preload(): void {
    const graphics = this.add.graphics();
    // Sky: warm tan fading to hazy horizon
    graphics.fillGradientStyle(0xf0dca8, 0xf0dca8, 0xe8c07a, 0xe8c07a, 1);
    graphics.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    // Distant dune silhouettes on the horizon
    graphics.fillStyle(0xd4a05a, 0.35);
    graphics.fillEllipse(200, WORLD_HEIGHT - 80, 520, 130);
    graphics.fillEllipse(700, WORLD_HEIGHT - 70, 680, 110);
    graphics.fillEllipse(1000, WORLD_HEIGHT - 85, 380, 120);
    graphics.generateTexture("desert-bg", WORLD_WIDTH, WORLD_HEIGHT);
    graphics.destroy();
    // Sprite files live in public/sprites/ — replace with your own pixel art at the same sizes.
    // Sizes: head 20×22, torso 12×28, arm 8×20, leg 8×22 (px)
    // Torso/arms/legs are tinted per player colour — draw them white/light for best results.
    // Head is not tinted — draw it with the intended face colours.
    this.load.image('char_head',  'sprites/head.png');
    this.load.image('char_torso', 'sprites/torso.png');
    this.load.image('char_arm',   'sprites/arm.png');
    this.load.image('char_leg',   'sprites/leg.png');
    this.load.image('char_gun',   'sprites/gun.png');
  }

  public create(): void {
    this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, "desert-bg");
    this.addGround();
    this.addPlatforms();
    this.addDunes();
    this.victoryBackdrop = this.add.rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, 0x000000, 0).setDepth(930);
    this.victoryBackdrop.setVisible(false);
    this.victoryTitle = this.add.text(WORLD_WIDTH / 2, 194, "", {
      fontFamily: '"Trebuchet MS", "Gill Sans", sans-serif',
      fontSize: "54px",
      fontStyle: "900",
      color: "#fff5cf",
      stroke: "#000000",
      strokeThickness: 8,
      align: "center"
    }).setOrigin(0.5, 0.5).setDepth(970);
    this.victoryTitle.setVisible(false);
    this.victorySubtitle = this.add.text(WORLD_WIDTH / 2, 252, "", {
      fontFamily: '"Trebuchet MS", "Gill Sans", sans-serif',
      fontSize: "20px",
      color: "#fff0b4",
      stroke: "#000000",
      strokeThickness: 6,
      align: "center"
    }).setOrigin(0.5, 0.5).setDepth(970);
    this.victorySubtitle.setVisible(false);
    const wave = this.currentView?.wave ?? {
      isActive: false,
      side: null,
      gapAxis: null,
      gapStart: null,
      gapEnd: null,
      progress: null,
      frontCoordinate: null,
      thickness: null
    };
    const cloud = this.currentView?.cloud ?? {
      isActive: false,
      x: null,
      y: null,
      radius: 140,
      secondsUntilResolve: null
    };
    this.cloudOverlay = new CloudDarknessOverlay(this, cloud);
    this.waveOverlay = new WaveOverlay(this, wave);
    this.decorations = new DecorationDirector(this);
    this.mannaDirector = new MannaDirector(this, this.decorations);
    this.fireballGfx = this.add.graphics().setDepth(700);

    this.add.text(8, 8, `v${APP_VERSION}`, {
      fontFamily: '"Trebuchet MS", "Gill Sans", sans-serif',
      fontSize: "13px",
      color: "#c8996a"
    }).setDepth(995).setOrigin(0, 0).setAlpha(0.65).setScrollFactor(0);

    if (this.currentView) {
      this.syncRound(this.currentView, null);
    }
  }

  public syncRound(view: RoundView, selfId: string | null, fireballs: FireballSnapshot[]): void {
    this.currentView = view;
    if (!this.cloudOverlay || !this.waveOverlay || !this.decorations) {
      return;
    }

    this.cloudOverlay.sync(view.cloud);
    this.waveOverlay.sync(view.wave, view.wave.isActive);
    this.syncPlayers(view.players, selfId);
    this.syncVictory(view);
    this.mannaDirector?.sync(view);
    this.playEvents(view.events, view);
    this.syncFireballs(fireballs);
  }

  public syncFireballs(serverFireballs: FireballSnapshot[]): void {
    // remove fireballs no longer on server
    const serverIds = new Set(serverFireballs.map((fb) => fb.id));
    for (const id of this.fireballs.keys()) {
      if (!serverIds.has(id)) this.fireballs.delete(id);
    }
    // add or update from server
    for (const fb of serverFireballs) {
      const existing = this.fireballs.get(fb.id);
      if (existing) {
        existing.x = fb.x;
        existing.y = fb.y;
      } else {
        this.fireballs.set(fb.id, { x: fb.x, y: fb.y, dirX: fb.dirX, trail: [], trailTimer: 0 });
        this.avatars.get(fb.ownerId)?.triggerRecoil();
      }
    }
  }

  private updateFireballs(delta: number): void {
    const dt = delta / 1000;
    this.fireballGfx.clear();

    for (const fb of this.fireballs.values()) {
      fb.x += fb.dirX * FIREBALL_SPEED * dt;

      fb.trailTimer++;
      if (fb.trailTimer >= FIREBALL_TRAIL_EVERY) {
        fb.trailTimer = 0;
        fb.trail.unshift({ x: fb.x, y: fb.y });
        if (fb.trail.length > FIREBALL_TRAIL_MAX) fb.trail.pop();
      }

      for (let t = 0; t < fb.trail.length; t++) {
        const frac = 1 - t / fb.trail.length;
        this.fireballGfx.fillStyle(0xff6600, frac * 0.42);
        this.fireballGfx.fillCircle(fb.trail[t].x, fb.trail[t].y, 8 * frac);
      }

      this.fireballGfx.fillStyle(0xff4400, 0.22);
      this.fireballGfx.fillCircle(fb.x, fb.y, 18);
      this.fireballGfx.fillStyle(0xff6600, 0.78);
      this.fireballGfx.fillCircle(fb.x, fb.y, 10);
      this.fireballGfx.fillStyle(0xffee88, 1);
      this.fireballGfx.fillCircle(fb.x, fb.y, 5);
    }
  }

  public update(_time: number, delta: number): void {
    if (!this.currentView) {
      return;
    }

    const now = this.time.now;
    const wind = { x: 0, y: 0 };

    for (const avatar of this.avatars.values()) {
      avatar.update(delta, now, wind);
    }

    this.cloudOverlay?.draw(now);
    this.waveOverlay?.draw(now);
    this.mannaDirector?.update(now);
    this.updateFireballs(delta);

    if (this.currentView?.gameOver && this.currentView.winner && this.decorations && now >= this.nextVictoryConfettiAt) {
      const centerX = WORLD_WIDTH * 0.5;
      const centerY = WORLD_HEIGHT * 0.58;
      this.decorations.spawnConfetti(centerX, centerY - 30);
      this.decorations.spawnConfetti(centerX - 40, centerY + 10);
      this.decorations.spawnConfetti(centerX + 40, centerY + 10);
      this.decorations.spawnConfetti(centerX, centerY + 40);
      this.nextVictoryConfettiAt = now + 120;
    }
  }

  public getCurrentView(): RoundView | null {
    return this.currentView;
  }

  public getAvatar(id: string): PlayerAvatar | null {
    return this.avatars.get(id) ?? null;
  }

  public getMannaPlaybackState(nowMs = this.time.now): { cycleId: number | null; phase: "inactive" | "steady" | "blink" | "expired"; elapsedMs: number } {
    return this.mannaDirector?.getPlaybackState(nowMs) ?? { cycleId: null, phase: "inactive", elapsedMs: 0 };
  }

  public showEmote(playerId: string, code: EmoteCode): void {
    const avatar = this.avatars.get(playerId);
    if (!avatar) {
      return;
    }

    avatar.showEmote(resolveEmoteGlyph(code));
  }

  public getDebugState(): SceneDebugState | null {
    if (!this.currentView) {
      return null;
    }

    return {
      serverTimeMs: this.currentView.serverTimeMs,
      cloudActive: this.currentView.cloud.isActive,
      waveActive: this.currentView.wave.isActive,
      mannaActive: this.currentView.manna.isActive,
      mannaPhase: this.getMannaPlaybackState().phase,
      avatars: [...this.avatars.values()]
        .map((avatar) => avatar.getDebugState())
        .sort((left, right) => left.id.localeCompare(right.id))
    };
  }

  private syncPlayers(players: PlayerView[], selfId: string | null): void {
    const seen = new Set<string>();

    for (const player of players) {
      seen.add(player.id);
      const existing = this.avatars.get(player.id);
      if (existing) {
        existing.sync(player);
        continue;
      }

      const avatar = new PlayerAvatar(this, player);
      this.avatars.set(player.id, avatar);
    }

    const victoryActive = Boolean(this.currentView?.gameOver && this.currentView?.winner);
    for (const [playerId, avatar] of this.avatars.entries()) {
      if (seen.has(playerId)) {
        const player = players.find((entry) => entry.id === playerId);
        avatar.setVictoryMode(victoryActive && Boolean(player?.isWinner));
        continue;
      }

      avatar.destroy();
      this.avatars.delete(playerId);
    }
  }

  private playEvents(events: GameEventSnapshot[], view: RoundView): void {
    for (const event of events) {
      switch (event.type) {
        case "wave_spawned":
          this.cameras.main.shake(30, 0.002);
          break;
        case "cloud_spawned":
          this.cameras.main.flash(90, 214, 220, 232);
          this.cameras.main.shake(70, 0.0018);
          break;
        case "cloud_resolved":
          break;
        case "player_bumped": {
          this.audio.playBump();
          const left = this.avatars.get(event.playerId ?? "");
          const right = this.avatars.get(event.otherPlayerId ?? "");
          if (left) {
            left.bump(event.impulseX ?? 0, event.impulseY ?? 0);
          }
          if (right) {
            right.bump(-(event.impulseX ?? 0), -(event.impulseY ?? 0));
          }
          this.decorations?.spawnDustBurst(view.serverTimeMs);
          break;
        }
        case "player_died": {
          this.audio.playDeath();
          const avatar = this.avatars.get(event.playerId ?? "");
          if (avatar) {
            avatar.die(event.reason ?? null, { x: 0, y: 0 });
            this.decorations?.spawnDustBurst(event.x ?? avatar.position.x, event.y ?? avatar.position.y, { x: 0, y: 0 });
          }
          break;
        }
        case "winner_declared": {
          this.audio.playWin();
          const avatar = this.avatars.get(event.playerId ?? "");
          if (avatar) {
            avatar.win();
            this.decorations?.spawnConfetti(event.x ?? avatar.position.x, (event.y ?? avatar.position.y) - 24);
          }
          this.cameras.main.flash(120, 255, 239, 142);
          this.cameras.main.shake(160, 0.003);
          break;
        }
        case "player_lost_life":
          this.audio.playBump();
          break;
        case "manna_cycle_spawned":
          break;
        case "manna_collected": {
          const avatar = this.avatars.get(event.playerId ?? "");
          if (avatar) {
            avatar.pulseManna();
          }
          if (event.x != null && event.y != null) {
            this.decorations?.spawnMannaBurst(event.x, event.y);
          }
          break;
        }
        case "manna_cycle_resolved":
          break;
      }
    }
  }

  private syncVictory(view: RoundView): void {
    if (!this.victoryBackdrop || !this.victoryTitle || !this.victorySubtitle) {
      return;
    }

    const active = Boolean(view.gameOver && view.winner);
    const wasActive = this.victoryBackdrop.visible;
    this.victoryBackdrop.setVisible(active);
    this.victoryBackdrop.setAlpha(active ? 1 : 0);
    this.victoryBackdrop.setDepth(active ? 930 : 0);
    this.victoryTitle.setVisible(active);
    this.victorySubtitle.setVisible(active);

    if (!active || !view.winner) {
      this.nextVictoryConfettiAt = 0;
      return;
    }

    this.victoryTitle.setText(`${view.winner.name} survived the desert`);
    this.victorySubtitle.setText("The sea closes behind them. Press RESTART for the next crossing.");
    if (!wasActive) {
      this.nextVictoryConfettiAt = this.time.now;
    }
  }

  private addGround(): void {
    const groundSurfaceY = GROUND_Y + 27; // pixel Y where feet touch ground
    const groundBodyH = WORLD_HEIGHT - groundSurfaceY;
    // Ground fill
    const groundBody = this.add.rectangle(WORLD_WIDTH / 2, groundSurfaceY + groundBodyH / 2, WORLD_WIDTH, groundBodyH + 4, 0xc8864e, 1);
    groundBody.setDepth(2);
    // Ground surface stripe
    const surface = this.add.graphics();
    surface.fillStyle(0x9a5f2e, 1);
    surface.fillRect(0, groundSurfaceY, WORLD_WIDTH, 8);
    surface.fillStyle(0xd4a462, 0.5);
    surface.fillRect(0, groundSurfaceY + 8, WORLD_WIDTH, 5);
    surface.setDepth(3);
  }

  private addPlatforms(): void {
    for (const p of PLATFORMS) {
      const h = 20;
      const body = this.add.rectangle(p.cx, p.sy + h / 2, p.w, h, 0xc8864e, 1);
      body.setDepth(5);
      const under = this.add.rectangle(p.cx, p.sy + h + 3, p.w, 6, 0x7a4820, 0.45);
      under.setDepth(5);
      const g = this.add.graphics();
      g.fillStyle(0x9a5f2e, 1);
      g.fillRect(p.cx - p.w / 2, p.sy, p.w, 6);
      g.fillStyle(0xd4a462, 0.55);
      g.fillRect(p.cx - p.w / 2, p.sy + 6, p.w, 4);
      g.setDepth(6);
    }
  }

  private addDunes(): void {
    const groundSurfaceY = GROUND_Y + 27;
    const dunes = [
      { x: 150, width: 300, height: 32, alpha: 0.25 },
      { x: 530, width: 380, height: 26, alpha: 0.20 },
      { x: 900, width: 260, height: 30, alpha: 0.22 }
    ];

    for (const dune of dunes) {
      const shadow = this.add.ellipse(dune.x + 10, groundSurfaceY - dune.height * 0.25 + 6, dune.width, dune.height, 0x7a4820, dune.alpha * 0.55);
      shadow.setDepth(3);
      const ridge = this.add.ellipse(dune.x, groundSurfaceY - dune.height * 0.25, dune.width, dune.height, 0xdaa55e, dune.alpha);
      ridge.setDepth(4);
    }
  }
}

class GameClient {
  private readonly ui: UiRefs;
  private readonly scene: DesertScene;
  private connection: HubConnection | null = null;
  private joinedName = "";
  private selfId: string | null = null;
  private lastSnapshot: WorldSnapshot | null = null;
  private lastView: RoundView | null = null;
  private reconnectTimer: number | null = null;
  private bannerTimer: number | null = null;
  private pendingRoundAction: RoundControlAction | null = null;
  private hasConnectionEverStarted = false;
  private keysLeft = false;
  private keysRight = false;
  private rulesSchema: TunableField[] = [];
  private pendingRulesUpdate = false;

  private isHost(view: RoundView | null): boolean {
    if (!view || !this.selfId) {
      return false;
    }

    const hostId = view.round.firstPlayerId ?? view.round.starterId;
    return hostId != null && hostId === this.selfId;
  }

  private updateMenuVisibility(view: RoundView | null): void {
    if (!this.selfId) {
      this.ui.layout.classList.remove("menu-hidden");
      return;
    }

    if (!view) {
      this.ui.layout.classList.remove("menu-hidden");
      return;
    }

    const visible = this.isHost(view);
    this.ui.layout.classList.toggle("menu-hidden", !visible);
  }

  public constructor(ui: UiRefs) {
    this.ui = ui;
    this.scene = new DesertScene(
      {
        onInput: (dirX, jump) => this.sendInput(dirX, jump)
      },
      {
        isActive: false,
        side: null,
        gapAxis: null,
        gapStart: null,
        gapEnd: null,
        progress: null,
        frontCoordinate: null,
        thickness: null
      },
      {
        isActive: false,
        x: null,
        y: null,
        radius: 140,
        secondsUntilResolve: null
      }
    );

    new Phaser.Game({
      type: Phaser.AUTO,
      parent: this.ui.gameRoot,
      backgroundColor: "#dca15a",
      pixelArt: true,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: WORLD_WIDTH,
        height: WORLD_HEIGHT
      },
      scene: [this.scene]
    });

    this.wireUi();
    void this.ensureConnection();
  }

  private wireUi(): void {
    this.ui.joinPanel.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.join(this.ui.nameInput.value);
    });

    this.ui.nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.join(this.ui.nameInput.value);
      }
    });

    this.ui.roundAction.addEventListener("click", () => {
      void this.triggerRoundAction();
    });

    this.ui.tuningApply.addEventListener("click", () => {
      void this.applyRules();
    });

    window.addEventListener("keydown", (event) => {
      if (!this.selfId) {
        return;
      }

      let inputChanged = false;
      switch (event.key) {
        case "a":
        case "A":
        case "ArrowLeft":
          if (!this.keysLeft) { this.keysLeft = true; inputChanged = true; }
          break;
        case "d":
        case "D":
        case "ArrowRight":
          if (!this.keysRight) { this.keysRight = true; inputChanged = true; }
          break;
        case "w":
        case "W":
        case "ArrowUp":
        case " ":
          if (!event.repeat) {
            this.sendInput(this.dirX(), true);
          }
          return;
        default:
          break;
      }

      if (inputChanged) {
        this.sendInput(this.dirX(), false);
        return;
      }

      if (event.repeat) {
        return;
      }

      switch (event.key) {
        case "1":
          this.sendEmote("dove");
          break;
        case "2":
          this.sendEmote("trumpet");
          break;
        case "3":
          this.sendEmote("bread");
          break;
        case "4":
          this.sendEmote("laugh");
          break;
        case "5":
          this.sendEmote("wave");
          break;
        case "q":
        case "Q":
          this.sendFireball();
          break;
        default:
          break;
      }
    });

    window.addEventListener("keyup", (event) => {
      if (!this.selfId) {
        return;
      }

      switch (event.key) {
        case "a":
        case "A":
        case "ArrowLeft":
          this.keysLeft = false;
          this.sendInput(this.dirX(), false);
          break;
        case "d":
        case "D":
        case "ArrowRight":
          this.keysRight = false;
          this.sendInput(this.dirX(), false);
          break;
        default:
          break;
      }
    });
  }

  private async ensureConnection(): Promise<void> {
    if (this.connection && (this.connection.state === HubConnectionState.Connected || this.connection.state === HubConnectionState.Connecting)) {
      return;
    }

    this.connection = new HubConnectionBuilder()
      .withUrl("/hubs/game")
      .withAutomaticReconnect([0, 1000, 2000, 5000])
      .configureLogging(LogLevel.Warning)
      .build();

    this.connection.on("Joined", ({ selfId }: { selfId: string }) => {
      this.selfId = selfId;
      this.keysLeft = false;
      this.keysRight = false;
      this.sendInput(0, false);
      this.ui.joinPanel.classList.add("hidden");
      this.setConnectionStatus("Connected", "A/D to move, W or Space to jump. Press 1-5 for emotes.", "success");
      this.updateRoomBadge();
      this.updateRoundPanel(this.lastView);
      this.updateMenuVisibility(this.lastView);
      this.updateTuningPanelVisibility(this.lastView);
      void this.connection.send("GetRules");
    });

    this.connection.on("RulesSchema", (payload: { fields: TunableField[] }) => {
      this.rulesSchema = payload.fields;
      const fbSpeed = payload.fields.find(f => f.key === "FireballSpeed");
      if (fbSpeed != null) FIREBALL_SPEED = fbSpeed.value;
      this.buildTuningPanel();
      if (this.pendingRulesUpdate) {
        this.pendingRulesUpdate = false;
        this.showTuningNotice("Settings saved.", "success");
      }
    });

    this.connection.on("RulesUpdateRejected", (payload: { reason: string }) => {
      const msg = payload.reason === "round_active"
        ? "Cannot change settings during an active round."
        : "Changes rejected — only the host can edit settings.";
      this.showTuningNotice(msg, "danger");
    });

    this.connection.on("JoinRejected", (payload: { reason: string; game_over?: boolean; gameOver?: boolean }) => {
      const gameOver = Boolean(payload.game_over || payload.gameOver || payload.reason === "game_over");
      this.selfId = null;
      if (gameOver) {
        this.ui.joinPanel.classList.add("hidden");
        this.setConnectionStatus("Round over", "A wanderer already crossed the sea.", "danger");
      } else {
        this.ui.joinPanel.classList.remove("hidden");
        this.setConnectionStatus("Join failed", this.describeJoinError(payload.reason), "danger");
      }
      this.updateRoomBadge();
      this.updateMenuVisibility(this.lastView);
    });

    this.connection.on("WorldSnapshot", (snapshot: WorldSnapshot) => {
      this.handleSnapshot(snapshot);
    });

    this.connection.on("RoundStarted", ({ starterId }: { starterId: string }) => {
      this.pendingRoundAction = null;
      if (starterId === this.selfId) {
        this.setBanner("Round started", "The sea path is opening again.", "success", false);
      }
      this.updateRoundPanel(this.lastView);
    });

    this.connection.on("RoundRestarted", ({ starterId }: { starterId: string }) => {
      this.pendingRoundAction = null;
      if (starterId === this.selfId) {
        this.setBanner("Round restarted", "The crossing has been reset.", "success", false);
      }
      this.updateRoundPanel(this.lastView);
    });

    this.connection.on("RoundActionRejected", (payload: { action: RoundControlAction; reason: string }) => {
      this.pendingRoundAction = null;
      this.setBanner(
        "Action rejected",
        this.describeRoundActionError(payload.action, payload.reason),
        "danger",
        false
      );
      this.updateRoundPanel(this.lastView);
    });

    this.connection.on("PlayerEmoted", ({ playerId, code }: { playerId: string; code: EmoteCode }) => {
      this.scene.showEmote(playerId, code);
    });

    this.connection.onreconnecting(() => {
      this.selfId = null;
      this.pendingRoundAction = null;
      this.setConnectionStatus("Reconnecting", "The Exodus link dropped.", "info");
      this.ui.joinPanel.classList.remove("hidden");
      this.updateRoundPanel(this.lastView);
      this.updateMenuVisibility(this.lastView);
      this.updateTuningPanelVisibility(this.lastView);
    });

    this.connection.onreconnected(async () => {
      this.setConnectionStatus("Reconnected", "Rejoining the shared crossing.", "info");
      if (this.joinedName) {
        await this.join(this.joinedName);
      }
    });

    this.connection.onclose(() => {
      this.selfId = null;
      this.pendingRoundAction = null;
      this.setConnectionStatus("Offline", "Trying again in a moment.", "danger");
      this.ui.joinPanel.classList.remove("hidden");
      this.connection = null;
      this.updateRoundPanel(this.lastView);
      this.updateMenuVisibility(this.lastView);
      this.updateTuningPanelVisibility(this.lastView);
      if (this.reconnectTimer != null) {
        window.clearTimeout(this.reconnectTimer);
      }
      this.reconnectTimer = window.setTimeout(() => {
        void this.ensureConnection();
      }, 1200);
    });

    try {
      await this.connection.start();
      this.hasConnectionEverStarted = true;
      this.setConnectionStatus("Connected", "Enter a name to join the crossing.", "success");
      this.updateRoomBadge();
    } catch {
      this.setConnectionStatus("Offline", "Waiting to connect to the crossing server.", "danger");
      this.pendingRoundAction = null;
      if (this.reconnectTimer != null) {
        window.clearTimeout(this.reconnectTimer);
      }
      this.reconnectTimer = window.setTimeout(() => {
        void this.ensureConnection();
      }, 1200);
    }
  }

  private async join(name: string): Promise<void> {
    void this.tryLockLandscape();
    const trimmed = name.trim().slice(0, 20);
    if (!trimmed) {
      this.setConnectionStatus("Name required", "Enter a wanderer name before joining.", "danger");
      return;
    }

    this.joinedName = trimmed;
    await this.ensureConnection();
    if (!this.connection || this.connection.state !== HubConnectionState.Connected) {
      this.setConnectionStatus("Offline", "Could not reach the server yet.", "danger");
      return;
    }

    this.ui.joinButton.disabled = true;
    this.ui.joinButton.textContent = "Joining...";
    try {
      await this.connection.send("Join", { name: trimmed });
      this.setConnectionStatus("Joining", "Waiting for the server to place the wanderer.", "info");
    } catch {
      this.setConnectionStatus("Join failed", "The server did not accept the join request.", "danger");
    } finally {
      this.ui.joinButton.disabled = false;
      this.ui.joinButton.textContent = "Join";
    }
  }

  private async tryLockLandscape(): Promise<void> {
    if (typeof window === "undefined") {
      return;
    }

    const orientation = window.screen?.orientation;
    if (!orientation?.lock) {
      return;
    }

    try {
      await orientation.lock("landscape");
    } catch {
      // Best-effort only; some browsers require stricter gesture conditions.
    }
  }

  private dirX(): number {
    return (this.keysRight ? 1 : 0) - (this.keysLeft ? 1 : 0);
  }

  private sendInput(dirX: number, jump: boolean): void {
    if (!this.connection || this.connection.state !== HubConnectionState.Connected || !this.selfId) {
      return;
    }

    void this.connection.send("SetInput", { dirX, jump });
  }

  private sendFireball(): void {
    if (!this.connection || this.connection.state !== HubConnectionState.Connected || !this.selfId) {
      return;
    }

    void this.connection.send("ShootFireball");
  }

  private sendEmote(code: EmoteCode): void {
    if (!this.connection || this.connection.state !== HubConnectionState.Connected || !this.selfId) {
      return;
    }

    void this.connection.send("Emote", { code });
  }

  private handleSnapshot(snapshot: WorldSnapshot): void {
    const previous = this.lastSnapshot;
    const view = deriveRoundView(snapshot, previous ?? undefined);
    this.scene.syncRound(view, this.selfId, snapshot.fireballs ?? []);
    this.updateRoundPanel(view);
    this.updateSpecialNotices(view);
    this.updateDebugState(view);
    this.renderSidebar(view);
    this.updateMenuVisibility(view);
    this.updateTuningPanelVisibility(view);
    this.renderBanner(view);
    this.updateConnectionSummary(view);
    this.updateRoomBadge();
    this.lastSnapshot = snapshot;
    this.lastView = view;
  }

  private renderSidebar(view: RoundView): void {
    this.ui.playerList.replaceChildren();
    const sorted = [...view.players].sort((left, right) => {
      if (left.id === this.selfId) {
        return -1;
      }

      if (right.id === this.selfId) {
        return 1;
      }

      if (left.status === "winner" && right.status !== "winner") {
        return -1;
      }

      if (right.status === "winner" && left.status !== "winner") {
        return 1;
      }

      if (left.isAlive && !right.isAlive) {
        return -1;
      }

      if (!left.isAlive && right.isAlive) {
        return 1;
      }

      return left.name.localeCompare(right.name);
    });

    if (sorted.length === 0) {
      const empty = document.createElement("li");
      empty.className = "player-empty";
      empty.textContent = "No wanderers yet. The first one leads the crossing.";
      this.ui.playerList.append(empty);
      this.ui.playerCount.textContent = "0";
      return;
    }

    for (const player of sorted) {
      const item = document.createElement("li");
      item.className = `player-row ${player.status}${player.id === this.selfId ? " self" : ""}`;

      const name = document.createElement("span");
      name.className = "player-name";
      name.textContent = player.name;

      const state = document.createElement("span");
      state.className = "player-state";
      state.textContent = formatStatusLabel(player);

      item.append(name, state);
      this.ui.playerList.append(item);
    }

    this.ui.playerCount.textContent = `${sorted.length}`;
  }

  private renderBanner(view: RoundView): void {
    const event = view.events.length > 0 ? view.events[view.events.length - 1] : undefined;

    if (event?.type === "winner_declared" && view.winner) {
      this.clearBanner();
      return;
    }

    if (event?.type === "player_died") {
      const player = view.players.find((entry) => entry.id === event.playerId);
      const reason = event.reason === "wave"
        ? "to the sea wall"
        : (event.reason === "boundary"
          ? "in the desert"
          : (event.reason === "starved"
            ? "from hunger"
            : (event.reason === "darkness" ? "in the darkness" : "in the desert")));
      this.setBanner("The desert takes one", `${player?.name ?? "A wanderer"} was lost ${reason}.`, "danger", false);
      return;
    }

    if (view.gameOver && view.winner) {
      this.clearBanner();
      return;
    }

    this.clearBanner();
  }

  private updateRoundPanel(view: RoundView | null): void {
    if (!view) {
      this.ui.roundState.textContent = "Waiting to start";
      this.ui.roundState.dataset.tone = "info";
      this.ui.roundDetail.textContent = "The first wanderer can press START when the crossing is ready.";
      this.ui.roundAction.classList.add("hidden");
      this.ui.roundAction.disabled = false;
      this.ui.roundAction.textContent = "START";
      delete this.ui.roundAction.dataset.tone;
      return;
    }

    const control = deriveRoundControlState(view.round, this.selfId);
    this.ui.roundState.textContent = formatRoundStatusLabel(view.status);
    this.ui.roundState.dataset.tone = view.status === "active"
      ? "success"
      : (view.status === "game-over" ? "danger" : "info");
    this.ui.roundDetail.textContent = this.describeRoundState(view, control);

    if (control.visible) {
      this.ui.roundAction.classList.remove("hidden");
      this.ui.roundAction.textContent = control.label;
      this.ui.roundAction.dataset.tone = control.tone;
      this.ui.roundAction.disabled = !control.enabled || this.pendingRoundAction != null;
    } else {
      this.ui.roundAction.classList.add("hidden");
      this.ui.roundAction.disabled = false;
      this.ui.roundAction.textContent = "START";
      delete this.ui.roundAction.dataset.tone;
    }
  }

  private updateConnectionSummary(view: RoundView): void {
    if (!this.selfId) {
      return;
    }

    const alive = view.alivePlayers.length;
    const total = view.players.length;
    this.setConnectionStatus(
      this.connection?.state === HubConnectionState.Connected ? "Connected" : (this.hasConnectionEverStarted ? "Reconnecting" : "Offline"),
      `${alive}/${total} alive.`,
      alive <= 1 || view.gameOver ? "success" : "info"
    );
  }

  private updateSpecialNotices(view: RoundView): void {
    const mannaState = this.scene.getMannaPlaybackState(view.serverTimeMs);
    const mannaNoticeVisible = mannaState.phase === "steady" || mannaState.phase === "blink";
    this.ui.mannaNotice.classList.toggle("hidden", !mannaNoticeVisible);
    delete this.ui.mannaNotice.dataset.phase;
    this.ui.mannaNotice.textContent = MANNA_NOTICE_TEXT;

    const warningLeadSeconds = 5;
    const waveWarningVisible = view.status === "active"
      && view.wave.side != null
      && !view.wave.isActive
      && ((view.wave.secondsUntilSpawn ?? Number.POSITIVE_INFINITY) <= warningLeadSeconds);
    if (!waveWarningVisible) {
      this.ui.waveWarning.classList.add("hidden");
      this.ui.waveNotice.classList.add("hidden");
      this.ui.waveWarning.dataset.side = "";
    } else {
      this.ui.waveWarning.classList.remove("hidden");
      this.ui.waveNotice.classList.remove("hidden");
      this.ui.waveWarning.dataset.side = view.wave.side;
      this.ui.waveNotice.textContent = WAVE_NOTICE_TEXT;
    }

    const cloudVisible = view.cloud.isActive;
    this.ui.cloudNotice.classList.toggle("hidden", !cloudVisible);
    this.ui.cloudNotice.textContent = CLOUD_NOTICE_TEXT;
  }

  private setConnectionStatus(title: string, text: string, tone: "info" | "success" | "danger"): void {
    this.ui.connectionBadge.dataset.tone = tone;
    this.ui.connectionBadge.textContent = title;
    this.ui.statusText.innerHTML = `<strong>${title}.</strong> ${text}`;
  }

  private updateRoomBadge(): void {
    const count = this.lastView?.players.length ?? 0;
    this.ui.roomBadge.textContent = `${count} at the shore`;
  }

  private updateDebugState(view: RoundView): void {
    this.ui.gameRoot.dataset.roundState = view.status;
    this.ui.gameRoot.dataset.hazards = (view.wave.isActive || view.cloud.isActive) ? "active" : "paused";
    this.ui.gameRoot.dataset.wave = view.wave.isActive ? "active" : "paused";
    this.ui.gameRoot.dataset.cloud = view.cloud.isActive ? "active" : "paused";
    this.ui.gameRoot.dataset.waveSecondsUntilSpawn = view.wave.secondsUntilSpawn != null
      ? view.wave.secondsUntilSpawn.toFixed(2)
      : "";
    this.ui.gameRoot.dataset.manna = view.manna.isActive ? "active" : "paused";
    this.ui.gameRoot.dataset.mannaPhase = this.scene.getMannaPlaybackState(view.serverTimeMs).phase;
    this.ui.gameRoot.dataset.waveSide = view.wave.side ?? "";
    this.ui.gameRoot.dataset.aliveCount = `${view.alivePlayers.length}`;
    window.__desertDebugState = this.scene.getDebugState() ?? undefined;

    const self = view.players.find((player) => player.id === this.selfId);
    if (this.selfId) {
      this.ui.gameRoot.dataset.selfJoined = "true";
    } else {
      delete this.ui.gameRoot.dataset.selfJoined;
    }

    if (self) {
      this.ui.gameRoot.dataset.selfX = self.x.toFixed(2);
      this.ui.gameRoot.dataset.selfY = self.y.toFixed(2);
      this.ui.gameRoot.dataset.selfTargetX = Number.isFinite(self.targetX) ? self.targetX.toFixed(2) : "0.00";
      this.ui.gameRoot.dataset.selfTargetY = Number.isFinite(self.targetY) ? self.targetY.toFixed(2) : "0.00";
      return;
    }

    delete this.ui.gameRoot.dataset.selfX;
    delete this.ui.gameRoot.dataset.selfY;
    delete this.ui.gameRoot.dataset.selfTargetX;
    delete this.ui.gameRoot.dataset.selfTargetY;
  }

  private setBanner(title: string, text: string, tone: "info" | "success" | "danger", sticky: boolean): void {
    this.ui.banner.dataset.tone = tone;
    this.ui.banner.dataset.sticky = sticky ? "true" : "false";
    this.ui.banner.innerHTML = `<strong>${title}.</strong> ${text}`;
    this.ui.banner.classList.remove("hidden");
    if (!sticky) {
      if (this.bannerTimer != null) {
        window.clearTimeout(this.bannerTimer);
      }
      this.bannerTimer = window.setTimeout(() => {
        if (this.ui.banner.dataset.sticky !== "true") {
          this.clearBanner();
        }
      }, 4200);
    }
  }

  private clearBanner(): void {
    if (this.ui.banner.dataset.sticky === "true") {
      return;
    }

    this.ui.banner.classList.add("hidden");
    this.ui.banner.innerHTML = "";
    if (this.bannerTimer != null) {
      window.clearTimeout(this.bannerTimer);
      this.bannerTimer = null;
    }
  }

  private async triggerRoundAction(): Promise<void> {
    if (!this.connection || this.connection.state !== HubConnectionState.Connected) {
      return;
    }

    const view = this.lastView;
    if (!view) {
      return;
    }

    const control = deriveRoundControlState(view.round, this.selfId);
    if (!control.visible || !control.action || this.pendingRoundAction != null) {
      return;
    }

    this.pendingRoundAction = control.action;
    this.updateRoundPanel(view);

    try {
      switch (control.action) {
        case "start":
          await this.connection.send("StartRound", {});
          break;
        case "restart":
          await this.connection.send("RestartRound", {});
          break;
      }
    } catch {
      this.pendingRoundAction = null;
      this.updateRoundPanel(view);
      this.setBanner("Action failed", "Could not send the round action to the server.", "danger", false);
    }
  }

  private describeRoundState(view: RoundView, control: ReturnType<typeof deriveRoundControlState>): string {
    if (view.status === "not-started") {
      return control.visible
        ? "You can start the crossing. The other wanderers are waiting."
        : "Waiting for the first wanderer to press START.";
    }

    if (view.status === "active") {
      const parts: string[] = [];
      if (view.manna.isActive) {
        parts.push(`${view.manna.remainingPickupCount} manna remain.`);
      } else {
        parts.push("Keep moving and survive.");
      }
      return parts.join(" ");
    }

    return control.visible
      ? "You can restart the crossing."
      : "The crossing is over. Waiting for the first wanderer to restart.";
  }

  private describeRoundActionError(action: RoundControlAction, reason: string): string {
    if (action === "start") {
      switch (reason) {
        case "not_waiting":
          return "The round has already started or finished.";
        case "no_players":
          return "No wanderers are on the shore yet.";
        case "not_authorized":
          return "Only the first wanderer can start the round.";
        default:
          return "The server rejected START.";
      }
    }

    switch (reason) {
      case "not_game_over":
        return "The round is not over yet.";
      case "no_players":
        return "No wanderers are on the shore yet.";
      case "not_authorized":
        return "Only the first wanderer can restart the round.";
      default:
        return "The server rejected RESTART.";
    }
  }

  private describeJoinError(reason: string): string {
    switch (reason) {
      case "room_full":
        return "The shore already holds all 6 wanderers.";
      case "invalid_name":
        return "Names must be 1 to 20 characters after trimming.";
      case "already_joined":
        return "This browser already joined the crossing.";
      case "game_over":
        return "The crossing has already ended.";
      default:
        return "The server rejected the join request.";
    }
  }

  private updateTuningPanelVisibility(view: RoundView | null): void {
    const visible = !!this.selfId && this.isHost(view) && view?.status !== "active";
    this.ui.tuningPanel.classList.toggle("hidden", !visible);
  }

  private buildTuningPanel(): void {
    this.ui.tuningFields.replaceChildren();
    const categories = new Map<string, TunableField[]>();
    for (const field of this.rulesSchema) {
      const group = categories.get(field.category) ?? [];
      group.push(field);
      categories.set(field.category, group);
    }
    for (const [category, fields] of categories) {
      const details = document.createElement("details");
      details.className = "tuning-category";
      const summary = document.createElement("summary");
      summary.textContent = category;
      details.append(summary);
      const group = document.createElement("div");
      group.className = "tuning-group";
      for (const field of fields) {
        const row = document.createElement("div");
        row.className = "tuning-field";
        const label = document.createElement("label");
        label.textContent = field.label;
        label.htmlFor = `tuning-${field.key}`;
        const input = document.createElement("input");
        input.type = "number";
        input.id = `tuning-${field.key}`;
        input.dataset.key = field.key;
        input.min = String(field.min);
        input.max = String(field.max);
        input.step = String(field.step);
        input.value = String(field.value);
        row.append(label, input);
        group.append(row);
      }
      details.append(group);
      this.ui.tuningFields.append(details);
    }
  }

  private async applyRules(): Promise<void> {
    if (!this.connection || this.connection.state !== HubConnectionState.Connected) {
      return;
    }
    const updates: Record<string, number> = {};
    const inputs = this.ui.tuningFields.querySelectorAll<HTMLInputElement>("input[data-key]");
    for (const input of inputs) {
      const key = input.dataset.key!;
      const value = parseFloat(input.value);
      if (!isNaN(value)) {
        updates[key] = value;
      }
    }
    this.pendingRulesUpdate = true;
    try {
      await this.connection.send("UpdateRules", { updates });
    } catch {
      this.pendingRulesUpdate = false;
      this.showTuningNotice("Failed to send settings.", "danger");
    }
  }

  private showTuningNotice(message: string, tone: "success" | "danger"): void {
    this.ui.tuningNotice.textContent = message;
    this.ui.tuningNotice.dataset.tone = tone;
    this.ui.tuningNotice.classList.remove("hidden");
    window.setTimeout(() => {
      this.ui.tuningNotice.classList.add("hidden");
    }, 3000);
  }
}

function renderShell(): UiRefs {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("Missing #app root.");
  }

  document.title = "The Exodus";

  app.innerHTML = `
    <div class="layout" id="layout">
      <aside class="sidebar card" id="sidebar">
        <div class="brand">
          <h1>The Exodus</h1>
          <p>Cross the sea together. Six wanderers, one crossing, manna, and a path through the waters.</p>
        </div>
        <section class="round-panel">
          <div class="section-title">Round</div>
          <div class="round-state" id="round-state">Waiting to start</div>
          <div class="round-detail" id="round-detail">The first wanderer can press START when the crossing is ready.</div>
          <button class="round-action hidden" id="round-action" type="button">START</button>
        </section>
        <form class="join-panel" id="join-panel">
          <label for="name-input">Name</label>
          <div class="join-row">
            <input id="name-input" class="name-input" maxlength="20" autocomplete="off" placeholder="Sandy Ada" />
            <button class="join-button" type="submit">Join</button>
          </div>
        </form>
        <div class="status-card">
          <span class="badge" data-tone="info" id="connection-badge">Connecting</span>
          <div class="status-text" id="status-text">Starting the Exodus link.</div>
        </div>
        <section class="roster">
          <div class="roster-head">
            <div class="section-title">Players</div>
            <span class="badge ghost" id="player-count">0</span>
          </div>
          <ul class="player-list" id="player-list"></ul>
        </section>
        <div class="room-meta">
          <span class="badge ghost" id="room-badge">0 at the shore</span>
        </div>
        <section class="tuning-panel hidden" id="tuning-panel">
          <div class="section-title">Settings</div>
          <div class="tuning-fields" id="tuning-fields"></div>
          <div class="tuning-footer">
            <div class="tuning-notice hidden" id="tuning-notice"></div>
            <button class="tuning-apply" id="tuning-apply" type="button">Apply</button>
          </div>
        </section>
      </aside>
      <main class="stage card">
        <div class="banner hidden" id="banner"></div>
        <div class="special-notices">
          <div class="wave-warning hidden" id="wave-warning">⚠️</div>
          <div class="scene-notice hidden hebrew-notice" id="wave-notice" dir="rtl" lang="he">${WAVE_NOTICE_TEXT}</div>
          <div class="scene-notice hidden hebrew-notice" id="cloud-notice" dir="rtl" lang="he">${CLOUD_NOTICE_TEXT}</div>
          <div class="scene-notice hidden manna hebrew-notice" id="manna-notice" dir="rtl" lang="he">${MANNA_NOTICE_TEXT}</div>
        </div>
        <div class="game-root" id="game-root"></div>
      </main>
    </div>
  `; 

  const ui = {
    app,
    layout: document.querySelector<HTMLDivElement>("#layout")!,
    sidebar: document.querySelector<HTMLDivElement>("#sidebar")!,
    stage: document.querySelector<HTMLDivElement>(".stage")!,
    gameRoot: document.querySelector<HTMLDivElement>("#game-root")!,
    banner: document.querySelector<HTMLDivElement>("#banner")!,
    waveWarning: document.querySelector<HTMLDivElement>("#wave-warning")!,
    waveNotice: document.querySelector<HTMLDivElement>("#wave-notice")!,
    cloudNotice: document.querySelector<HTMLDivElement>("#cloud-notice")!,
    mannaNotice: document.querySelector<HTMLDivElement>("#manna-notice")!,
    roundState: document.querySelector<HTMLDivElement>("#round-state")!,
    roundDetail: document.querySelector<HTMLDivElement>("#round-detail")!,
    roundAction: document.querySelector<HTMLButtonElement>("#round-action")!,
    joinPanel: document.querySelector<HTMLFormElement>("#join-panel")!,
    joinButton: document.querySelector<HTMLButtonElement>(".join-button")!,
    nameInput: document.querySelector<HTMLInputElement>("#name-input")!,
    playerList: document.querySelector<HTMLUListElement>("#player-list")!,
    playerCount: document.querySelector<HTMLSpanElement>("#player-count")!,
    statusText: document.querySelector<HTMLDivElement>("#status-text")!,
    roomBadge: document.querySelector<HTMLSpanElement>("#room-badge")!,
    connectionBadge: document.querySelector<HTMLSpanElement>("#connection-badge")!,
    tuningPanel: document.querySelector<HTMLElement>("#tuning-panel")!,
    tuningFields: document.querySelector<HTMLDivElement>("#tuning-fields")!,
    tuningApply: document.querySelector<HTMLButtonElement>("#tuning-apply")!,
    tuningNotice: document.querySelector<HTMLDivElement>("#tuning-notice")!
  };

  if (!ui.layout || !ui.sidebar || !ui.stage || !ui.gameRoot || !ui.banner || !ui.waveWarning || !ui.waveNotice || !ui.cloudNotice || !ui.mannaNotice || !ui.roundState || !ui.roundDetail || !ui.roundAction || !ui.joinPanel || !ui.joinButton || !ui.nameInput || !ui.playerList || !ui.playerCount || !ui.statusText || !ui.roomBadge || !ui.connectionBadge || !ui.tuningPanel || !ui.tuningFields || !ui.tuningApply || !ui.tuningNotice) {
    throw new Error("UI bootstrap failed.");
  }

  return ui;
}

function resolveEmoteGlyph(code: EmoteCode): string {
  switch (code) {
    case "dove":
      return "🕊️";
    case "trumpet":
      return "🎺";
    case "bread":
      return "🥖";
    case "laugh":
      return "😄";
    case "wave":
      return "👋";
    default:
      return "✨";
  }
}

export function bootstrapApp(): void {
  const ui = renderShell();
  new GameClient(ui);
}
