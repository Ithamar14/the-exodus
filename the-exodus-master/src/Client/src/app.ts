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
  type MonsterSnapshot,
  type MonsterSpawnDto,
  type SceneryObjectDto,
  type SceneryLibraryEntry,
  type WeaponSpawnDto,
  type ProjectileSnapshot,
  type WeaponSpawnSnapshot,
  GROUND_Y,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  VIEWPORT_WIDTH,
  VIEWPORT_HEIGHT,
  updateWorldSize
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
  editorOverlay: HTMLElement;
  editorAddToggle: HTMLButtonElement;
  editorMonsterAddToggle: HTMLButtonElement;
  editorWeaponAddToggle: HTMLButtonElement;
  editorWeaponTypeSelect: HTMLSelectElement;
  editorMapName: HTMLInputElement;
  editorSaveBtn: HTMLButtonElement;
  editorLoadSelect: HTMLSelectElement;
  editorLoadBtn: HTMLButtonElement;
  editorNotice: HTMLDivElement;
  editorZoomFitBtn: HTMLButtonElement;
  editorWorldWidthInput: HTMLInputElement;
  editorWorldHeightInput: HTMLInputElement;
  editorWorldApplyBtn: HTMLButtonElement;
  preJoinEditorBtn: HTMLButtonElement;
  editorObjAddToggle: HTMLButtonElement;
  editorObjSelect: HTMLSelectElement;
  editorObjNewBtn: HTMLButtonElement;
  editorObjFileInput: HTMLInputElement;
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

type PlatformDto = { cx: number; surfaceY: number; width: number };

// Proportional fractions of the original 1024×768 layout — scaled at runtime to WORLD_WIDTH/HEIGHT.
function makeDefaultPlatforms(): PlatformDto[] {
  return [
    { cx: Math.round(WORLD_WIDTH * 0.146), surfaceY: Math.round(WORLD_HEIGHT * 0.778), width: Math.round(WORLD_WIDTH * 0.195) },
    { cx: Math.round(WORLD_WIDTH * 0.500), surfaceY: Math.round(WORLD_HEIGHT * 0.765), width: Math.round(WORLD_WIDTH * 0.176) },
    { cx: Math.round(WORLD_WIDTH * 0.830), surfaceY: Math.round(WORLD_HEIGHT * 0.778), width: Math.round(WORLD_WIDTH * 0.195) },
    { cx: Math.round(WORLD_WIDTH * 0.273), surfaceY: Math.round(WORLD_HEIGHT * 0.583), width: Math.round(WORLD_WIDTH * 0.137) },
    { cx: Math.round(WORLD_WIDTH * 0.713), surfaceY: Math.round(WORLD_HEIGHT * 0.596), width: Math.round(WORLD_WIDTH * 0.137) },
    { cx: Math.round(WORLD_WIDTH * 0.500), surfaceY: Math.round(WORLD_HEIGHT * 0.439), width: Math.round(WORLD_WIDTH * 0.117) },
  ];
}

