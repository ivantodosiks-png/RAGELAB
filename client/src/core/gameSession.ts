import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import {
  BULLET_FILTER_GROUPS,
  Button,
  DEFAULT_LOADOUT,
  EYE_HEIGHT_STAND,
  INTERACT_RANGE,
  MAX_HEALTH,
  MAX_INPUTS_PER_PACKET,
  PlayerFlag,
  QualityLevel,
  SPEED_WALK,
  buttonPressed,
  clamp,
  directionFromAngles,
  getArchetype,
  getMap,
  getWeapon,
  type GameEvent,
  type InputCommand,
  type MapDefinition,
  type PlayerIdentity,
  type PlayerScore,
  type Vec3,
  type WeaponId,
  type WelcomePayload,
} from '@ragelab/shared';
import { GameRenderer } from '../renderer/renderer';
import { ClientPhysicsWorld } from '../physics/clientWorld';
import { MapMeshBuilder } from '../maps/mapMeshBuilder';
import { LocalPlayer } from '../player/localPlayer';
import { InputController } from '../player/inputController';
import { CameraRig } from '../player/cameraRig';
import { NetClient, type ConnectOptions } from '../networking/netClient';
import { SnapshotInterpolator } from '../networking/snapshotInterpolator';
import { EntityManager } from '../entities/entityManager';
import { EffectsManager } from '../effects/effectsManager';
import { AudioEngine, footstepSound, impactSound } from '../audio/audioEngine';
import type { SoundKey } from '../audio/synth';
import { WeaponController } from '../weapons/weaponController';
import { settingsStore } from '../settings/settingsStore';
import type { UiApp } from '../ui/app';
import { SandboxPanel } from '../ui/sandboxPanel';
import { SandboxController } from '../sandbox/sandboxController';
import type { SandboxQuality } from '../sandbox/types';
import { GAME_SERVER_URL } from '../supabase/client';

let rapierModule: Promise<typeof RAPIER> | null = null;

async function loadRapier(): Promise<typeof RAPIER> {
  if (!rapierModule) {
    rapierModule = import('@dimforge/rapier3d-compat').then(async (mod) => {
      await mod.default.init();
      return mod.default;
    });
  }
  return rapierModule;
}

export interface SessionStart {
  username: string;
  token?: string;
  roomId?: string;
  mapId?: string;
  password?: string;
  create?: { name: string; mapId: string; maxPlayers: number; password: string };
}

const aimDir: Vec3 = { x: 0, y: 0, z: -1 };
const muzzlePos: Vec3 = { x: 0, y: 0, z: 0 };
const muzzleDir: Vec3 = { x: 0, y: 0, z: -1 };
const listenerFwd: Vec3 = { x: 0, y: 0, z: -1 };
const listenerUp: Vec3 = { x: 0, y: 1, z: 0 };
const tmpVec = new THREE.Vector3();
const commands: InputCommand[] = [];

export class GameSession {
  private renderer!: GameRenderer;
  private physics!: ClientPhysicsWorld;
  private map!: MapDefinition;
  private mapBuilder!: MapMeshBuilder;
  private local!: LocalPlayer;
  private input!: InputController;
  private camera!: CameraRig;
  private net!: NetClient;
  private interp!: SnapshotInterpolator;
  private entities!: EntityManager;
  private effects!: EffectsManager;
  private audio!: AudioEngine;
  private weapon!: WeaponController;
  private sandbox!: SandboxController;
  private sandboxPanel!: SandboxPanel;