// Unified visual for all projectile types. Trail fields only used by fireball.
type ProjectileVisual = {
  type: string;
  x: number;
  y: number;
  vX: number;  // used for fireball direction + arrow rotation
  vY: number;
  trail: Array<{ x: number; y: number }>;
  trailTimer: number;
  sprite: Phaser.GameObjects.Image;
};
let FIREBALL_SPEED = 680;          // px/s — kept in sync with server FireballSpeed rule
let PLAYER_SIZE = 1.0;             // scale factor — kept in sync with server PlayerSize rule
let PLAYER_COLLISION_RADIUS = 30;  // px — kept in sync with server PlayerCollisionRadius rule
let FIREBALL_HIT_RADIUS = 20;      // px — kept in sync with server FireballHitRadius rule
let MANNA_COLLECT_RADIUS = 28;     // px — kept in sync with server MannaCollectRadius rule
const MONSTER_HALF_HEIGHT = 45;    // matches server MonsterHalfHeight constant
const MONSTER_HALF_WIDTH = 30;     // matches server MonsterHalfWidth constant
const MONSTER_CONTACT_RADIUS = 38; // matches server MonsterContactRadius constant
const FIREBALL_TRAIL_EVERY = 3;    // frames between trail samples
const FIREBALL_TRAIL_MAX = 10;     // how many trail points to keep

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
  private readonly liveDots: Phaser.GameObjects.Image[];
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
  private torsoBaseY = 0;
  private headBaseY = 0;
  private nameLabelBaseY = 0;
  private emoteBaseY = 0;
  private emoteActiveBaseY = 0;
  private mannaHaloBaseY = 0;

  public constructor(scene: Phaser.Scene, view: PlayerView) {
    this.scene = scene;
    this.id = view.id;
    this.bobSeed = (hashString(`${view.id}:bob`) % 1000) / 1000;
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

    this.liveDots = [-7, 0, 7].map((dx) =>
      scene.add.image(dx, -52, 'life_dot')
    );

    this.torso   = scene.add.image(0,  -2, 'char_torso').setOrigin(0.5, 0.5 );
    this.head    = scene.add.image(0, -23, 'char_head' ).setOrigin(0.5, 0.5 );
    this.armBack = scene.add.image(-8, -9, 'char_arm'  ).setOrigin(0.5, 0.08);
    this.armFront= scene.add.image( 8, -9, 'char_arm'  ).setOrigin(0.5, 0.08);

    // Gun — wrist pivot at origin row 5 of sprite (5/spriteHeight fraction). Barrel points right (+x).
    this.gun = scene.add.image(0, 0, 'char_gun').setOrigin(0, 5 / 14);

    this.legBack = scene.add.image(-5, 12, 'char_leg').setOrigin(0.5, 0.08);
    this.legFront= scene.add.image( 5, 12, 'char_leg').setOrigin(0.5, 0.08);

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

    // Derive all body-part positions from sprite natural dimensions.
    // Step 1: compute layout with origin at body centre (proportional to sprite sizes).
    // Step 2: shift everything so the visual foot contact point lands at y=0 in the
    //         container — that way root.y == player.y (feet Y) and no per-sprite offset
    //         is ever needed for ground/platform contact.
    const torsoH = this.torso.height;
    const torsoW = this.torso.width;
    const headH  = this.head.height;
    const legH   = this.legFront.height;
    const dotW   = this.liveDots[0].width;

    const torsoBaseY0  = -(torsoH * 0.071);            // torso centre, relative to old origin
    const shoulderY0   = torsoBaseY0 - torsoH * 0.25;
    const hipY0        = torsoBaseY0 + torsoH * 0.5;
    const headBaseY0   = torsoBaseY0 - torsoH * 0.5 - headH * 0.318;

    // Actual feet position (leg pivot is at hip, origin (0.5,0.08), so bottom = hipY0 + legH*0.92)
    const feetY0       = hipY0 + legH * 0.92;
    const shift        = -feetY0;                       // amount to lift everything so feet → y=0

    this.torsoBaseY      = torsoBaseY0 + shift;
    const shoulderY      = shoulderY0  + shift;
    const hipY           = hipY0       + shift;
    this.headBaseY       = headBaseY0  + shift;
    this.mannaHaloBaseY  = shoulderY0  + shift;
    this.nameLabelBaseY  = hipY        + legH * 1.738;
    this.emoteBaseY      = this.headBaseY - headH * 1.682;
    this.emoteActiveBaseY = this.emoteBaseY - headH * 0.18;

    this.torso.y  = this.torsoBaseY;
    this.head.y   = this.headBaseY;
    this.armBack.setPosition(-(torsoW * 0.667), shoulderY);
    this.armFront.setPosition( (torsoW * 0.667), shoulderY);
    this.legBack.setPosition(-(torsoW * 0.417), hipY);
    this.legFront.setPosition( (torsoW * 0.417), hipY);
    this.mannaHalo.y  = this.mannaHaloBaseY;
    this.nameLabel.y  = this.nameLabelBaseY;
    this.emoteLabel.y = this.emoteBaseY;

    const dotSpacing = dotW * 0.7;
    const dotBaseY   = this.headBaseY - headH * 1.318;
    this.liveDots.forEach((dot, i) => dot.setPosition((i - 1) * dotSpacing, dotBaseY));

    this.sync(view);
  }

  public sync(view: PlayerView): void {
    this.facingDir = view.facingDir;
    this.targetX = view.x;
    this.targetY = view.y;
    this.nameLabel.setText(view.name);
    this.nameLabel.setColor(view.isWinner
      ? "#8b3f04"
      : (view.isAlive ? '#' + view.color.toString(16).padStart(6, '0') : "#6d5845"));
    this.shadow.setAlpha(view.isAlive ? 0.22 : 0.12);
    this.figure.setAlpha(view.isAlive ? 1 : 0.34);
    this.mannaHalo.setAlpha(view.isAlive && view.hasCollectedMannaThisCycle ? 0.38 : 0);
    this.isAlive = view.isAlive;
    this.isWinner = view.isWinner;
    this.isMoving = view.isMoving;
    this.hasCollectedMannaThisCycle = view.hasCollectedMannaThisCycle;
    this.isInvincible = view.isInvincible;

    const weaponKey = view.weapon === "bow" ? "weapon_bow"
      : view.weapon === "sword" ? "weapon_sword"
      : "weapon_staff";
    if (this.gun.texture.key !== weaponKey) this.gun.setTexture(weaponKey);

    const lives = view.lives;
    for (let i = 0; i < this.liveDots.length; i++) {
      this.liveDots[i].setTint(i < lives ? 0xff2222 : 0x444444);
      this.liveDots[i].setAlpha(i < lives ? 1 : 0.35);
      this.liveDots[i].setVisible(view.isAlive);
    }
  }

  public update(deltaMs: number, nowMs: number, wind: { x: number; y: number }): void {
    const ps = PLAYER_SIZE;
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
      this.root.scaleX = 1.68 * ps;
      this.root.scaleY = 1.68 * ps;
      this.figure.scaleX = facing;
      this.figure.scaleY = 1;
      this.figure.x = 0;
      this.figure.y = 0;
      this.figure.rotation = 0;
      this.root.rotation = 0;
      this.torso.y = this.torsoBaseY;
      this.head.y = this.headBaseY;
      this.head.scaleX = 1; // figure.scaleX = facing, so combined = facing
    } else {
      this.root.scaleX = ps;
      this.root.scaleY = ps;
      this.figure.scaleX = facing * bodySquish;
      this.figure.scaleY = moving ? 1 + (bob * 0.02) : 1 + (bodyBob * 0.03);
      this.figure.x = (moving ? step * 0.7 : 0) + (wind.x * 0.24);
      this.figure.y = (moving ? -bob * 0.9 : -bodyBob * 0.85) + (wind.y * 0.24);
      this.figure.rotation = bodyLean;
      this.root.rotation = 0;
      this.torso.y = moving ? this.torsoBaseY + (bob * 0.6) : this.torsoBaseY + (bodyBob * 0.85);
      this.head.y = moving ? this.headBaseY + (bob * 0.15) : this.headBaseY + (bodyBob * 0.78);
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

    // Track gun to armFront's wrist: pivot is at 0.08 from top, wrist is 0.92× arm height away
    const armR = this.armFront.rotation;
    const wristDist = this.armFront.height * 0.92;
    this.gun.x = this.armFront.x - wristDist * Math.sin(armR);
    this.gun.y = this.armFront.y + wristDist * Math.cos(armR);
    this.gun.rotation = armR;
    this.gun.setVisible(this.isAlive && !this.victoryMode);

    // Project shadow onto the fixed ground surface (Y=707) regardless of player size.
    // Feet are at root.y + 27*ps in world space; shadow local Y must compensate for root scale.
    const feetWorldY = this.root.y; // root.y IS the feet Y in world space
    const heightAboveGround = Math.max(0, GROUND_Y - feetWorldY);
    const shadowLocalY = heightAboveGround / ps;
    const shadowScale = Math.max(0.35, 1 - heightAboveGround / 350);
    this.shadow.x = wind.x * 0.3;
    this.shadow.y = shadowLocalY + (wind.y * 0.36);
    this.shadow.scaleX = this.isAlive ? (moving ? shadowScale * (1 + bob * 0.08) : shadowScale * 0.92) : shadowScale * 0.84;
    this.shadow.scaleY = this.isAlive ? (moving ? shadowScale * (1 + bob * 0.03) : shadowScale * 0.86) : shadowScale * 0.84;

    if (this.isInvincible && this.isAlive) {
      this.figure.setAlpha(Math.sin(nowMs / 70) > 0 ? 1 : 0.15);
    } else if (this.isAlive) {
      this.figure.setAlpha(1);
    }

    this.mannaHalo.y = this.mannaHaloBaseY + (this.hasCollectedMannaThisCycle ? Math.sin(nowMs / 120) * 0.5 : 0);
    this.mannaHalo.scaleX = this.hasCollectedMannaThisCycle ? 1 + (Math.sin(nowMs / 180) * 0.03) : 1;
    this.mannaHalo.scaleY = this.hasCollectedMannaThisCycle ? 1 + (Math.cos(nowMs / 180) * 0.03) : 1;
    this.nameLabel.y = this.nameLabelBaseY + (moving ? bob * 0.7 : 0);
    const emoteVisible = this.emoteText.length > 0 && nowMs < this.emoteExpiresAtMs;
    if (emoteVisible) {
      const emotePhase = nowMs - (this.emoteExpiresAtMs - 5000);
      this.emoteLabel.setAlpha(1);
      this.emoteLabel.setText(this.emoteText);
      this.emoteLabel.setScale(1 + (Math.sin(emotePhase / 180) * 0.04));
      this.emoteLabel.y = this.emoteActiveBaseY + (Math.sin(emotePhase / 220) * 2.4);
    } else {
      this.emoteLabel.setAlpha(0);
      this.emoteLabel.setText("");
      this.emoteLabel.setScale(1);
      this.emoteLabel.y = this.emoteBaseY;
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

  public getPosition(): { x: number; y: number } {
    return { x: this.root.x, y: this.root.y };
  }

  public getContainer(): Phaser.GameObjects.Container {
    return this.root;
  }

  public destroy(): void {
    this.root.destroy(true);
  }

}

class MonsterAvatar {
  public readonly id: string;
  private readonly root: Phaser.GameObjects.Container;
  private readonly head: Phaser.GameObjects.Image;
  private readonly legs: Phaser.GameObjects.Image[];
  private readonly hpDots: Phaser.GameObjects.Image[];
  private targetX: number;
  private targetY: number;
  private isPaused = false;
  private hp = 2;
  private walkPhase = 0;

  public constructor(scene: Phaser.Scene, snapshot: MonsterSnapshot) {
    this.id = snapshot.id;
    this.targetX = snapshot.x;
    this.targetY = snapshot.y;

    this.root = scene.add.container(snapshot.x, snapshot.y).setDepth(490);

    // Place at origin temporarily; final positions derived from natural sprite dimensions below.
    this.legs = [-44, -14, 14, 44].map(lx =>
      scene.add.image(lx, 0, 'monster_leg').setOrigin(0.5, 0)
    );
    this.head = scene.add.image(0, 0, 'monster_head').setOrigin(0.5, 0.5);
    this.hpDots = [-14, 14].map(dx =>
      scene.add.image(dx, 0, 'life_dot')
    );

    this.root.add([...this.legs, this.head, ...this.hpDots]);

    // Derive layout from sprite natural dimensions so feet land at y=0 in this container
    // (root.y == snapshot.y == feet Y in world space).
    const headH = this.head.height;
    const legH  = this.legs[0].height;
    const dotH  = this.hpDots[0].height;

    // Pre-shift: head center at 0, leg pivots attach a quarter of the way down the head body.
    const legTopY0 = headH * 0.25;
    const feetY0   = legTopY0 + legH;
    const shift    = -feetY0;

    this.head.y = shift;
    for (const leg of this.legs) leg.y = legTopY0 + shift;
    for (const dot of this.hpDots) dot.y = shift - headH * 0.5 - dotH;

    this.sync(snapshot);
  }

  public sync(snapshot: MonsterSnapshot): void {
    this.targetX = snapshot.x;
    this.targetY = snapshot.y;
    this.isPaused = snapshot.isPaused;
    this.hp = snapshot.hp;

    this.head.setFlipX(snapshot.facingDir < 0);
    for (const leg of this.legs) leg.setFlipX(snapshot.facingDir < 0);

    for (let i = 0; i < this.hpDots.length; i++) {
      this.hpDots[i].setTint(i < this.hp ? 0xff2222 : 0x444444);
      this.hpDots[i].setAlpha(i < this.hp ? 1 : 0.35);
    }
    this.root.setAlpha(this.hp <= 0 ? 0 : 1);
  }

  public update(deltaMs: number, _nowMs: number): void {
    const lerp = Math.min(1, deltaMs / 100);
    this.root.x = Phaser.Math.Linear(this.root.x, this.targetX, lerp);
    this.root.y = Phaser.Math.Linear(this.root.y, this.targetY, lerp);
    this.root.setDepth(490 + this.root.y * 0.001);

    if (!this.isPaused && this.hp > 0) {
      this.walkPhase += deltaMs * 0.008;
      const step = Math.sin(this.walkPhase);
      // Alternate pairs: legs 0,2 in phase; legs 1,3 counter-phase
      this.legs[0].rotation =  step * 0.55;
      this.legs[1].rotation = -step * 0.55;
      this.legs[2].rotation =  step * 0.55;
      this.legs[3].rotation = -step * 0.55;
    } else {
      for (const leg of this.legs) leg.rotation = 0;
    }
  }

  public getPosition(): { x: number; y: number } {
    return { x: this.root.x, y: this.root.y };
  }

  public destroy(): void {
    this.root.destroy(true);
  }
}

class CloudDarknessOverlay {
  private readonly scene: Phaser.Scene;
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
    this.scene = scene;
    // Darkness covers the whole viewport in screen space (scrollFactor 0).
    this.darkness = scene.add.rectangle(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, 0x020406, 0);
    this.darkness.setOrigin(0, 0);
    this.darkness.setDepth(880);
    this.darkness.setScrollFactor(0);
    // maskShape is rendered to the stencil without camera transforms,
    // so coordinates are in screen (viewport) space — convert in draw().
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

  public draw(nowMs: number, cam: Phaser.Cameras.Scene2D.Camera): void {
    const targetAlpha = this.cloud.isActive ? 0.62 : 0;
    this.alpha = Phaser.Math.Linear(this.alpha, targetAlpha, this.cloud.isActive ? 0.08 : 0.05);

    this.darkness.setFillStyle(0x020406, this.alpha);
    this.maskShape.clear();
    this.smoke.clear();

    if (this.alpha <= 0.01) {
      return;
    }

    // maskShape renders in screen space (no camera transform), so convert world → screen.
    const sx = (this.centerX - cam.scrollX) * cam.zoom;
    const sy = (this.centerY - cam.scrollY) * cam.zoom;
    const sr = this.radius * cam.zoom;
    this.maskShape.fillStyle(0xffffff, 1);
    this.maskShape.fillCircle(sx, sy, sr);

    // smoke is a world-space Graphics object — use world coordinates.
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
  private fireballGfx!: Phaser.GameObjects.Graphics;
  private debugHitboxGfx!: Phaser.GameObjects.Graphics;
  public debugHitboxes = false;
  private platformImages: Phaser.GameObjects.Image[] = [];
  private currentPlatforms: PlatformDto[] = [];
  private currentMonsters: MonsterSnapshot[] = [];
  private readonly monsterAvatars = new Map<string, MonsterAvatar>();
  private readonly projectiles = new Map<string, ProjectileVisual>();
  private readonly weaponSpawnImages = new Map<string, Phaser.GameObjects.Image>();
  private editorGfx: Phaser.GameObjects.Graphics | null = null;
  private editorInteraction: 'add' | 'add-monster' | 'add-object' | 'add-weapon' | 'move' | null = null;
  private editorPlatformsRef: PlatformDto[] | null = null;
  private editorOnChange: ((platforms: PlatformDto[]) => void) | null = null;
  private editorOnApply: (() => void) | null = null;
  private selectedIndex: number | null = null;
  private editorMonsterSpawnsRef: MonsterSpawnDto[] | null = null;
  private editorMonsterOnChange: ((spawns: MonsterSpawnDto[]) => void) | null = null;
  private editorMonsterOnApply: (() => void) | null = null;
  private selectedMonsterIndex: number | null = null;
  private editorSceneryRef: SceneryObjectDto[] | null = null;
  private editorSceneryOnChange: ((objects: SceneryObjectDto[]) => void) | null = null;
  private editorSceneryOnApply: (() => void) | null = null;
  private editorSelectedScenery: { key: string; solid: boolean } | null = null;
  private selectedSceneryIndex: number | null = null;
  private readonly sceneryImages: Map<string, Phaser.GameObjects.Image> = new Map();
  private spawnIdCounter = 0;
  private sceneryIdCounter = 0;
  private localPlayerId: string | null = null;
  private editorActive = false;
  private editorKeyW: Phaser.Input.Keyboard.Key | null = null;
  private editorKeyA: Phaser.Input.Keyboard.Key | null = null;
  private editorKeyS: Phaser.Input.Keyboard.Key | null = null;
  private editorKeyD: Phaser.Input.Keyboard.Key | null = null;
  private dragState: (
    { type: 'move' | 'resize-left' | 'resize-right'; index: number; startX: number; startY: number; origCx: number; origSy: number; origWidth: number; } |
    { type: 'move-obj'; idx: number; startX: number; startY: number; origX: number; origY: number; } |
    { type: 'resize-obj-corner'; idx: number; fixedX: number; fixedY: number; signX: 1 | -1; signY: 1 | -1; origW: number; origH: number; }
  ) | null = null;

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
    // Distant dune silhouettes spread across the full world width
    const duneXFracs = [0.07, 0.17, 0.28, 0.40, 0.52, 0.63, 0.75, 0.87, 0.95];
    for (let i = 0; i < duneXFracs.length; i++) {
      const w = 260 + (i % 4) * 120;
      const h = 100 + (i % 3) * 30;
      graphics.fillStyle(0xd4a05a, 0.25 + (i % 3) * 0.05);
      graphics.fillEllipse(WORLD_WIDTH * duneXFracs[i], WORLD_HEIGHT - 78, w, h);
    }
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
    this.load.image('fireball',      'sprites/fireball.png');
    this.load.image('life_dot',      'sprites/life_dot.png');
    this.load.image('platform',      'sprites/platform.png');
    this.load.image('monster_head',  'sprites/monster_head.png');
    this.load.image('monster_leg',   'sprites/monster_leg.png');
    this.load.image('weapon_staff',  'sprites/weapon_staff.png');
    this.load.image('weapon_bow',    'sprites/weapon_bow.png');
    this.load.image('weapon_sword',  'sprites/weapon_sword.png');
    this.load.image('arrow',         'sprites/arrow.png');
    this.load.image('sword_swing',   'sprites/sword_swing.png');
  }

  public create(): void {
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.add.image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, "desert-bg");
    this.addGround();
    this.syncPlatforms(makeDefaultPlatforms());
    this.addDunes();
    // Victory elements are screen-fixed (scrollFactor 0) so they stay centred as the camera pans.
    this.victoryBackdrop = this.add.rectangle(VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, 0x000000, 0)
      .setDepth(930).setScrollFactor(0);
    this.victoryBackdrop.setVisible(false);
    this.victoryTitle = this.add.text(VIEWPORT_WIDTH / 2, 194, "", {
      fontFamily: '"Trebuchet MS", "Gill Sans", sans-serif',
      fontSize: "54px",
      fontStyle: "900",
      color: "#fff5cf",
      stroke: "#000000",
      strokeThickness: 8,
      align: "center"
    }).setOrigin(0.5, 0.5).setDepth(970).setScrollFactor(0);
    this.victoryTitle.setVisible(false);
    this.victorySubtitle = this.add.text(VIEWPORT_WIDTH / 2, 252, "", {
      fontFamily: '"Trebuchet MS", "Gill Sans", sans-serif',
      fontSize: "20px",
      color: "#fff0b4",
      stroke: "#000000",
      strokeThickness: 6,
      align: "center"
    }).setOrigin(0.5, 0.5).setDepth(970).setScrollFactor(0);
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
    this.debugHitboxGfx = this.add.graphics().setDepth(999);
    if (this.input.keyboard) {
      this.editorKeyW = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
      this.editorKeyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
      this.editorKeyS = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
      this.editorKeyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    }

    this.add.text(8, 8, `v${APP_VERSION}`, {
      fontFamily: '"Trebuchet MS", "Gill Sans", sans-serif',
      fontSize: "13px",
      color: "#c8996a"
    }).setDepth(995).setOrigin(0, 0).setAlpha(0.65).setScrollFactor(0);

    if (this.currentView) {
      this.syncRound(this.currentView, null);
    }
  }

  public syncRound(
    view: RoundView,
    selfId: string | null,
    projectiles: ProjectileSnapshot[] = [],
    monsters: MonsterSnapshot[] = [],
    weaponSpawns: WeaponSpawnSnapshot[] = []
  ): void {
    this.currentView = view;
    if (!this.cloudOverlay || !this.waveOverlay || !this.decorations) {
      return;
    }

    this.cloudOverlay.sync(view.cloud);
    this.waveOverlay.sync(view.wave, view.wave.isActive);
    this.syncPlayers(view.players, selfId);
    this.syncMonsters(monsters);
    this.syncVictory(view);
    this.mannaDirector?.sync(view);
    this.playEvents(view.events, view);
    this.syncProjectiles(projectiles);
    this.syncWeaponSpawns(weaponSpawns);
  }

  public syncMonsters(monsters: MonsterSnapshot[]): void {
    this.currentMonsters = monsters;
    const seen = new Set<string>();
    for (const m of monsters) {
      seen.add(m.id);
      const existing = this.monsterAvatars.get(m.id);
      if (existing) {
        existing.sync(m);
      } else {
        this.monsterAvatars.set(m.id, new MonsterAvatar(this, m));
      }
    }
    for (const [id, avatar] of this.monsterAvatars.entries()) {
      if (!seen.has(id)) {
        avatar.destroy();
        this.monsterAvatars.delete(id);
      }
    }
  }

  public syncProjectiles(serverProjectiles: ProjectileSnapshot[]): void {
    const seen = new Set<string>();
    for (const p of serverProjectiles) {
      seen.add(p.id);
      const existing = this.projectiles.get(p.id);
      if (existing) {
        existing.x = p.x;
        existing.y = p.y;
        existing.vX = p.vX;
        existing.vY = p.vY;
        if (p.type === 'arrow') {
          existing.sprite.setPosition(p.x, p.y).setRotation(Math.atan2(p.vY, p.vX));
        } else if (p.type !== 'fireball') {
          // non-prediction types: always sync position directly from server
          existing.sprite.setPosition(p.x, p.y);
        }
        // fireball: x is client-predicted in updateProjectiles; y stays constant (vY=0)
      } else {
        const sprite = this.createProjectileSprite(p);
        this.projectiles.set(p.id, { type: p.type, x: p.x, y: p.y, vX: p.vX, vY: p.vY, trail: [], trailTimer: 0, sprite });
        if (p.type === 'fireball') this.avatars.get(p.ownerId)?.triggerRecoil();
      }
    }
    for (const [id, vis] of this.projectiles) {
      if (!seen.has(id)) { vis.sprite.destroy(); this.projectiles.delete(id); }
    }
  }

  private createProjectileSprite(p: ProjectileSnapshot): Phaser.GameObjects.Image {
    switch (p.type) {
      case 'arrow':
        return this.add.image(p.x, p.y, 'arrow')
          .setDepth(700)
          .setRotation(Math.atan2(p.vY, p.vX));
      case 'sword_swing':
        return this.add.image(p.x, p.y, 'sword_swing')
          .setDisplaySize(p.w || 90, p.h || 60)
          .setDepth(702)
          .setAlpha(0.85);
      default: // fireball
        return this.add.image(p.x, p.y, 'fireball')
          .setDisplaySize(36, 36)
          .setDepth(701)
          .setFlipX(p.vX < 0);
    }
  }

  public syncWeaponSpawns(spawns: WeaponSpawnSnapshot[]): void {
    const seen = new Set<string>();
    for (const s of spawns) {
      seen.add(s.id);
      const textureKey = s.type === "bow" ? "weapon_bow"
        : s.type === "sword" ? "weapon_sword"
        : "weapon_staff";
      if (s.available) {
        if (!this.weaponSpawnImages.has(s.id)) {
          const img = this.add.image(s.x, s.y, textureKey)
            .setDisplaySize(32, 32)
            .setDepth(6)
            .setAlpha(0.9);
          this.weaponSpawnImages.set(s.id, img);
        }
      } else {
        const existing = this.weaponSpawnImages.get(s.id);
        if (existing) { existing.destroy(); this.weaponSpawnImages.delete(s.id); }
      }
    }
    for (const [id, img] of this.weaponSpawnImages) {
      if (!seen.has(id)) { img.destroy(); this.weaponSpawnImages.delete(id); }
    }
  }

  private updateProjectiles(delta: number): void {
    const dt = delta / 1000;
    this.fireballGfx.clear();

    for (const vis of this.projectiles.values()) {
      if (vis.type !== 'fireball') continue;  // only fireballs need client-side prediction + trail

      vis.x += Math.sign(vis.vX) * FIREBALL_SPEED * dt;
      vis.trailTimer++;
      if (vis.trailTimer >= FIREBALL_TRAIL_EVERY) {
        vis.trailTimer = 0;
        vis.trail.unshift({ x: vis.x, y: vis.y });
        if (vis.trail.length > FIREBALL_TRAIL_MAX) vis.trail.pop();
      }
      vis.sprite.x = vis.x;
      vis.sprite.y = vis.y;

      for (let t = 0; t < vis.trail.length; t++) {
        const frac = 1 - t / vis.trail.length;
        this.fireballGfx.fillStyle(0xff6600, frac * 0.42);
        this.fireballGfx.fillCircle(vis.trail[t].x, vis.trail[t].y, 8 * frac);
      }
    }
  }

  private drawDebugHitboxes(): void {
    this.debugHitboxGfx.clear();
    if (!this.debugHitboxes || !this.currentView) return;

    const g = this.debugHitboxGfx;
    g.lineStyle(1, 0xff0000, 0.85);

    // Players: pos.y = feet; circle at body centre; rect from head to feet
    const playerHalfH = 27 * PLAYER_SIZE;
    const playerRadius = PLAYER_COLLISION_RADIUS * PLAYER_SIZE;
    for (const p of this.currentView.players) {
      if (!p.isAlive) continue;
      const pos = this.avatars.get(p.id)?.getPosition() ?? { x: p.x, y: p.y };
      g.strokeCircle(pos.x, pos.y - playerHalfH, playerRadius);
      g.strokeRect(pos.x - playerRadius, pos.y - playerHalfH * 2,
        playerRadius * 2, playerHalfH * 2);
    }

    // Platforms — surface line
    for (const p of this.currentPlatforms) {
      g.strokeRect(p.cx - p.width / 2, p.surfaceY, p.width, 4);
    }

    // Monsters — physics rect + contact circle (use avatar's lerped visual position)
    // pos.y is feet; body centre is pos.y - MONSTER_HALF_HEIGHT (matches server semantics).
    for (const [, avatar] of this.monsterAvatars) {
      const pos = avatar.getPosition();
      const monsterCenterY = pos.y - MONSTER_HALF_HEIGHT;
      g.strokeRect(pos.x - MONSTER_HALF_WIDTH, monsterCenterY - MONSTER_HALF_HEIGHT,
        MONSTER_HALF_WIDTH * 2, MONSTER_HALF_HEIGHT * 2);
      g.strokeCircle(pos.x, monsterCenterY, MONSTER_CONTACT_RADIUS);
    }

    // Fireballs — hit circle
    for (const fb of this.fireballs.values()) {
      g.strokeCircle(fb.x, fb.y, FIREBALL_HIT_RADIUS);
    }

    // Manna pickups — collect circle
    if (this.currentView.manna?.isActive) {
      for (const pickup of this.currentView.manna.pickups) {
        if (!pickup.isCollected) {
          g.strokeCircle(pickup.x, pickup.y, MANNA_COLLECT_RADIUS);
        }
      }
    }
  }

  public update(_time: number, delta: number): void {
    if (!this.currentView) {
      return;
    }

    if (this.editorActive) {
      const cam = this.cameras.main;
      const speed = (600 / cam.zoom) * (delta / 1000);
      if (this.editorKeyW?.isDown) cam.scrollY -= speed;
      if (this.editorKeyS?.isDown) cam.scrollY += speed;
      if (this.editorKeyA?.isDown) cam.scrollX -= speed;
      if (this.editorKeyD?.isDown) cam.scrollX += speed;
    }

    const now = this.time.now;
    const wind = { x: 0, y: 0 };

    for (const avatar of this.avatars.values()) {
      avatar.update(delta, now, wind);
    }

    for (const monster of this.monsterAvatars.values()) {
      monster.update(delta, now);
    }

    this.cloudOverlay?.draw(now, this.cameras.main);
    this.waveOverlay?.draw(now);
    this.mannaDirector?.update(now);
    this.updateProjectiles(delta);
    this.drawDebugHitboxes();

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

  public setLocalPlayerId(id: string | null): void {
    this.localPlayerId = id;
    if (id) {
      const avatar = this.avatars.get(id);
      if (avatar) this.startFollowingAvatar(avatar);
    } else {
      this.cameras.main.stopFollow();
    }
  }

  public updateCameraBounds(): void {
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  }

  public setCameraZoomToFit(): void {
    const zoom = Math.min(VIEWPORT_WIDTH / WORLD_WIDTH, VIEWPORT_HEIGHT / WORLD_HEIGHT);
    this.cameras.main.setZoom(zoom);
    this.cameras.main.stopFollow();
    this.cameras.main.centerOn(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
  }

  public resetCameraZoom(): void {
    this.cameras.main.setZoom(1);
    if (this.localPlayerId) {
      const avatar = this.avatars.get(this.localPlayerId);
      if (avatar) this.startFollowingAvatar(avatar);
    }
  }

  private startFollowingAvatar(avatar: PlayerAvatar): void {
    this.cameras.main.startFollow(avatar.getContainer(), true, 0.1, 0.1);
    this.cameras.main.setDeadzone(VIEWPORT_WIDTH * 0.3, VIEWPORT_HEIGHT * 0.3);
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
      if (player.id === this.localPlayerId) this.startFollowingAvatar(avatar);
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
    const groundSurfaceY = GROUND_Y;
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

  public syncPlatforms(platforms: PlatformDto[]): void {
    this.currentPlatforms = platforms;
    if (this.platformImages.length !== platforms.length) {
      for (const img of this.platformImages) img.destroy();
      this.platformImages = platforms.map(p =>
        this.add.image(p.cx, p.surfaceY, 'platform').setOrigin(0.5, 0).setDisplaySize(p.width, 26).setDepth(5)
      );
    } else {
      for (let i = 0; i < platforms.length; i++) {
        const p = platforms[i];
        this.platformImages[i].setPosition(p.cx, p.surfaceY).setDisplaySize(p.width, 26);
      }
    }
    this.updateEditorOverlay(platforms);
  }

  public syncScenery(objects: SceneryObjectDto[]): void {
    if (this.editorSceneryRef !== objects) {
      this.editorSceneryRef = objects;
      this.selectedSceneryIndex = null;
    }
    const seen = new Set<string>();
    for (const obj of objects) {
      seen.add(obj.id);
      const textureKey = `scenery_${obj.spriteKey}`;
      const place = (img: Phaser.GameObjects.Image) => {
        img.setPosition(obj.x + obj.width / 2, obj.y + obj.height / 2)
           .setDisplaySize(obj.width, obj.height)
           .setDepth(4);
      };
      if (this.sceneryImages.has(obj.id)) {
        place(this.sceneryImages.get(obj.id)!);
      } else if (this.textures.exists(textureKey)) {
        const img = this.add.image(0, 0, textureKey);
        place(img);
        this.sceneryImages.set(obj.id, img);
      } else {
        this.load.image(textureKey, `/sprites/objects/${obj.spriteKey}`);
        this.load.once(Phaser.Loader.Events.COMPLETE, () => {
          if (!this.sceneryImages.has(obj.id)) {
            const img = this.add.image(0, 0, textureKey);
            place(img);
            this.sceneryImages.set(obj.id, img);
          }
        });
        this.load.start();
      }
    }
    for (const [id, img] of this.sceneryImages) {
      if (!seen.has(id)) { img.destroy(); this.sceneryImages.delete(id); }
    }
    this.updateEditorOverlay(this.editorPlatformsRef ?? []);
  }

  private editorWeaponSpawnsRef: WeaponSpawnDto[] | null = null;
  private editorWeaponOnChange: ((spawns: WeaponSpawnDto[]) => void) | null = null;
  private editorSelectedWeaponType: string = "staff";
  private spawnWeaponIdCounter = 0;

  public setEditorInteraction(
    mode: 'add' | 'add-monster' | 'add-object' | 'add-weapon' | 'move' | null,
    platforms: PlatformDto[] | null,
    monsterSpawns: MonsterSpawnDto[] | null,
    sceneryObjects: SceneryObjectDto[] | null,
    selectedScenery: { key: string; solid: boolean } | null,
    onChange: ((platforms: PlatformDto[]) => void) | null,
    onMonsterChange: ((spawns: MonsterSpawnDto[]) => void) | null,
    onSceneryChange: ((objects: SceneryObjectDto[]) => void) | null,
    onApply?: (() => void) | null,
    weaponSpawns?: WeaponSpawnDto[] | null,
    selectedWeaponType?: string,
    onWeaponChange?: ((spawns: WeaponSpawnDto[]) => void) | null
  ): void {
    this.editorInteraction = mode;
    this.editorPlatformsRef = platforms;
    this.editorMonsterSpawnsRef = monsterSpawns;
    this.editorSceneryRef = sceneryObjects;
    this.editorSelectedScenery = selectedScenery;
    this.editorWeaponSpawnsRef = weaponSpawns ?? null;
    this.editorSelectedWeaponType = selectedWeaponType ?? "staff";
    this.editorWeaponOnChange = onWeaponChange ?? null;
    this.editorOnChange = onChange;
    this.editorMonsterOnChange = onMonsterChange;
    this.editorSceneryOnChange = onSceneryChange;
    this.editorOnApply = onApply ?? null;
    this.editorMonsterOnApply = onApply ?? null;
    this.editorSceneryOnApply = onApply ?? null;
    this.dragState = null;
    this.selectedIndex = null;
    this.selectedMonsterIndex = null;
    this.selectedSceneryIndex = null;
    this.editorActive = mode !== null;
    this.input.off('pointerdown');
    this.input.off('pointermove');
    this.input.off('pointerup');
    if (this.game?.canvas) this.game.canvas.style.cursor = '';

    if (mode !== null) {
      // Stop following player while editor is open; pan with WASD in update().
      this.cameras.main.stopFollow();
    } else {
      // Editor closed — restart following if we have a local player.
      if (this.localPlayerId) {
        const avatar = this.avatars.get(this.localPlayerId);
        if (avatar) this.startFollowingAvatar(avatar);
      }
    }

    if (mode === 'add') {
      this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (pointer.button !== 0) return;
        if (this.editorPlatformsRef && this.editorOnChange) {
          this.editorPlatformsRef.push({ cx: Math.round(pointer.worldX), surfaceY: Math.round(pointer.worldY), width: 160 });
          this.syncPlatforms(this.editorPlatformsRef);
          this.editorOnChange(this.editorPlatformsRef);
          this.editorOnApply?.();
        }
      });
      if (this.game?.canvas) this.game.canvas.style.cursor = 'crosshair';
    } else if (mode === 'add-monster') {
      this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (pointer.button !== 0) return;
        if (this.editorMonsterSpawnsRef && this.editorMonsterOnChange) {
          const id = `spawn-${Date.now()}-${this.spawnIdCounter++}`;
          this.editorMonsterSpawnsRef.push({ id, x: Math.round(pointer.worldX), y: Math.round(pointer.worldY) });
          this.editorMonsterOnChange(this.editorMonsterSpawnsRef);
          this.editorMonsterOnApply?.();
          this.updateEditorOverlay(this.editorPlatformsRef ?? []);
        }
      });
      if (this.game?.canvas) this.game.canvas.style.cursor = 'crosshair';
    } else if (mode === 'add-weapon') {
      this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (pointer.button !== 0) return;
        if (!this.editorWeaponSpawnsRef || !this.editorWeaponOnChange) return;
        const id = `ws-${Date.now()}-${this.spawnWeaponIdCounter++}`;
        this.editorWeaponSpawnsRef.push({ id, type: this.editorSelectedWeaponType, x: Math.round(pointer.worldX), y: Math.round(pointer.worldY) });
        this.editorWeaponOnChange(this.editorWeaponSpawnsRef);
        this.updateEditorOverlay(this.editorPlatformsRef ?? []);
      });
      if (this.game?.canvas) this.game.canvas.style.cursor = 'crosshair';
    } else if (mode === 'add-object') {
      this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (pointer.button !== 0) return;
        const sel = this.editorSelectedScenery;
        if (!sel || !this.editorSceneryRef || !this.editorSceneryOnChange) return;
        const { key, solid } = sel;
        const id = `obj-${Date.now()}-${this.sceneryIdCounter++}`;
        const defaultSize = 64;
        const obj: SceneryObjectDto = {
          id, spriteKey: key,
          x: Math.round(pointer.worldX - defaultSize / 2),
          y: Math.round(pointer.worldY - defaultSize / 2),
          width: defaultSize, height: defaultSize,
          solid
        };
        this.editorSceneryRef.push(obj);
        this.editorSceneryOnChange(this.editorSceneryRef);
        this.editorSceneryOnApply?.();
        this.syncScenery(this.editorSceneryRef);
      });
      if (this.game?.canvas) this.game.canvas.style.cursor = 'crosshair';
    } else if (mode === 'move') {
      this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (pointer.button !== 0) return;

        // Priority: scenery corner → scenery body → monster → platform
        const sceneryCorner = this.hitTestSceneryCorner(pointer.worldX, pointer.worldY);
        if (sceneryCorner !== null) {
          this.dragState = sceneryCorner;
          if (this.game?.canvas) this.game.canvas.style.cursor = 'nwse-resize';
          return;
        }
        const sceneryBody = this.hitTestSceneryBody(pointer.worldX, pointer.worldY);
        if (sceneryBody !== null) {
          this.selectedSceneryIndex = sceneryBody;
          this.selectedIndex = null;
          this.selectedMonsterIndex = null;
          const o = this.editorSceneryRef![sceneryBody];
          this.dragState = { type: 'move-obj', idx: sceneryBody, startX: pointer.worldX, startY: pointer.worldY, origX: o.x, origY: o.y };
          this.updateEditorOverlay(this.editorPlatformsRef ?? []);
          if (this.game?.canvas) this.game.canvas.style.cursor = 'grabbing';
          return;
        }

        const monsterHit = this.hitTestMonsterSpawn(pointer.worldX, pointer.worldY);
        if (monsterHit !== null) {
          this.selectedMonsterIndex = monsterHit;
          this.selectedIndex = null;
          this.selectedSceneryIndex = null;
          this.updateEditorOverlay(this.editorPlatformsRef ?? []);
          return;
        }

        if (!this.editorPlatformsRef) return;
        const hit = this.hitTestPlatform(pointer.worldX, pointer.worldY);
        this.selectedIndex = hit?.index ?? null;
        this.selectedMonsterIndex = null;
        this.selectedSceneryIndex = null;
        this.updateEditorOverlay(this.editorPlatformsRef);
        if (!hit) return;
        const p = this.editorPlatformsRef[hit.index];
        this.dragState = {
          type: hit.type, index: hit.index,
          startX: pointer.worldX, startY: pointer.worldY,
          origCx: p.cx, origSy: p.surfaceY, origWidth: p.width
        };
        if (this.game?.canvas) this.game.canvas.style.cursor = hit.type === 'move' ? 'grabbing' : 'ew-resize';
      });
      this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
        this.handleMovePointerMove(pointer);
      });
      this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
        if (pointer.button !== 0) return;
        const state = this.dragState;
        this.dragState = null;
        if (this.game?.canvas) this.game.canvas.style.cursor = 'default';
        if (state?.type === 'move-obj' || state?.type === 'resize-obj-corner') {
          this.editorSceneryOnApply?.();
        } else if (state) {
          this.editorOnApply?.();
        }
      });
    } else {
      this.editorGfx?.clear();
    }

    if (platforms || monsterSpawns || sceneryObjects) this.updateEditorOverlay(platforms ?? []);
    else this.editorGfx?.clear();
  }

  private hitTestSceneryBody(px: number, py: number): number | null {
    const objs = this.editorSceneryRef;
    if (!objs) return null;
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (px >= o.x && px <= o.x + o.width && py >= o.y && py <= o.y + o.height) return i;
    }
    return null;
  }

  private hitTestSceneryCorner(px: number, py: number): Extract<DesertScene['dragState'], { type: 'resize-obj-corner' }> | null {
    if (this.selectedSceneryIndex === null || !this.editorSceneryRef) return null;
    const o = this.editorSceneryRef[this.selectedSceneryIndex];
    if (!o) return null;
    const R = 8;
    const corners: [number, number, 1 | -1, 1 | -1][] = [
      [o.x,           o.y,            -1, -1], // TL
      [o.x + o.width, o.y,             1, -1], // TR
      [o.x,           o.y + o.height, -1,  1], // BL
      [o.x + o.width, o.y + o.height,  1,  1], // BR
    ];
    for (const [cx, cy, sx, sy] of corners) {
      if (Math.abs(px - cx) <= R && Math.abs(py - cy) <= R) {
        const fixedX = sx > 0 ? o.x           : o.x + o.width;
        const fixedY = sy > 0 ? o.y           : o.y + o.height;
        return { type: 'resize-obj-corner', idx: this.selectedSceneryIndex, fixedX, fixedY, signX: sx, signY: sy, origW: o.width, origH: o.height };
      }
    }
    return null;
  }

  private hitTestMonsterSpawn(px: number, py: number): number | null {
    const spawns = this.editorMonsterSpawnsRef;
    if (!spawns) return null;
    for (let i = spawns.length - 1; i >= 0; i--) {
      const s = spawns[i];
      const dx = px - s.x;
      const dy = py - s.y;
      if (Math.sqrt(dx * dx + dy * dy) <= 28) return i;
    }
    return null;
  }

  public getSelectedMonsterIndex(): number | null { return this.selectedMonsterIndex; }

  public clearMonsterSelection(): void {
    this.selectedMonsterIndex = null;
    this.updateEditorOverlay(this.editorPlatformsRef ?? []);
  }

  public updateEditorMonsterSpawnsRef(spawns: MonsterSpawnDto[]): void {
    this.editorMonsterSpawnsRef = spawns;
    this.selectedMonsterIndex = null;
    this.updateEditorOverlay(this.editorPlatformsRef ?? []);
  }

  private hitTestPlatform(px: number, py: number): { index: number; type: 'move' | 'resize-left' | 'resize-right' } | null {
    const platforms = this.editorPlatformsRef;
    if (!platforms) return null;
    const H = 12;
    for (let i = platforms.length - 1; i >= 0; i--) {
      const p = platforms[i];
      const left = p.cx - p.width / 2;
      const right = p.cx + p.width / 2;
      if (py < p.surfaceY || py > p.surfaceY + 26) continue;
      if (px >= left && px <= left + H) return { index: i, type: 'resize-left' };
      if (px >= right - H && px <= right) return { index: i, type: 'resize-right' };
      if (px >= left && px <= right) return { index: i, type: 'move' };
    }
    return null;
  }

  private handleMovePointerMove(pointer: Phaser.Input.Pointer): void {
    const platforms = this.editorPlatformsRef;
    if (!platforms) return;
    if (this.dragState) {
      const state = this.dragState;
      if (state.type === 'move-obj') {
        const o = this.editorSceneryRef?.[state.idx];
        if (o) {
          o.x = Math.round(state.origX + (pointer.worldX - state.startX));
          o.y = Math.round(state.origY + (pointer.worldY - state.startY));
          this.syncScenery(this.editorSceneryRef!);
          this.editorSceneryOnChange?.(this.editorSceneryRef!);
        }
      } else if (state.type === 'resize-obj-corner') {
        const o = this.editorSceneryRef?.[state.idx];
        if (o) {
          const rawW = state.signX * (pointer.worldX - state.fixedX);
          const newW = Math.max(20, rawW);
          const aspect = state.origW / state.origH;
          const newH = Math.max(20, newW / aspect);
          o.width  = Math.round(newW);
          o.height = Math.round(newH);
          o.x = Math.round(state.signX > 0 ? state.fixedX : state.fixedX - newW);
          o.y = Math.round(state.signY > 0 ? state.fixedY : state.fixedY - newH);
          this.syncScenery(this.editorSceneryRef!);
          this.editorSceneryOnChange?.(this.editorSceneryRef!);
        }
      } else {
        const dx = pointer.worldX - state.startX;
        const dy = pointer.worldY - state.startY;
        const p = platforms[state.index];
        if (state.type === 'move') {
          p.cx = Math.round(state.origCx + dx);
          p.surfaceY = Math.round(state.origSy + dy);
        } else if (state.type === 'resize-right') {
          const origLeft = state.origCx - state.origWidth / 2;
          const newWidth = Math.max(40, state.origWidth + dx);
          p.width = Math.round(newWidth);
          p.cx = Math.round(origLeft + newWidth / 2);
        } else {
          const origRight = state.origCx + state.origWidth / 2;
          const newWidth = Math.max(40, state.origWidth - dx);
          p.width = Math.round(newWidth);
          p.cx = Math.round(origRight - newWidth / 2);
        }
        this.syncPlatforms(platforms);
        this.editorOnChange?.(platforms);
      }
    } else if (this.game?.canvas) {
      if (this.hitTestSceneryCorner(pointer.worldX, pointer.worldY)) {
        this.game.canvas.style.cursor = 'nwse-resize';
      } else if (this.hitTestSceneryBody(pointer.worldX, pointer.worldY) !== null) {
        this.game.canvas.style.cursor = 'grab';
      } else {
        const hit = this.hitTestPlatform(pointer.worldX, pointer.worldY);
        this.game.canvas.style.cursor = hit ? (hit.type === 'move' ? 'grab' : 'ew-resize') : 'default';
      }
    }
  }

  public updateEditorOverlay(platforms: PlatformDto[]): void {
    if (!this.editorGfx) {
      this.editorGfx = this.add.graphics().setDepth(10);
    }
    this.editorGfx.clear();
    if (!this.editorInteraction) return;

    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      const left = p.cx - p.width / 2;
      const isSelected = this.editorInteraction === 'move' && this.selectedIndex === i;
      if (isSelected) {
        this.editorGfx.lineStyle(3, 0xffdd00, 1.0);
        this.editorGfx.strokeRect(left - 2, p.surfaceY - 2, p.width + 4, 30);
      }
      this.editorGfx.lineStyle(2, 0x00ff88, 0.85);
      this.editorGfx.strokeRect(left, p.surfaceY, p.width, 26);
      if (this.editorInteraction === 'move') {
        this.editorGfx.fillStyle(0x00ff88, 0.4);
        this.editorGfx.fillRect(left, p.surfaceY, 10, 26);
        this.editorGfx.fillRect(left + p.width - 10, p.surfaceY, 10, 26);
      }
    }

    const spawns = this.editorMonsterSpawnsRef;
    if (spawns) {
      for (let i = 0; i < spawns.length; i++) {
        const s = spawns[i];
        const isSelected = this.selectedMonsterIndex === i;
        if (isSelected) {
          this.editorGfx.lineStyle(3, 0xffdd00, 1.0);
          this.editorGfx.strokeCircle(s.x, s.y, 32);
        }
        this.editorGfx.lineStyle(2, 0xff8800, 0.9);
        this.editorGfx.strokeCircle(s.x, s.y, 26);
        this.editorGfx.fillStyle(0xff8800, 0.2);
        this.editorGfx.fillCircle(s.x, s.y, 26);
      }
    }

    const scenery = this.editorSceneryRef;
    if (scenery) {
      for (let i = 0; i < scenery.length; i++) {
        const o = scenery[i];
        const isSelected = this.editorInteraction === 'move' && this.selectedSceneryIndex === i;
        const col = o.solid ? 0xff4444 : 0x44aaff;
        if (isSelected) {
          this.editorGfx.lineStyle(3, 0xffdd00, 1.0);
          this.editorGfx.strokeRect(o.x - 2, o.y - 2, o.width + 4, o.height + 4);
          // Corner handles
          const R = 8;
          this.editorGfx.fillStyle(0xffdd00, 1.0);
          for (const [cx, cy] of [[o.x, o.y], [o.x + o.width, o.y], [o.x, o.y + o.height], [o.x + o.width, o.y + o.height]] as [number, number][]) {
            this.editorGfx.fillRect(cx - R, cy - R, R * 2, R * 2);
          }
        } else {
          this.editorGfx.lineStyle(2, col, 0.8);
          this.editorGfx.strokeRect(o.x, o.y, o.width, o.height);
        }
        if (o.solid) {
          this.editorGfx.fillStyle(col, 0.12);
          this.editorGfx.fillRect(o.x, o.y, o.width, o.height);
        }
      }
    }

    const weaponSpawnsOverlay = this.editorWeaponSpawnsRef;
    if (weaponSpawnsOverlay) {
      for (const s of weaponSpawnsOverlay) {
        const col = s.type === "bow" ? 0x44ffaa : s.type === "sword" ? 0xff8844 : 0xaa44ff;
        this.editorGfx.lineStyle(2, col, 0.9);
        this.editorGfx.strokeRect(s.x - 18, s.y - 18, 36, 36);
        this.editorGfx.fillStyle(col, 0.2);
        this.editorGfx.fillRect(s.x - 18, s.y - 18, 36, 36);
      }
    }
  }

  public getSelectedIndex(): number | null { return this.selectedIndex; }
  public getSelectedSceneryIndex(): number | null { return this.selectedSceneryIndex; }

  public clearSelection(): void {
    this.selectedIndex = null;
    if (this.editorPlatformsRef) this.updateEditorOverlay(this.editorPlatformsRef);
  }

  public clearScenerySelection(): void {
    this.selectedSceneryIndex = null;
    this.updateEditorOverlay(this.editorPlatformsRef ?? []);
  }

  public updateEditorPlatformsRef(platforms: PlatformDto[]): void {
    this.editorPlatformsRef = platforms;
    this.selectedIndex = null;
    this.updateEditorOverlay(platforms);
  }

  private addDunes(): void {
    const groundSurfaceY = GROUND_Y;
    const count = Math.max(3, Math.ceil(WORLD_WIDTH / 340));
    for (let i = 0; i < count; i++) {
      const frac = (i + 0.3 + (i % 2) * 0.4) / count;
      const x = WORLD_WIDTH * frac;
      const width = 200 + (i % 4) * 80;
      const height = 24 + (i % 3) * 8;
      const alpha = 0.18 + (i % 3) * 0.04;
      const shadow = this.add.ellipse(x + 10, groundSurfaceY - height * 0.25 + 6, width, height, 0x7a4820, alpha * 0.55);
      shadow.setDepth(3);
      const ridge = this.add.ellipse(x, groundSurfaceY - height * 0.25, width, height, 0xdaa55e, alpha);
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
  private editorPlatforms: PlatformDto[] = makeDefaultPlatforms();
  private editorMonsterSpawns: MonsterSpawnDto[] = [];
  private editorOpen = false;
  private editorAddMode = false;
  private editorMonsterAddMode = false;
  private editorObjAddMode = false;
  private editorSceneryObjects: SceneryObjectDto[] = [];
  private sceneryLibrary: SceneryLibraryEntry[] = [];
  private selectedSceneryKey: string | null = null;
  private editorWeaponAddMode = false;
  private editorWeaponSpawns: WeaponSpawnDto[] = [];
  private selectedWeaponType = "staff";
  private debugHitboxes = false;

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
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT
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

    this.ui.editorSaveBtn.addEventListener("click", () => { void this.saveMap(); });
    this.ui.editorLoadBtn.addEventListener("click", () => { void this.loadMap(); });
    this.ui.preJoinEditorBtn.addEventListener("click", () => {
      this.editorOpen = true;
      this.refreshEditorState();
    });
    this.ui.editorZoomFitBtn.addEventListener("click", () => {
      this.scene.setCameraZoomToFit();
    });
    this.ui.editorWorldApplyBtn.addEventListener("click", () => {
      const w = parseFloat(this.ui.editorWorldWidthInput.value);
      const h = parseFloat(this.ui.editorWorldHeightInput.value);
      if (!isNaN(w) && !isNaN(h)) void this.applyWorldSize(w, h);
    });
    document.getElementById("debug-hitboxes-btn")?.addEventListener("click", () => {
      this.debugHitboxes = !this.debugHitboxes;
      this.scene.debugHitboxes = this.debugHitboxes;
      document.getElementById("debug-hitboxes-btn")!.classList.toggle("active", this.debugHitboxes);
    });
    document.getElementById("editor-close-btn")?.addEventListener("click", () => {
      this.editorOpen = false;
      this.refreshEditorState();
    });
    this.ui.editorAddToggle.addEventListener("click", () => {
      this.editorAddMode = !this.editorAddMode;
      if (this.editorAddMode) { this.editorMonsterAddMode = false; this.editorObjAddMode = false; this.editorWeaponAddMode = false; }
      this.ui.editorAddToggle.classList.toggle("active", this.editorAddMode);
      this.ui.editorMonsterAddToggle.classList.toggle("active", false);
      this.ui.editorObjAddToggle.classList.toggle("active", false);
      this.ui.editorWeaponAddToggle.classList.toggle("active", false);
      this.refreshEditorState();
    });

    this.ui.editorMonsterAddToggle.addEventListener("click", () => {
      this.editorMonsterAddMode = !this.editorMonsterAddMode;
      if (this.editorMonsterAddMode) { this.editorAddMode = false; this.editorObjAddMode = false; this.editorWeaponAddMode = false; }
      this.ui.editorMonsterAddToggle.classList.toggle("active", this.editorMonsterAddMode);
      this.ui.editorAddToggle.classList.toggle("active", false);
      this.ui.editorObjAddToggle.classList.toggle("active", false);
      this.ui.editorWeaponAddToggle.classList.toggle("active", false);
      this.refreshEditorState();
    });

    this.ui.editorWeaponAddToggle.addEventListener("click", () => {
      this.editorWeaponAddMode = !this.editorWeaponAddMode;
      if (this.editorWeaponAddMode) { this.editorAddMode = false; this.editorMonsterAddMode = false; this.editorObjAddMode = false; }
      this.ui.editorWeaponAddToggle.classList.toggle("active", this.editorWeaponAddMode);
      this.ui.editorAddToggle.classList.toggle("active", false);
      this.ui.editorMonsterAddToggle.classList.toggle("active", false);
      this.ui.editorObjAddToggle.classList.toggle("active", false);
      this.refreshEditorState();
    });

    this.ui.editorObjAddToggle.addEventListener("click", () => {
      this.editorObjAddMode = !this.editorObjAddMode;
      if (this.editorObjAddMode) { this.editorAddMode = false; this.editorMonsterAddMode = false; }
      this.ui.editorObjAddToggle.classList.toggle("active", this.editorObjAddMode);
      this.ui.editorAddToggle.classList.toggle("active", false);
      this.ui.editorMonsterAddToggle.classList.toggle("active", false);
      this.refreshEditorState();
    });

    this.ui.editorObjSelect.addEventListener("change", () => {
      this.selectedSceneryKey = this.ui.editorObjSelect.value || null;
      this.refreshEditorState();
    });

    this.ui.editorObjNewBtn.addEventListener("click", () => {
      this.ui.editorObjFileInput.value = "";
      this.ui.editorObjFileInput.click();
    });

    this.ui.editorObjFileInput.addEventListener("change", () => {
      const file = this.ui.editorObjFileInput.files?.[0];
      if (!file) return;
      void this.uploadScenerySprite(file);
    });

    window.addEventListener("keydown", (event) => {
      // Delete works in editor even before joining.
      if (event.key === "Delete" && this.editorOpen && !this.editorAddMode && !this.editorMonsterAddMode && !this.editorObjAddMode && !this.editorWeaponAddMode && !(document.activeElement instanceof HTMLInputElement)) {
        const sceneryIdx = this.scene.getSelectedSceneryIndex();
        if (sceneryIdx !== null) {
          this.editorSceneryObjects.splice(sceneryIdx, 1);
          this.scene.clearScenerySelection();
          void this.applyScenery();
          event.preventDefault();
          return;
        }
        const monsterIdx = this.scene.getSelectedMonsterIndex();
        if (monsterIdx !== null) {
          this.editorMonsterSpawns.splice(monsterIdx, 1);
          this.scene.clearMonsterSelection();
          void this.applyMonsterSpawns();
          event.preventDefault();
          return;
        }
        const idx = this.scene.getSelectedIndex();
        if (idx !== null) {
          this.editorPlatforms.splice(idx, 1);
          this.scene.syncPlatforms(this.editorPlatforms);
          this.scene.clearSelection();
          void this.applyPlatforms();
          event.preventDefault();
          return;
        }
      }

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
          this.sendAttack();
          break;
        case "Delete":
          // Handled above (pre-join compatible).
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
      this.scene.setLocalPlayerId(selfId);
      // Close editor when joining (editor is pre-join only).
      if (this.editorOpen) {
        this.editorOpen = false;
        this.editorAddMode = false;
        this.editorMonsterAddMode = false;
        this.refreshEditorState();
      }
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
      void this.connection.send("GetPlatforms");
    });

    this.connection.on("RulesSchema", (payload: { fields: TunableField[] }) => {
      this.rulesSchema = payload.fields;
      const fbSpeed = payload.fields.find(f => f.key === "FireballSpeed");
      if (fbSpeed != null) FIREBALL_SPEED = fbSpeed.value;
      const playerSize = payload.fields.find(f => f.key === "PlayerSize");
      if (playerSize != null) PLAYER_SIZE = playerSize.value;
      const collRadius = payload.fields.find(f => f.key === "PlayerCollisionRadius");
      if (collRadius != null) PLAYER_COLLISION_RADIUS = collRadius.value;
      const fbHit = payload.fields.find(f => f.key === "FireballHitRadius");
      if (fbHit != null) FIREBALL_HIT_RADIUS = fbHit.value;
      const mannaR = payload.fields.find(f => f.key === "MannaCollectRadius");
      if (mannaR != null) MANNA_COLLECT_RADIUS = mannaR.value;
      const worldW = payload.fields.find(f => f.key === "WorldWidthMultiplier");
      if (worldW != null) this.ui.editorWorldWidthInput.value = String(worldW.value);
      const worldH = payload.fields.find(f => f.key === "WorldHeightMultiplier");
      if (worldH != null) this.ui.editorWorldHeightInput.value = String(worldH.value);
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

    this.connection.on("PlatformsUpdated", (payload: { platforms: PlatformDto[] }) => {
      this.editorPlatforms = payload.platforms;
      this.scene.syncPlatforms(payload.platforms);
      if (this.editorOpen) this.scene.updateEditorPlatformsRef(payload.platforms);
    });

    this.connection.on("MonsterSpawnsUpdated", (payload: { spawns: MonsterSpawnDto[] }) => {
      this.editorMonsterSpawns = payload.spawns;
      if (this.editorOpen) this.scene.updateEditorMonsterSpawnsRef(payload.spawns);
    });

    this.connection.on("SceneryObjectsUpdated", (payload: { objects: SceneryObjectDto[] }) => {
      this.editorSceneryObjects = payload.objects;
      this.scene.syncScenery(payload.objects);
    });

    this.connection.on("WeaponSpawnsUpdated", (payload: { spawns: WeaponSpawnDto[] }) => {
      this.editorWeaponSpawns = payload.spawns;
    });

    this.connection.on("MapList", (payload: { names: string[] }) => {
      this.ui.editorLoadSelect.replaceChildren();
      const def = document.createElement("option");
      def.value = "";
      def.textContent = "Load map…";
      this.ui.editorLoadSelect.append(def);
      for (const name of payload.names) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        this.ui.editorLoadSelect.append(opt);
      }
    });

    this.connection.on("MapActionRejected", (payload: { action: string; reason: string }) => {
      this.showEditorNotice(`${payload.action} failed: ${payload.reason}`, "danger");
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
      if (this.selfId) this.scene.setLocalPlayerId(this.selfId);
      if (starterId === this.selfId) {
        this.setBanner("Round started", "The sea path is opening again.", "success", false);
      }
      this.updateRoundPanel(this.lastView);
    });

    this.connection.on("RoundRestarted", ({ starterId }: { starterId: string }) => {
      this.pendingRoundAction = null;
      if (this.selfId) this.scene.setLocalPlayerId(this.selfId);
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

  private sendAttack(): void {
    if (!this.connection || this.connection.state !== HubConnectionState.Connected || !this.selfId) {
      return;
    }

    void this.connection.send("Attack");
  }

  private sendEmote(code: EmoteCode): void {
    if (!this.connection || this.connection.state !== HubConnectionState.Connected || !this.selfId) {
      return;
    }

    void this.connection.send("Emote", { code });
  }

  private handleSnapshot(snapshot: WorldSnapshot): void {
    const previous = this.lastSnapshot;
    if (snapshot.worldWidth > 0 && snapshot.worldHeight > 0) {
      updateWorldSize(snapshot.worldWidth, snapshot.worldHeight);
      this.scene.updateCameraBounds();
    }
    const view = deriveRoundView(snapshot, previous ?? undefined);
    // Stop following when local player is dead (free-roam); restart on new round.
    if (this.selfId) {
      const selfPlayer = view.players.find(p => p.id === this.selfId);
      if (selfPlayer && !selfPlayer.isAlive) {
        this.scene.setLocalPlayerId(null);
      }
    }
    this.scene.syncRound(view, this.selfId,
      snapshot.projectiles ?? [],
      snapshot.monsters ?? [],
      snapshot.weaponSpawns ?? []);
    this.updateRoundPanel(view);
    this.updateSpecialNotices(view);
    this.updateDebugState(view);
    this.renderSidebar(view);
    this.updateMenuVisibility(view);
    this.updateTuningPanelVisibility(view);
    this.updateEditorPanelVisibility(view);
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

  private updateEditorPanelVisibility(_view: RoundView | null): void {
    // Editor is pre-join only — close it as soon as the player joins.
    this.ui.preJoinEditorBtn.classList.toggle("hidden", !!this.selfId);
    if (this.selfId && this.editorOpen) {
      this.editorOpen = false;
      this.editorAddMode = false;
      this.editorMonsterAddMode = false;
      this.editorObjAddMode = false;
      this.refreshEditorState();
    }
  }

  private refreshEditorState(): void {
    this.ui.editorOverlay.classList.toggle("hidden", !this.editorOpen);
    this.ui.editorAddToggle.classList.toggle("active", this.editorAddMode);
    this.ui.editorMonsterAddToggle.classList.toggle("active", this.editorMonsterAddMode);
    this.ui.editorObjAddToggle.classList.toggle("active", this.editorObjAddMode);
    this.ui.editorWeaponAddToggle.classList.toggle("active", this.editorWeaponAddMode);
    if (this.editorOpen) {
      // Fetch current state from server when opening pre-join.
      if (!this.selfId && this.connection?.state === HubConnectionState.Connected) {
        void this.connection.send("GetRules");
        void this.loadSceneryLibrary();
      }
      const mode = this.editorAddMode ? 'add' : this.editorMonsterAddMode ? 'add-monster' : this.editorObjAddMode ? 'add-object' : this.editorWeaponAddMode ? 'add-weapon' : 'move';
      const libEntry = this.selectedSceneryKey
        ? (this.sceneryLibrary.find(e => e.key === this.selectedSceneryKey) ?? null)
        : null;
      this.scene.setEditorInteraction(
        mode,
        this.editorPlatforms,
        this.editorMonsterSpawns,
        this.editorSceneryObjects,
        libEntry,
        (platforms) => { this.editorPlatforms = platforms; },
        (spawns) => { this.editorMonsterSpawns = spawns; },
        (objects) => { this.editorSceneryObjects = objects; void this.applyScenery(); },
        () => { void this.applyPlatforms(); void this.applyMonsterSpawns(); },
        this.editorWeaponSpawns,
        this.selectedWeaponType,
        (spawns) => { this.editorWeaponSpawns = spawns; void this.applyWeaponSpawns(); }
      );
    } else {
      this.scene.setEditorInteraction(null, null, null, null, null, null, null, null, null, null, "staff", null);
      this.scene.resetCameraZoom();
    }
  }

  private async loadSceneryLibrary(): Promise<void> {
    try {
      const res = await fetch("/api/scenery/list");
      if (!res.ok) return;
      const entries: SceneryLibraryEntry[] = await res.json() as SceneryLibraryEntry[];
      this.sceneryLibrary = entries;
      this.populateSceneryDropdown();
    } catch { /* silent */ }
  }

  private populateSceneryDropdown(): void {
    this.ui.editorObjSelect.replaceChildren();
    const def = document.createElement("option");
    def.value = "";
    def.textContent = "Select sprite…";
    this.ui.editorObjSelect.append(def);
    for (const entry of this.sceneryLibrary) {
      const opt = document.createElement("option");
      opt.value = entry.key;
      opt.textContent = entry.key.replace(/\.png$/i, "");
      this.ui.editorObjSelect.append(opt);
    }
    if (this.selectedSceneryKey) {
      this.ui.editorObjSelect.value = this.selectedSceneryKey;
    }
  }

  private async uploadScenerySprite(file: File): Promise<void> {
    const defaultName = file.name.replace(/\.png$/i, "");
    const rawName = prompt("Name for this object:", defaultName);
    if (rawName === null) return;
    const safeName = rawName.trim().replace(/[^a-zA-Z0-9_\-]/g, "_") || defaultName;
    const finalFilename = `${safeName}.png`;
    const renamedFile = new File([file], finalFilename, { type: "image/png" });
    const solid = confirm(`Is "${safeName}" a solid object that blocks players?`);
    const form = new FormData();
    form.append("file", renamedFile);
    form.append("solid", solid ? "true" : "false");
    try {
      const res = await fetch("/api/scenery/upload", { method: "POST", body: form });
      if (!res.ok) { this.showEditorNotice("Upload failed.", "danger"); return; }
      const entry = await res.json() as SceneryLibraryEntry;
      if (!this.sceneryLibrary.find(e => e.key === entry.key)) {
        this.sceneryLibrary.push(entry);
      }
      this.selectedSceneryKey = entry.key;
      this.populateSceneryDropdown();
      this.refreshEditorState();
      this.showEditorNotice(`Saved "${safeName}".`, "success");
    } catch {
      this.showEditorNotice("Upload failed.", "danger");
    }
  }

  private async applyWorldSize(widthMultiplier: number, heightMultiplier: number): Promise<void> {
    if (!this.connection || this.connection.state !== HubConnectionState.Connected) return;
    try {
      await this.connection.send("UpdateRules", { updates: { WorldWidthMultiplier: widthMultiplier, WorldHeightMultiplier: heightMultiplier } });
    } catch { /* silent */ }
  }

  private async applyPlatforms(): Promise<void> {
    if (!this.connection || this.connection.state !== HubConnectionState.Connected) return;
    try {
      await this.connection.send("ApplyPlatforms", { platforms: this.editorPlatforms });
    } catch { /* silent — live apply is best-effort */ }
  }

  private async applyMonsterSpawns(): Promise<void> {
    if (!this.connection || this.connection.state !== HubConnectionState.Connected) return;
    try {
      await this.connection.send("ApplyMonsterSpawns", { spawns: this.editorMonsterSpawns });
    } catch { /* silent — live apply is best-effort */ }
  }

  private async applyScenery(): Promise<void> {
    if (!this.connection || this.connection.state !== HubConnectionState.Connected) return;
    try {
      await this.connection.send("ApplyScenery", { objects: this.editorSceneryObjects });
    } catch { /* silent — live apply is best-effort */ }
  }

  private async applyWeaponSpawns(): Promise<void> {
    if (!this.connection || this.connection.state !== HubConnectionState.Connected) return;
    try {
      await this.connection.send("ApplyWeaponSpawns", { spawns: this.editorWeaponSpawns });
    } catch { /* silent — live apply is best-effort */ }
  }

  private async saveMap(): Promise<void> {
    if (!this.connection || this.connection.state !== HubConnectionState.Connected) return;
    const name = this.ui.editorMapName.value.trim();
    if (!name) { this.showEditorNotice("Enter a map name.", "danger"); return; }
    try {
      await this.connection.send("SaveMap", { name, platforms: this.editorPlatforms, sceneryObjects: this.editorSceneryObjects, weaponSpawns: this.editorWeaponSpawns });
      this.showEditorNotice("Map saved.", "success");
    } catch {
      this.showEditorNotice("Save failed.", "danger");
    }
  }

  private async loadMap(): Promise<void> {
    if (!this.connection || this.connection.state !== HubConnectionState.Connected) return;
    const name = this.ui.editorLoadSelect.value;
    if (!name) return;
    try {
      await this.connection.send("LoadMap", { name });
    } catch {
      this.showEditorNotice("Load failed.", "danger");
    }
  }

  private showEditorNotice(message: string, tone: "success" | "danger"): void {
    this.ui.editorNotice.textContent = message;
    this.ui.editorNotice.dataset.tone = tone;
    this.ui.editorNotice.classList.remove("hidden");
    window.setTimeout(() => { this.ui.editorNotice.classList.add("hidden"); }, 3000);
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
            <button class="tuning-apply debug-hitboxes-btn" id="debug-hitboxes-btn" type="button">Debug Hitboxes</button>
          </div>
        </section>
        <div class="pre-join-editor-row" id="pre-join-editor-row">
          <button class="editor-open-btn" id="pre-join-editor-btn" type="button">Level Editor</button>
        </div>
      </aside>
      <div class="editor-overlay hidden" id="editor-overlay">
        <div class="editor-overlay-head">
          <span class="section-title">Level Editor</span>
          <button class="editor-close-btn" id="editor-close-btn" type="button">✕</button>
        </div>
        <button class="editor-toggle-btn" id="editor-add-toggle" type="button">＋ Add Platform</button>
        <button class="editor-toggle-btn" id="editor-monster-add-toggle" type="button">＋ Add Monster</button>
        <div class="editor-map-bar">
          <button class="editor-toggle-btn" id="editor-weapon-add-toggle" type="button">＋ Add Weapon</button>
          <select id="editor-weapon-type-select">
            <option value="staff">Staff</option>
            <option value="bow">Bow</option>
            <option value="sword">Sword</option>
          </select>
        </div>
        <button class="editor-toggle-btn" id="editor-zoom-fit-btn" type="button">⊞ Zoom to Fit</button>
        <button class="editor-toggle-btn" id="editor-obj-add-toggle" type="button">＋ Place Object</button>
        <div class="editor-map-bar">
          <select id="editor-obj-select" style="flex:1"><option value="">Select sprite…</option></select>
          <button id="editor-obj-new-btn" type="button">+ New</button>
          <input id="editor-obj-file-input" type="file" accept=".png" style="display:none" />
        </div>
        <div class="editor-map-bar">
          <label>W×</label>
          <input id="editor-world-width" type="number" min="1" max="10" step="0.5" value="3" />
          <label>H×</label>
          <input id="editor-world-height" type="number" min="1" max="10" step="0.5" value="3" />
          <button id="editor-world-apply-btn" type="button">Apply</button>
        </div>
        <div class="editor-map-bar">
          <input id="editor-map-name" placeholder="Map name" maxlength="40" />
          <button id="editor-save-btn" type="button">Save</button>
        </div>
        <div class="editor-map-bar">
          <select id="editor-load-select"><option value="">Load map…</option></select>
          <button id="editor-load-btn" type="button">Load</button>
        </div>
        <div id="editor-notice" class="editor-notice hidden"></div>
      </div>
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
    tuningNotice: document.querySelector<HTMLDivElement>("#tuning-notice")!,
    editorOverlay: document.querySelector<HTMLElement>("#editor-overlay")!,
    editorAddToggle: document.querySelector<HTMLButtonElement>("#editor-add-toggle")!,
    editorMonsterAddToggle: document.querySelector<HTMLButtonElement>("#editor-monster-add-toggle")!,
    editorWeaponAddToggle: document.querySelector<HTMLButtonElement>("#editor-weapon-add-toggle")!,
    editorWeaponTypeSelect: document.querySelector<HTMLSelectElement>("#editor-weapon-type-select")!,
    editorMapName: document.querySelector<HTMLInputElement>("#editor-map-name")!,
    editorSaveBtn: document.querySelector<HTMLButtonElement>("#editor-save-btn")!,
    editorLoadSelect: document.querySelector<HTMLSelectElement>("#editor-load-select")!,
    editorLoadBtn: document.querySelector<HTMLButtonElement>("#editor-load-btn")!,
    editorNotice: document.querySelector<HTMLDivElement>("#editor-notice")!,
    editorZoomFitBtn: document.querySelector<HTMLButtonElement>("#editor-zoom-fit-btn")!,
    editorWorldWidthInput: document.querySelector<HTMLInputElement>("#editor-world-width")!,
    editorWorldHeightInput: document.querySelector<HTMLInputElement>("#editor-world-height")!,
    editorWorldApplyBtn: document.querySelector<HTMLButtonElement>("#editor-world-apply-btn")!,
    preJoinEditorBtn: document.querySelector<HTMLButtonElement>("#pre-join-editor-btn")!,
    editorObjAddToggle: document.querySelector<HTMLButtonElement>("#editor-obj-add-toggle")!,
    editorObjSelect: document.querySelector<HTMLSelectElement>("#editor-obj-select")!,
    editorObjNewBtn: document.querySelector<HTMLButtonElement>("#editor-obj-new-btn")!,
    editorObjFileInput: document.querySelector<HTMLInputElement>("#editor-obj-file-input")!
  };

  if (!ui.layout || !ui.sidebar || !ui.stage || !ui.gameRoot || !ui.banner || !ui.waveWarning || !ui.waveNotice || !ui.cloudNotice || !ui.mannaNotice || !ui.roundState || !ui.roundDetail || !ui.roundAction || !ui.joinPanel || !ui.joinButton || !ui.nameInput || !ui.playerList || !ui.playerCount || !ui.statusText || !ui.roomBadge || !ui.connectionBadge || !ui.tuningPanel || !ui.tuningFields || !ui.tuningApply || !ui.tuningNotice || !ui.editorOverlay || !ui.editorAddToggle || !ui.editorMonsterAddToggle || !ui.editorMapName || !ui.editorSaveBtn || !ui.editorLoadSelect || !ui.editorLoadBtn || !ui.editorNotice || !ui.editorZoomFitBtn || !ui.editorWorldWidthInput || !ui.editorWorldHeightInput || !ui.editorWorldApplyBtn || !ui.preJoinEditorBtn || !ui.editorObjAddToggle || !ui.editorObjSelect || !ui.editorObjNewBtn || !ui.editorObjFileInput || !ui.editorWeaponAddToggle || !ui.editorWeaponTypeSelect) {
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