  private localId = 0;
  private loadout: WeaponId[] = [...DEFAULT_LOADOUT];
  private identities = new Map<number, PlayerIdentity>();
  private scores: PlayerScore[] = [];
  private lastButtons = 0;
  private lastSlot = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private respawnAt = 0;
  private previousNow = 0;
  private raf = 0;
  private fps = 60;
  private frames = 0;
  private fpsAccum = 0;
  private paused = false;
  private running = false;
  private disposed = false;
  private pendingCreate: SessionStart['create'];
  private remoteStep = new Map<number, number>();
  private readonly feetPos = new THREE.Vector3();
  private readonly unsubs: Array<() => void> = [];

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ui: UiApp,
  ) {}

  static async start(canvas: HTMLCanvasElement, ui: UiApp, start: SessionStart): Promise<GameSession> {
    const session = new GameSession(canvas, ui);
    try {
      await session.boot(start);
      return session;
    } catch (err) {
      session.dispose();
      throw err;
    }
  }

  private async boot(start: SessionStart): Promise<void> {
    const rapier = await loadRapier();
    this.audio = new AudioEngine(settingsStore.audio);
    await this.audio.resume();

    this.renderer = new GameRenderer(this.canvas, settingsStore.graphics);
    this.effects = new EffectsManager(settingsStore.graphics);
    this.renderer.scene.add(this.effects.root);
    this.camera = new CameraRig(this.renderer.camera, this.renderer.viewModelCamera, settingsStore.graphics.fov);
    this.input = new InputController(this.canvas, settingsStore.controls);
    this.input.attach();
    this.interp = new SnapshotInterpolator();
    this.net = new NetClient();
    this.pendingCreate = start.create;

    const welcome = await this.connect({
      url: GAME_SERVER_URL,
      token: start.token,
      username: start.username,
      roomId: start.roomId,
      password: start.password,
      mapId: start.mapId,
    });

    this.buildWorld(rapier, welcome);
    this.bindUi();
    this.bindSettings();
    this.onResize();
    this.running = true;
    this.previousNow = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
    window.addEventListener('resize', this.onResize);
    this.canvas.addEventListener('click', this.onCanvasClick);
    this.canvas.addEventListener('mousemove', this.onPointerMove);
    this.unsubs.push(this.input.onLockChange((locked) => {
      if (!locked && this.running && !this.ui.hud.chatting && !this.sandbox?.cursorMode) {
        this.setPaused(true);
      }
    }));
  }

  private connect(options: ConnectOptions): Promise<WelcomePayload> {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Timed out waiting for the game server')), 12_000);
      this.net.setHandlers({
        onWelcome: (payload) => {
          window.clearTimeout(timeout);
          if (!this.local) {
            resolve(payload);
            return;
          }
          this.onWelcomeLive(payload);
        },
        onSnapshot: (snapshot) => {
          if (!this.local) return;
          this.interp.push(snapshot, performance.now());
          const self = snapshot.players.get(this.localId);
          if (self) this.local.reconcile(self, snapshot.ackSeq);
        },
        onEvents: (payload) => {
          if (!this.local) return;
          for (const event of payload.events) this.handleEvent(event);
        },
        onRoster: (payload) => {
          if (!this.entities) return;
          this.identities.clear();
          for (const id of payload.players) this.identities.set(id.id, id);
          this.entities.setIdentities(payload.players);
          this.scores = payload.scores;
        },
        onError: (payload) => {
          this.ui.toast(payload.message);
          if (payload.fatal) {
            window.clearTimeout(timeout);
            reject(new Error(payload.message));
            this.ui.onLeaveMatch?.();
          }
        },
        onKicked: (payload) => {
          this.ui.toast(payload.reason);
          this.ui.onLeaveMatch?.();
        },
        onState: (state, detail) => {
          if (state === 'reconnecting') this.ui.toast(detail ? `Reconnecting (${detail})` : 'Reconnecting…');
        },
      });
      this.net.connect(options);
    });
  }

  private buildWorld(rapier: typeof RAPIER, welcome: WelcomePayload): void {
    this.localId = welcome.playerId;
    this.loadout = welcome.loadout.length > 0 ? welcome.loadout : [...DEFAULT_LOADOUT];
    this.input.loadoutSize = this.loadout.length;
    this.map = getMap(welcome.room.mapId);
    const spawn = this.map.spawnPoints[0]!;
    const spawnPos = { x: spawn.position[0], y: spawn.position[1], z: spawn.position[2] };

    this.physics = new ClientPhysicsWorld(rapier, this.map, spawnPos);
    this.mapBuilder = new MapMeshBuilder(this.map);
    this.renderer.scene.add(this.mapBuilder.build());
    this.renderer.applyEnvironment(this.map);

    this.entities = new EntityManager(this.map, (name) => this.mapBuilder.material(name));
    this.entities.registerPickups(this.mapBuilder.root);
    this.renderer.scene.add(this.entities.root);

    this.local = new LocalPlayer(this.physics, spawnPos);
    this.input.setAim(spawn.yaw, 0);
    this.weapon = new WeaponController(
      this.loadout[0]!,
      this.effects,
      this.audio,
      this.camera,
      this.input,
      this.renderer.camera,
    );
    this.renderer.viewModelScene.add(this.weapon.viewModel.root);

    this.sandbox = new SandboxController(rapier, this.map);
    this.renderer.scene.add(this.sandbox.root);
    this.sandboxPanel = new SandboxPanel(this.ui.hud.root, this.sandbox);
    this.sandboxPanel.onSpawnLook = () => this.spawnSandboxFromLook();
    this.sandboxPanel.onResetNpc = () => this.sandbox.resetNearest(this.cameraVec());
    this.sandboxPanel.onClearEffects = () => this.effects.clearParticles();
    this.sandboxPanel.onClearDecals = () => this.effects.clearDecals();
    this.sandboxPanel.onClearScene = () => {
      this.sandbox.removeAllNpcs();
      this.effects.clear();
    };
    this.sandboxPanel.onQuality = (q) => this.applySandboxQuality(q);
    this.effects.setSoftCap(this.sandbox.settings.maxEffects);
    this.sandbox.onChange(() => this.effects.setSoftCap(this.sandbox.settings.maxEffects));

    this.identities.clear();
    for (const id of welcome.players) this.identities.set(id.id, id);
    this.entities.setIdentities(welcome.players);
    this.scores = welcome.scores;

    for (const id of welcome.worldState.doorsOpen) {
      const index = this.map.doors.findIndex((d) => d.id === id);
      if (index >= 0) this.physics.setDoorProgress(index, 1);
    }
    for (const id of welcome.worldState.switchesOn) {
      this.renderer.setSwitchLights(id, true);
      this.mapBuilder.setSwitchOn(id, true);
    }
    for (const id of welcome.worldState.pickupsTaken) {
      this.entities.setPickupAvailable(id, false);
      this.mapBuilder.setPickupVisible(id, false);
    }

    if (this.pendingCreate) {
      this.net.createRoom({
        config: {
          name: this.pendingCreate.name,
          mapId: this.pendingCreate.mapId,
          maxPlayers: this.pendingCreate.maxPlayers,
          password: this.pendingCreate.password || undefined,
        },
      });
      this.pendingCreate = undefined;
    }

    this.ui.showGame();
    this.ui.hud.showToast(`${welcome.room.name} · ${this.map.name}`);
  }

  private onWelcomeLive(welcome: WelcomePayload): void {
    if (welcome.room.mapId !== this.map.id) {
      this.ui.toast('Map changed — rejoin from the menu.');
      this.ui.onLeaveMatch?.();
      return;
    }
    this.localId = welcome.playerId;
    this.loadout = welcome.loadout.length > 0 ? welcome.loadout : this.loadout;
    this.input.loadoutSize = this.loadout.length;
    this.interp.reset();
    this.identities.clear();
    for (const id of welcome.players) this.identities.set(id.id, id);
    this.entities.setIdentities(welcome.players);
  }

  private bindUi(): void {
    this.ui.hud.onResume = () => this.setPaused(false);
    this.ui.hud.onLeave = () => this.ui.onLeaveMatch?.();
    this.ui.hud.onSettings = () => {
      this.ui.menu.show('settings');
      this.ui.onLeaveMatch?.();
    };
    this.ui.hud.onChat = (text) => this.net.sendChat(text);
    this.ui.hud.onRespawn = () => this.net.sendRespawnRequest();
  }

  private bindSettings(): void {
    this.unsubs.push(
      settingsStore.events.on('graphicsChanged', (g) => {
        this.renderer.applySettings(g);
        this.camera.setBaseFov(g.fov);
        this.effects.applySettings(g);
      }),
    );
    this.unsubs.push(settingsStore.events.on('audioChanged', (a) => this.audio.applySettings(a)));
    this.unsubs.push(settingsStore.events.on('controlsChanged', (c) => this.input.updateControls(c)));
  }

  private readonly onResize = (): void => {
    this.renderer.resize();
    this.effects.setViewportHeight(this.canvas.clientHeight || window.innerHeight);
  };

  private readonly onCanvasClick = (event: MouseEvent): void => {
    if (!this.running || this.ui.hud.chatting) return;
    if (this.sandbox?.cursorMode) {
      this.notePointer(event);
      directionFromAngles(aimDir, this.input.yaw, this.input.pitch);
      this.sandbox.handlePrimary(this.cameraVec(), aimDir, this.renderer.camera);
      return;
    }
    if (this.paused) return;
    this.input.requestLock();
  };

  private readonly onPointerMove = (event: MouseEvent): void => {
    if (!this.sandbox?.cursorMode) return;
    this.notePointer(event);
  };

  private notePointer(event: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.sandbox.setPointerNdc(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
  }

  private cameraVec(): Vec3 {
    const p = this.renderer.camera.position;
    return { x: p.x, y: p.y, z: p.z };
  }

  private spawnSandboxFromLook(): void {
    directionFromAngles(aimDir, this.input.yaw, this.input.pitch);
    this.sandbox.spawnAtLookOrFront(this.cameraVec(), aimDir);
  }

  private applySandboxQuality(quality: SandboxQuality): void {
    const level =
      quality === 'low' ? QualityLevel.Low : quality === 'high' ? QualityLevel.High : QualityLevel.Medium;
    this.effects.applySettings({
      ...settingsStore.graphics,
      particles: level,
      effects: level,
    });
    this.effects.setSoftCap(this.sandbox.settings.maxEffects);
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.ui.hud.setPaused(paused);
    if (!paused) this.input.requestLock();
    else this.input.releaseLock();
  }

  private frame(now: number): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dtMs = Math.min(100, now - this.previousNow);
    this.previousNow = now;
    const dt = dtMs / 1000;
    this.frames += 1;
    this.fpsAccum += dt;
    if (this.fpsAccum >= 0.4) {
      this.fps = this.frames / this.fpsAccum;
      this.frames = 0;
      this.fpsAccum = 0;
    }

    if (this.input.consumeEdge('sandbox') && !this.paused) {
      const cursor = this.sandbox.toggleCursorMode();
      if (cursor) this.input.releaseLock();
      else this.input.requestLock();
    }
    if (this.input.consumeEdge('debug')) {
      settingsStore.patchGraphics({ debugOverlay: !settingsStore.graphics.debugOverlay });
    }
    if (this.input.consumeEdge('chat') && !this.paused) {
      this.input.releaseLock();
      this.ui.hud.openChat();
    }

    const predicted = this.local.update(dtMs, () => this.input.sample(), this.input.yaw, this.input.pitch, commands);
    if (commands.length > 0) {
      this.net.sendInput({
        ackSnapshotTick: this.net.ackTick,
        commands: commands.slice(-MAX_INPUTS_PER_PACKET),
      });
    }

    const sample = commands.length > 0 ? commands[commands.length - 1]! : this.input.sample();
    if (sample.weaponSlot !== this.lastSlot) {
      this.lastSlot = sample.weaponSlot;
      const id = this.loadout[sample.weaponSlot] ?? this.loadout[0]!;
      this.weapon.equip(id, now);
    }
    if (this.local.weaponId !== this.weapon.weaponId) {
      this.weapon.equip(this.local.weaponId, now);
    }
    this.weapon.syncFromServer(this.local.ammoInMag, this.local.ammoReserve, now);

    this.feetPos.set(predicted.position.x, predicted.position.y, predicted.position.z);
    this.camera.update(
      dt,
      this.feetPos,
      this.input.yaw,
      this.input.pitch,
      predicted.crouching,
      predicted.grounded,
      predicted.speed / SPEED_WALK,
      predicted.strafe,
    );
    this.weapon.viewModel.addAimDelta(this.input.yaw - this.lastYaw, this.input.pitch - this.lastPitch);
    this.lastYaw = this.input.yaw;
    this.lastPitch = this.input.pitch;

    directionFromAngles(aimDir, this.input.yaw, this.input.pitch);
    this.weapon.blockFire = this.sandbox.interceptsFire;
    const fireEdge = buttonPressed(sample.buttons, this.lastButtons, Button.Fire);

    this.weapon.update(dt, {
      buttons: sample.buttons,
      previousButtons: this.lastButtons,
      nowMs: now,
      speedRatio: predicted.speed / SPEED_WALK,
      grounded: predicted.grounded,
      crouching: predicted.crouching,
      alive: this.local.alive,
      carrying: this.local.carrying,
      cameraPosition: this.renderer.camera.position,
    });
    this.lastButtons = sample.buttons;

    if (fireEdge && this.sandbox.interceptsFire) {
      this.sandbox.handlePrimary(this.cameraVec(), aimDir, this.renderer.camera);
    }

    if (this.weapon.didFire) {
      this.spawnPredictedTracer();
      this.sandbox.tryShot(muzzlePos, muzzleDir, this.weapon.definition.range);
    }

    if (this.local.footstepThisFrame) {
      const surface = this.physics.querySurfaceBelow(predicted.position);
      this.audio.play(footstepSound(surface), { volume: 0.68, variation: 0.06 });
      this.effects.footstepDust(predicted.position, surface);
    }
    if (this.local.jumpedThisFrame) this.audio.play('jump', { volume: 0.45, variation: 0.05 });
    if (this.local.landedThisFrame) {
      this.audio.play('land', { volume: clamp(this.local.landingSpeed / 16, 0.25, 1), variation: 0.04 });
      this.camera.onLanded(this.local.landingSpeed);
    }

    if (!this.local.alive) {
      if (this.input.isActionHeld('jump') && this.net.serverNowMs() >= this.respawnAt) {
        this.net.sendRespawnRequest();
      }
    } else {
      this.ui.hud.hideDeath();
    }

    this.interp.sample(now, this.localId);
    this.syncPhysicsFromInterp();
    this.entities.update(this.interp, dt, now, this.renderer.camera.position);
    this.playRemoteFootsteps(dt);
    MapMeshBuilder.animatePickups(this.mapBuilder.root, now / 1000);

    if (!this.paused) {
      this.sandbox.update({
        dt,
        camera: this.renderer.camera,
        playerPos: predicted.position,
        crouching: predicted.crouching,
        interp: this.interp,
        locked: this.input.isLocked,
        cursorMode: this.sandbox.cursorMode,
        aimDir,
      });
      this.sandboxPanel.tick();
    }

    this.effects.update(dt, now);
    this.renderer.updateShadowFocus(predicted.position.x, predicted.position.z);

    this.renderer.camera.getWorldDirection(tmpVec);
    listenerFwd.x = tmpVec.x;
    listenerFwd.y = tmpVec.y;
    listenerFwd.z = tmpVec.z;
    this.audio.updateListener(this.renderer.camera.position, listenerFwd, listenerUp, dt);

    this.renderer.render();
    this.updateHud(dt, predicted.speed / SPEED_WALK, !predicted.grounded, predicted.crouching);
  }

  private spawnPredictedTracer(): void {
    this.weapon.muzzleWorld(muzzlePos);
    this.weapon.muzzleDirection(muzzleDir);
    const def = this.weapon.definition;
    const hit = this.physics.castRay(muzzlePos, muzzleDir, def.range, BULLET_FILTER_GROUPS);
    this.effects.tracer(muzzlePos, muzzleDir, hit ?? def.range, def, this.renderer.camera.position);
  }

  private syncPhysicsFromInterp(): void {
    for (const [id, prop] of this.interp.props) {
      this.physics.setPropTransform(id, prop.position, prop.rotation);
      this.physics.setPropActive(id, true);
    }
    for (const id of this.physics.propIds()) {
      if (!this.interp.livePropIds.has(id)) this.physics.setPropActive(id, false);
    }
    for (let i = 0; i < this.physics.doorCount(); i++) {
      this.physics.setDoorProgress(i, this.interp.doors[i] ?? 0);
    }
  }

  private playRemoteFootsteps(dt: number): void {
    for (const [id, state] of this.interp.players) {
      const speed = Math.hypot(state.velocity.x, state.velocity.z);
      const grounded = (state.flags & PlayerFlag.Grounded) !== 0;
      if (!grounded || speed < 1.6 || (state.flags & PlayerFlag.Dead) !== 0) continue;
      const acc = (this.remoteStep.get(id) ?? 0) + speed * dt;
      if (acc > 1.55) {
        this.audio.playAt(
          footstepSound(this.physics.querySurfaceBelow(state.position)),
          state.position,
          0.78,
          42,
          0.06,
        );
        this.remoteStep.set(id, 0);
      } else {
        this.remoteStep.set(id, acc);
      }
    }
  }

  private handleEvent(event: GameEvent): void {
    const local = eventHasPlayer(event) && eventPlayer(event) === this.localId;
    switch (event.t) {
      case 'shot': {
        const def = getWeapon(event.w);
        if (!local) {
          this.audio.playAt(def.audio.fire as SoundKey, vec(event.o), 0.9, def.audio.maxDistance, 0.05);
          this.entities.avatar(event.p)?.flashMuzzle(performance.now());
          for (let i = 0; i < event.d.length; i++) {
            this.effects.tracer(vec(event.o), vec(event.d[i]!), event.l[i] ?? def.range, def, this.renderer.camera.position);
          }
        }
        break;
      }
      case 'impact':
        this.effects.bulletImpact(vec(event.pos), vec(event.n), event.s, event.f, performance.now());
        this.audio.playAt(impactSound(event.s), vec(event.pos), 0.7, 60, 0.08);
        break;
      case 'hit':
        this.ui.hud.showHit(event.head);
        this.audio.play(event.head ? 'headshot' : 'hitmarker', { bus: 'ui', volume: 0.7 });
        break;
      case 'blood':
        this.effects.bloodEffect(vec(event.pos), vec(event.n), performance.now());
        this.audio.playAt('impact_flesh', vec(event.pos), 0.65, 40, 0.06);
        break;
      case 'damaged': {
        this.audio.play('hurt', { volume: 0.7 });
        this.camera.addShake(0.18);
        directionFromAngles(aimDir, this.input.yaw, 0);
        const dx = event.from[0] - this.local.renderPosition.x;
        const dz = event.from[2] - this.local.renderPosition.z;
        const ang = Math.atan2(dx, dz) - this.input.yaw;
        this.ui.hud.showHurt(ang);
        break;
      }
      case 'kill': {
        const killer = event.killer === null ? 'world' : this.identities.get(event.killer)?.username ?? `#${event.killer}`;
        const victim = this.identities.get(event.victim)?.username ?? `#${event.victim}`;
        this.ui.hud.addKill(killer, victim, event.w, event.head);
        this.audio.playUi('killfeed', 0.5);
        break;
      }
      case 'death':
        if (event.victim === this.localId) {
          this.respawnAt = event.respawnAt;
          this.audio.play('death', { volume: 0.8 });
          this.ui.hud.showDeath(event.respawnAt, this.net.serverNowMs());
        }
        break;
      case 'respawn':
        if (event.p === this.localId) {
          this.local.teleport(vec(event.pos));
          this.input.setAim(event.yaw, 0);
          this.input.resetToggles();
          this.camera.reset();
          this.weapon.equip(this.loadout[0]!, performance.now());
          this.ui.hud.hideDeath();
        }
        break;
      case 'reload':
        if (event.p === this.localId) this.weapon.onServerReload(event.ms, performance.now());
        else this.audio.playAt(getWeapon(event.w).audio.reload as SoundKey, this.playerPos(event.p), 0.45, 30);
        break;
      case 'explosion':
        this.effects.explosion(vec(event.pos), event.radius, performance.now());
        this.audio.playAt('explosion', vec(event.pos), 1, 140, 0.04);
        this.camera.addShake(clamp(1.2 - this.local.distanceTo(vec(event.pos)) / 40, 0, 1.1), 28);
        break;
      case 'propBreak':
        this.effects.propBreak(vec(event.pos), event.kind as never, performance.now());
        this.audio.playAt('prop_break', vec(event.pos), 0.8, 50);
        break;
      case 'door':
        this.audio.playAt('door', this.doorPos(event.id), 0.55, 40);
        break;
      case 'switch':
        this.renderer.setSwitchLights(event.id, event.on);
        this.mapBuilder.setSwitchOn(event.id, event.on);
        this.audio.playAt('switch', this.switchPos(event.id), 0.5, 25);
        break;
      case 'pickup':
        this.entities.setPickupAvailable(event.id, false);
        this.mapBuilder.setPickupVisible(event.id, false);
        if (event.p === this.localId) this.audio.play('pickup', { volume: 0.6 });
        break;
      case 'pickupRespawn':
        this.entities.setPickupAvailable(event.id, true);
        this.mapBuilder.setPickupVisible(event.id, true);
        break;
      case 'jump':
        if (!local) this.audio.playAt('jump', vec(event.pos), 0.4, 30);
        break;
      case 'land':
        if (!local) this.audio.playAt('land', vec(event.pos), clamp(event.v / 16, 0.2, 1), 40);
        break;
      case 'chat':
        this.ui.hud.addChat(event.name, event.msg);
        break;
      case 'join':
        this.ui.hud.showToast(`${event.name} joined`);
        break;
      case 'leave':
        this.ui.hud.showToast(`${event.name} left`);
        break;
      default:
        break;
    }
  }

  private updateHud(dt: number, speedRatio: number, airborne: boolean, crouching: boolean): void {
    const def = this.weapon.definition;
    this.ui.hud.setHealth(this.local.health, MAX_HEALTH);
    this.ui.hud.setAmmo(this.weapon.ammoInMag, this.weapon.ammoReserve, def.magazineSize);
    this.ui.hud.setWeapon(def.name);
    this.ui.hud.setSpread(
      this.weapon.spreadRadians({
        moving: speedRatio > 0.15,
        speedRatio,
        airborne,
        crouching,
      }),
    );
    this.ui.hud.setNet(
      this.fps,
      this.net.rttMs,
      settingsStore.graphics.showFps,
      settingsStore.graphics.showPing,
    );
    this.ui.hud.setInteract(this.interactPrompt());
    this.ui.hud.setScoreboard(this.scoreRows(), this.input.isActionHeld('scoreboard') && !this.ui.hud.chatting);
    this.ui.hud.setDebug(
      `tick ack ${this.net.ackTick}\n` +
        `rtt ${this.net.rttMs.toFixed(0)} ms\n` +
        `draws ${this.renderer.drawCalls}  tris ${this.renderer.triangles}\n` +
        `particles ${this.effects.particleCount}\n` +
        `corr ${this.local.correctionCount}  err ${this.local.lastError.toFixed(3)}\n` +
        `pos ${this.local.renderPosition.x.toFixed(1)} ${this.local.renderPosition.y.toFixed(1)} ${this.local.renderPosition.z.toFixed(1)}`,
      settingsStore.graphics.debugOverlay,
    );
    this.ui.hud.update(dt, this.net.serverNowMs());
  }

  private scoreRows() {
    return this.scores.map((s) => ({
      id: s.id,
      name: this.identities.get(s.id)?.username ?? `Player ${s.id}`,
      kills: s.kills,
      deaths: s.deaths,
      ping: s.pingMs,
      self: s.id === this.localId,
    }));
  }

  private interactPrompt(): string | null {
    if (!this.local.alive) return null;
    if (this.local.carrying) return 'LMB throw  ·  G drop  ·  E drop';
    const origin = {
      x: this.local.renderPosition.x,
      y: this.local.renderPosition.y + EYE_HEIGHT_STAND,
      z: this.local.renderPosition.z,
    };
    directionFromAngles(aimDir, this.input.yaw, this.input.pitch);
    for (const sw of this.map.switches) {
      if (inFront(origin, aimDir, vec(sw.position), INTERACT_RANGE)) return 'E  flip switch';
    }
    for (const door of this.map.doors) {
      if (inFront(origin, aimDir, vec(door.position), INTERACT_RANGE + 0.6)) return 'E  door';
    }
    for (const [id, prop] of this.interp.props) {
      const def = this.physics.propDef(id);
      if (!def || !getArchetype(def.kind).carryable) continue;
      if (inFront(origin, aimDir, prop.position, INTERACT_RANGE)) return 'E  pick up';
    }
    return null;
  }

  private playerPos(id: number): Vec3 {
    const remote = this.interp.players.get(id);
    if (remote) return remote.position;
    return this.local.renderPosition;
  }

  private doorPos(id: string): Vec3 {
    const def = this.map.doors.find((d) => d.id === id);
    return def ? vec(def.position) : this.local.renderPosition;
  }

  private switchPos(id: string): Vec3 {
    const def = this.map.switches.find((d) => d.id === id);
    return def ? vec(def.position) : this.local.renderPosition;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.canvas.removeEventListener('click', this.onCanvasClick);
    this.canvas.removeEventListener('mousemove', this.onPointerMove);
    for (const off of this.unsubs) off();
    this.input?.detach();
    this.input?.releaseLock();
    this.net?.disconnect();
    this.weapon?.dispose();
    this.entities?.dispose();
    this.sandbox?.dispose();
    this.sandboxPanel?.root.remove();
    this.effects?.dispose();
    this.mapBuilder?.dispose();
    this.physics?.dispose();
    this.audio?.dispose();
    this.renderer?.dispose();
  }
}

function vec(v: [number, number, number] | Vec3): Vec3 {
  if (Array.isArray(v)) return { x: v[0], y: v[1], z: v[2] };
  return v;
}

function inFront(origin: Vec3, dir: Vec3, target: Vec3, range: number): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist > range || dist < 0.01) return false;
  return (dx * dir.x + dy * dir.y + dz * dir.z) / dist > 0.72;
}

function eventHasPlayer(event: GameEvent): boolean {
  return 'p' in event || event.t === 'death' || event.t === 'kill' || event.t === 'hit';
}

function eventPlayer(event: GameEvent): number | null {
  if ('p' in event && typeof (event as { p?: number }).p === 'number') return (event as { p: number }).p;
  return null;
}
