import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import {
  BULLET_FILTER_GROUPS,
  Button,
  DEFAULT_LOADOUT,
  DEFAULT_MAP_ID,
  EYE_HEIGHT_STAND,
  INTERACT_RANGE,
  MAX_HEALTH,
  MAX_INPUTS_PER_PACKET,
  PROTOCOL_VERSION,
  PlayerFlag,
  RoomPhase,
  SPEED_WALK,
  buttonPressed,
  clamp,
  directionFromAngles,
  getArchetype,
  getMap,
  getWeapon,
  type GameEvent,
  type InputCommand,
  type LobbyStatePayload,
  type MapDefinition,
  type PlayerIdentity,
  type PlayerScore,
  type RoomPhaseId,
  type Vec3,
  type WeaponId,
  type WelcomePayload,
  animationStateFor,
  isMapId,
  isWeaponId,
} from '@ragelab/shared';
import { GameRenderer } from '../renderer/renderer';
import { ClientPhysicsWorld } from '../physics/clientWorld';
import { MapMeshBuilder } from '../maps/mapMeshBuilder';
import { MapDecor } from '../maps/mapDecor';
import { pickMapSpawn, pickTeamSpawn } from '../maps/spawnLayout';
import { LocalPlayer } from '../player/localPlayer';
import { LocalCharacter, clipFromAnimation } from '../player/localCharacter';
import { InputController, TOOL_GUN_UI_SLOT } from '../player/inputController';
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
import { SpawnMenu } from '../ui/spawnMenu';
import { SandboxController } from '../sandbox/sandboxController';
import { NPC_MENU_ENABLED } from '../sandbox/spawnCatalog';
import { ToolGunView } from '../sandbox/toolGunView';
import { resolveJoinWsUrl } from '../supabase/client';
import { assetManager } from '../assets/assetManager';
import { preloadWeaponModels, createWeaponVisual } from '../weapons/weaponAssets';

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
  roomCode?: string;
  mapId?: string;
  password?: string;
  wsUrl?: string;
  offline?: boolean;
  team?: number;
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
  private mapDecor: MapDecor | null = null;
  private local!: LocalPlayer;
  private input!: InputController;
  private camera!: CameraRig;
  private net: NetClient | null = null;
  private interp!: SnapshotInterpolator;
  private entities!: EntityManager;
  private effects!: EffectsManager;
  private audio!: AudioEngine;
  private weapon!: WeaponController;
  private sandbox!: SandboxController;
  private spawnMenu!: SpawnMenu;
  private toolGunView!: ToolGunView;
  private localCharacter: LocalCharacter | null = null;

  private localId = 0;
  private loadout: Array<WeaponId | null> = [...DEFAULT_LOADOUT];
  private identities = new Map<number, PlayerIdentity>();
  private scores: PlayerScore[] = [];
  private lastButtons = 0;
  private lastUiSlot = 0;
  private wheelIgnoreHold = false;
  private lastYaw = 0;
  private lastPitch = 0;
  private respawnAt = 0;
  private previousNow = 0;
  private raf = 0;
  private fps = 60;
  private frames = 0;
  private fpsAccum = 0;
  private paused = false;
  private lobbyHold = false;
  private offline = false;
  private lobbyStarting = false;
  private roomPhase: RoomPhaseId = RoomPhase.Playing;
  private joinCode = '';
  private roomName = '';
  private hostPlayerId: number | null = null;
  private localTeam = 0;
  private isHost = false;
  private maxPlayers = 16;
  private running = false;
  private disposed = false;
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
    this.audio.warmCombatBuffers();
    await preloadWeaponModels();

    this.renderer = new GameRenderer(this.canvas, settingsStore.graphics);
    this.effects = new EffectsManager(settingsStore.graphics);
    this.renderer.scene.add(this.effects.root);
    this.camera = new CameraRig(this.renderer.camera, this.renderer.viewModelCamera, settingsStore.graphics.fov);
    this.input = new InputController(this.canvas, settingsStore.controls);
    this.input.attach();
    this.interp = new SnapshotInterpolator();
    assetManager.setErrorHandler((_url, message) => this.ui.toast(`NPC model: ${message}`));

    this.offline = Boolean(start.offline);
    const welcome = this.offline
      ? this.offlineWelcome(start)
      : await this.connect({
          url: resolveJoinWsUrl(start.wsUrl),
          token: start.token,
          username: start.username,
          roomId: start.roomId,
          roomCode: start.roomCode,
          password: start.password,
          mapId: start.mapId,
          team: start.team,
          create: start.create
            ? {
                name: start.create.name,
                mapId: start.create.mapId,
                maxPlayers: start.create.maxPlayers,
                password: start.create.password || undefined,
              }
            : undefined,
        });

    this.buildWorld(rapier, welcome);
    await this.mapDecor?.load();
    this.warmCombatPipeline();
    this.bindUi();
    this.bindSettings();
    this.onResize();
    this.running = true;
    this.previousNow = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
    window.addEventListener('resize', this.onResize);
    this.canvas.addEventListener('click', this.onCanvasClick);
    this.canvas.addEventListener('mousemove', this.onPointerMove);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  private connect(options: ConnectOptions): Promise<WelcomePayload> {
    this.net = new NetClient();
    const net = this.net;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('Не удалось подключиться к игровому серверу.')),
        25_000,
      );
      net.setHandlers({
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
        onLobbyState: (payload) => {
          this.applyLobbyState(payload);
        },
        onRoster: (payload) => {
          if (!this.entities) return;
          this.identities.clear();
          for (const id of payload.players) this.identities.set(id.id, id);
          this.entities.setIdentities(payload.players);
          this.scores = payload.scores;
          const self = payload.players.find((p) => p.id === this.localId);
          if (self) this.localCharacter?.setIdentity(self);
          if (payload.phase) this.roomPhase = payload.phase;
          if (payload.joinCode) this.joinCode = payload.joinCode;
          if (payload.hostPlayerId !== undefined) this.hostPlayerId = payload.hostPlayerId;
          this.syncLobbyWait();
        },
        onError: (payload) => {
          this.lobbyStarting = false;
          this.syncLobbyWait();
          this.ui.toast(payload.message);
          if (payload.fatal) {
            window.clearTimeout(timeout);
            reject(new Error(payload.message));
            this.ui.onLeaveMatch?.();
          }
        },
        onKicked: (payload) => {
          window.clearTimeout(timeout);
          const reason = payload.reason || 'Host left — session ended';
          this.ui.toast(reason);
          if (!this.local) {
            reject(new Error(reason));
            return;
          }
          this.ui.onLeaveMatch?.();
        },
        onState: (state, detail) => {
          if (state === 'reconnecting') this.ui.toast(detail ? `Reconnecting (${detail})` : 'Reconnecting…');
        },
      });
      net.connect(options);
    });
  }

  /**
   * Pre-upload weapon meshes / FX / audio so the first pistol shot and the first
   * rifle (slot 3) burst do not hitch on GLB parse, shader compile or buffer build.
   */
  private warmCombatPipeline(): void {
    const origin = { x: 0, y: -200, z: 0 };
    const forward = { x: 0, y: 0, z: -1 };
    const cam = this.renderer.camera.position;

    const staging = new THREE.Group();
    staging.visible = false;
    this.renderer.viewModelScene.add(staging);
    for (const id of this.loadout) {
      if (!id || !isWeaponId(id)) continue;
      const length = Math.max(getWeapon(id).visual.size[2], 0.2);
      const visual = createWeaponVisual(id, length, { lod: false, shadows: false });
      if (visual) staging.add(visual);
    }

    this.renderer.viewModelScene.updateMatrixWorld(true);
    this.renderer.scene.updateMatrixWorld(true);
    this.renderer.renderer.compile(this.renderer.scene, this.renderer.camera);
    this.renderer.renderer.compile(this.renderer.viewModelScene, this.renderer.viewModelCamera);

    for (const id of this.loadout) {
      if (!id || !isWeaponId(id)) continue;
      const def = getWeapon(id);
      this.effects.muzzleFlash(origin, forward, def);
      this.effects.tracer(origin, forward, 12, def, cam);
      this.effects.shellEject(origin, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
      this.audio.play(def.audio.fire as SoundKey, { volume: 0 });
    }
    this.effects.clear();

    staging.removeFromParent();
    staging.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) mat.dispose();
    });
  }

  private buildWorld(rapier: typeof RAPIER, welcome: WelcomePayload): void {
    this.localId = welcome.playerId;
    this.loadout = welcome.loadout.length > 0 ? welcome.loadout : [...DEFAULT_LOADOUT];
    this.input.loadoutSize = this.loadout.length;
    this.map = getMap(welcome.room.mapId);
    this.localTeam = welcome.players.find((p) => p.id === welcome.playerId)?.team ?? 0;
    const spawn = pickTeamSpawn(this.map, this.localTeam) ?? pickMapSpawn(this.map, 'player')!;
    const spawnPos = { x: spawn.position[0], y: spawn.position[1], z: spawn.position[2] };

    this.physics = new ClientPhysicsWorld(rapier, this.map, spawnPos);
    this.mapBuilder = new MapMeshBuilder(this.map);
    this.renderer.scene.add(this.mapBuilder.build());
    this.mapDecor?.dispose();
    this.mapDecor = new MapDecor(this.map);
    this.renderer.scene.add(this.mapDecor.root);
    void this.mapDecor.load();
    this.renderer.applyEnvironment(this.map);

    this.entities = new EntityManager(this.map, (name) => this.mapBuilder.material(name));
    this.entities.registerPickups(this.mapBuilder.root);
    this.renderer.scene.add(this.entities.root);

    this.local = new LocalPlayer(this.physics, spawnPos);
    this.input.setAim(spawn.yaw, 0);
      this.weapon = new WeaponController(
      this.loadout[0] ?? DEFAULT_LOADOUT[0]!,
      this.effects,
      this.audio,
      this.camera,
      this.input,
      this.renderer.camera,
    );
    this.renderer.viewModelScene.add(this.weapon.viewModel.root);

    this.sandbox = new SandboxController(rapier, this.map);
    this.renderer.scene.add(this.sandbox.root);
    this.sandbox.onImpact = (x, y, z, nx, ny, nz, speed) => {
      this.effects.physicsImpact({ x, y, z }, { x: nx, y: ny, z: nz }, speed);
    };
    this.sandbox.onNpcHit = (x, y, z, nx, ny, nz, zone, killed, attach) => {
      this.effects.npcHitEffect({ x, y, z }, { x: nx, y: ny, z: nz }, performance.now(), zone, killed, attach);
      this.audio.playAt('impact_flesh', { x, y, z }, killed || zone === 'head' ? 0.85 : 0.55, 36, 0.05);
    };
    this.sandbox.onBloodContact = (x, y, z, nx, ny, nz) => {
      this.effects.bloodSmear({ x, y, z }, { x: nx, y: ny, z: nz }, performance.now());
    };
    this.localCharacter?.dispose();
    this.localCharacter = new LocalCharacter(this.identities.get(this.localId) ?? welcome.players.find((p) => p.id === welcome.playerId));
    this.renderer.scene.add(this.localCharacter.root);
    this.effects.setSoftCap(this.sandbox.settings.maxEffects);
    this.sandbox.onChange(() => this.effects.setSoftCap(this.sandbox.settings.maxEffects));

    this.toolGunView = new ToolGunView();
    this.renderer.viewModelScene.add(this.toolGunView.root);
    this.spawnMenu = new SpawnMenu(this.ui.hud.root);
    this.spawnMenu.onSelect = (entry) => this.sandbox.setSelection(entry);
    this.spawnMenu.onClose = () => this.closeSpawnMenu();
    this.spawnMenu.onClearScene = () => {
      this.sandbox.removeAllNpcs();
      this.sandbox.removeAllWeapons();
      this.sandbox.removeAllProps();
      this.effects.clear();
      this.ui.hud.showToast('Scene cleared');
    };
    this.sandbox.setSelection(this.spawnMenu.selected);
    this.ui.hud.setLoadout(this.loadoutRows());
    this.ui.hud.setActiveSlot(this.input.uiSlot);

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

    this.joinCode = welcome.room.joinCode ?? '';
    this.roomName = welcome.room.name;
    this.maxPlayers = welcome.room.maxPlayers;
    this.isHost = Boolean(welcome.room.host);
    this.hostPlayerId = welcome.players.find((p) => welcome.room.host && p.id === welcome.playerId)?.id ?? (welcome.room.host ? welcome.playerId : null);
    this.applyRoomPhase(welcome.room.phase ?? RoomPhase.Playing);
    this.ui.hud.setLobbyInvite(welcome.room.joinCode ?? null, welcome.room.wsUrl);
  }

  private offlineWelcome(start: SessionStart): WelcomePayload {
    const mapId = isMapId(start.mapId) ? start.mapId! : DEFAULT_MAP_ID;
    const username = start.username || 'Operator';
    return {
      protocol: PROTOCOL_VERSION,
      playerId: 1,
      profile: null,
      room: {
        id: 'offline',
        name: 'Offline',
        mapId,
        mode: 'sandbox',
        maxPlayers: 1,
        host: true,
        phase: RoomPhase.Playing,
      },
      tickRate: 60,
      snapshotRate: 20,
      serverTimeMs: 0,
      players: [
        {
          id: 1,
          profileId: null,
          username,
          avatarUrl: null,
          isGuest: true,
          team: start.team === 2 ? 2 : start.team === 1 ? 1 : 0,
        },
      ],
      scores: [{ id: 1, kills: 0, deaths: 0, score: 0, pingMs: 0 }],
      loadout: [...DEFAULT_LOADOUT],
      worldState: { doorsOpen: [], switchesOn: [], pickupsTaken: [] },
    };
  }

  requestStartMatch(): void {
    if (this.offline || !this.net) return;
    if (!this.isHost || this.roomPhase !== RoomPhase.Lobby) return;
    this.lobbyStarting = true;
    this.syncLobbyWait();
    this.net.startMatch();
  }

  private applyLobbyState(payload: LobbyStatePayload): void {
    this.joinCode = payload.joinCode;
    this.roomName = payload.name;
    this.maxPlayers = payload.maxPlayers;
    this.hostPlayerId = payload.hostPlayerId;
    this.isHost = payload.hostPlayerId === this.localId;
    this.identities.clear();
    for (const id of payload.players) this.identities.set(id.id, id);
    this.entities?.setIdentities(payload.players);
    this.applyRoomPhase(payload.phase);
  }

  private applyRoomPhase(phase: RoomPhaseId): void {
    this.roomPhase = phase;
    if (phase === RoomPhase.Lobby) {
      this.lobbyHold = true;
      this.input?.releaseLock();
      this.ui.showLobbyWait(this.lobbyView());
      return;
    }
    this.lobbyHold = false;
    this.lobbyStarting = false;
    this.ui.hideLobbyWait();
    this.ui.showGame();
    if (this.offline) {
      this.ui.hud.showToast('Офлайн игра');
      return;
    }
    if (this.joinCode) {
      this.ui.hud.showToast(`Лобби ${this.joinCode}`);
    } else {
      this.ui.hud.showToast(`${this.roomName || this.map.name}`);
    }
  }

  private syncLobbyWait(): void {
    if (!this.lobbyHold || this.roomPhase !== RoomPhase.Lobby) return;
    this.ui.showLobbyWait(this.lobbyView());
  }

  private lobbyView() {
    return {
      code: this.joinCode,
      name: this.roomName || this.map?.name || 'Lobby',
      mapId: this.map?.id ?? '',
      isHost: this.isHost,
      isAdmin: this.ui.menu.isAdmin,
      starting: this.lobbyStarting,
      players: [...this.identities.values()],
      hostPlayerId: this.hostPlayerId,
      localPlayerId: this.localId,
      maxPlayers: this.maxPlayers,
    };
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
    this.ui.hud.setLoadout(this.loadoutRows());
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
    this.ui.hud.onChat = (text) => this.net?.sendChat(text);
    this.ui.hud.onRespawn = () => {
      if (this.offline) this.offlineRespawn();
      else this.net?.sendRespawnRequest();
    };
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
    if (this.sandbox?.menuOpen) return;
    if (this.sandbox?.cursorMode) {
      this.notePointer(event);
      directionFromAngles(aimDir, this.input.yaw, this.input.pitch);
      this.sandbox.handlePrimary(this.cameraVec(), aimDir, this.renderer.camera);
      return;
    }
    if (this.paused) return;
    this.input.requestLock();
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (!this.sandbox?.toolGunActive) return;
    event.preventDefault();
    if (!this.running || this.paused || this.ui.hud.chatting) return;
    if (this.spawnMenu.isOpen) return;
    this.openSpawnMenu();
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

  private openSpawnMenu(): void {
    if (!this.sandbox.toolGunActive || this.spawnMenu.isOpen) return;
    if (this.input.weaponWheelOpen) {
      this.input.closeWeaponWheel();
      this.ui.hud.cancelWeaponWheel();
    }
    this.spawnMenu.open();
    this.sandbox.setMenuOpen(true);
    this.input.freezeSlots = true;
    this.input.releaseLock();
  }

  private closeSpawnMenu(): void {
    this.spawnMenu?.close();
    this.sandbox?.setMenuOpen(false);
    if (this.input) this.input.freezeSlots = false;
    if (!this.paused && !this.sandbox?.cursorMode && this.running) this.input.requestLock();
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.ui.hud.setPaused(paused);
    if (paused) {
      this.spawnMenu?.close();
      this.sandbox?.setMenuOpen(false);
      if (this.input) {
        this.input.freezeSlots = false;
        this.input.closeWeaponWheel();
      }
      this.input.releaseLock();
    } else {
      this.input.requestLock();
    }
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

    if (this.lobbyHold) {
      this.renderer?.render();
      return;
    }

    if (this.input.consumeEdge('sandbox') && !this.paused) {
      if (this.spawnMenu?.isOpen) this.closeSpawnMenu();
      const cursor = this.sandbox.toggleCursorMode();
      if (cursor) this.input.releaseLock();
      else this.input.requestLock();
    }
    if (this.input.consumeEdge('menu') && !this.ui.hud.chatting) {
      if (this.ui.hud.weaponWheelOpen) {
        this.input.closeWeaponWheel();
        this.ui.hud.cancelWeaponWheel();
        this.wheelIgnoreHold = true;
      } else if (this.spawnMenu?.isOpen) this.closeSpawnMenu();
      else this.setPaused(!this.paused);
    }
    if (this.input.consumeEdge('debug')) {
      settingsStore.patchGraphics({ debugOverlay: !settingsStore.graphics.debugOverlay });
    }
    if (this.input.consumeEdge('chat') && !this.paused) {
      this.input.releaseLock();
      this.ui.hud.openChat();
    }

    if (!this.input.isActionHeld('weaponWheel')) this.wheelIgnoreHold = false;
    const canWheel =
      !this.paused &&
      this.local.alive &&
      !this.ui.hud.chatting &&
      !this.spawnMenu?.isOpen &&
      !this.sandbox.cursorMode &&
      !this.wheelIgnoreHold;
    const wantWheel = canWheel && this.input.isActionHeld('weaponWheel');
    if (wantWheel && !this.input.weaponWheelOpen) {
      this.input.openWeaponWheel();
      this.ui.hud.openWeaponWheel(this.input.uiSlot);
    } else if (this.input.weaponWheelOpen && !wantWheel) {
      const slot = this.ui.hud.closeWeaponWheel(true);
      this.input.closeWeaponWheel();
      if (slot >= 0) this.input.selectUiSlot(slot);
    } else if (this.input.weaponWheelOpen) {
      this.ui.hud.updateWeaponWheel(this.input.wheelCursorX, this.input.wheelCursorY, this.input.uiSlot);
    }

    const predicted = this.local.update(dtMs, () => this.input.sample(), this.input.yaw, this.input.pitch, commands);
    const latest = commands.length > 0 ? commands[commands.length - 1]! : null;
    const localButtons = latest ? latest.buttons : this.lastButtons;
    if (this.input.toolGunEquipped || this.sandbox.menuOpen || !this.loadout[this.input.firearmSlot]) {
      for (const command of commands) {
        command.buttons &= ~(Button.Fire | Button.Aim);
        command.weaponSlot = this.input.firearmSlot;
      }
    }
    if (commands.length > 0 && this.net) {
      this.net.sendInput({
        ackSnapshotTick: this.net.ackTick,
        commands: commands.slice(-MAX_INPUTS_PER_PACKET),
      });
    }

    if (this.input.uiSlot !== this.lastUiSlot) {
      this.applyUiSlot(this.input.uiSlot, now);
    }
    this.syncHeldWeapon(now);
    if (!this.offline) {
      this.weapon.syncFromServer(this.local.ammoInMag, this.local.ammoReserve, now);
    }

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
    this.toolGunView.addAimDelta(this.input.yaw - this.lastYaw, this.input.pitch - this.lastPitch);
    this.lastYaw = this.input.yaw;
    this.lastPitch = this.input.pitch;

    directionFromAngles(aimDir, this.input.yaw, this.input.pitch);
    const toolGun = this.sandbox.toolGunActive;
    this.weapon.blockFire =
      this.sandbox.interceptsFire ||
      this.sandbox.menuOpen ||
      this.input.weaponWheelOpen ||
      !this.weapon.hasWeapon;
    this.weapon.blockAim = toolGun || this.sandbox.menuOpen || this.input.weaponWheelOpen;
    this.weapon.hideViewModel = toolGun;
    const fireEdge = buttonPressed(localButtons, this.lastButtons, Button.Fire);
    const aimEdge = buttonPressed(localButtons, this.lastButtons, Button.Aim);
    const interactEdge = buttonPressed(localButtons, this.lastButtons, Button.Interact);
    const dropEdge = buttonPressed(localButtons, this.lastButtons, Button.Drop);

    this.weapon.update(dt, {
      buttons: localButtons,
      previousButtons: this.lastButtons,
      nowMs: now,
      speedRatio: predicted.speed / SPEED_WALK,
      grounded: predicted.grounded,
      crouching: predicted.crouching,
      alive: this.local.alive,
      carrying: this.local.carrying,
      cameraPosition: this.renderer.camera.position,
    });
    if (this.weapon.definition.scoped && this.weapon.aimBlend > 0.55) {
      this.weapon.viewModel.setVisible(false);
    }
    this.toolGunView.setVisible(toolGun && this.local.alive && !this.local.carrying);
    this.toolGunView.update(dt, predicted.speed / SPEED_WALK, predicted.grounded, predicted.crouching);
    this.lastButtons = localButtons;

    if (toolGun && aimEdge && !this.paused && !this.ui.hud.chatting && !this.sandbox.menuOpen) {
      this.openSpawnMenu();
    }

    if (fireEdge && this.sandbox.interceptsFire && !this.sandbox.menuOpen) {
      this.sandbox.handlePrimary(this.cameraVec(), aimDir, this.renderer.camera);
      if (toolGun) {
        if (this.sandbox.selection.spawnable) {
          this.toolGunView.kick();
          this.audio.play('switch', { volume: 0.42, variation: 0.04 });
        } else {
          this.audio.play('dryfire', { volume: 0.5 });
        }
      }
    }
    if (interactEdge && !this.paused && !this.ui.hud.chatting) {
      this.sandbox.inspectLookTarget();
      if (this.tryPickupWorldWeapon(aimDir)) {
        this.audio.play('pickup', { volume: 0.6 });
      } else {
        const interacted = this.sandbox.interactLookProp(aimDir);
        if (interacted?.sound) this.audio.play(propInteractSound(interacted.sound), { volume: 0.55, variation: 0.04 });
      }
    }
    if (
      dropEdge &&
      !this.paused &&
      !this.ui.hud.chatting &&
      !this.local.carrying &&
      !toolGun
    ) {
      this.dropHeldWeapon(aimDir);
    }

    if (this.weapon.didFire) {
      this.spawnPredictedTracer();
      this.sandbox.tryShot(muzzlePos, muzzleDir, this.weapon.definition.range, this.weapon.definition);
      this.sandbox.notifyNoise(predicted.position.x, predicted.position.z);
    }

    if (this.local.footstepThisFrame) {
      const surface = this.physics.querySurfaceBelow(predicted.position);
      this.audio.play(footstepSound(surface), { volume: 0.78, variation: 0.02 });
      this.effects.footstepDust(predicted.position, surface);
    }
    if (this.local.jumpedThisFrame) {
      this.audio.play(footstepSound(), { volume: 0.42, variation: 0.02 });
    }
    // Sprint / crate steps briefly unground the capsule; the old synth `land`
    // thud was firing on every one of those. Only real drops get a landing.
    if (this.local.landedThisFrame && this.local.landingSpeed >= 5) {
      this.audio.play(footstepSound(), {
        volume: clamp(this.local.landingSpeed / 12, 0.55, 1),
        variation: 0.02,
      });
      this.camera.onLanded(this.local.landingSpeed);
    }

    if (!this.local.alive) {
      if (this.input.weaponWheelOpen) {
        this.input.closeWeaponWheel();
        this.ui.hud.cancelWeaponWheel();
      }
      if (this.input.isActionHeld('jump') && this.offline) {
        this.offlineRespawn();
      } else if (this.input.isActionHeld('jump') && this.net && this.net.serverNowMs() >= this.respawnAt) {
        this.net.sendRespawnRequest();
      }
    } else {
      this.ui.hud.hideDeath();
    }

    if (this.offline && this.local.alive && predicted.position.y < this.map.killPlaneY) {
      this.offlineRespawn();
    }

    this.interp.sample(now, this.localId);
    this.syncPhysicsFromInterp();
    this.entities.update(this.interp, dt, now, this.renderer.camera.position);
    const localFlags =
      (predicted.grounded ? PlayerFlag.Grounded : 0) | (predicted.crouching ? PlayerFlag.Crouching : 0);
    this.localCharacter?.update(
      dt,
      predicted.position,
      this.input.yaw,
      clipFromAnimation(animationStateFor({ flags: localFlags, velocity: predicted.velocity }), predicted.speed),
      this.local.alive,
    );
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
    }

    this.effects.update(dt, now);
    this.renderer.updateShadowFocus(predicted.position.x, predicted.position.z);

    this.renderer.camera.getWorldDirection(tmpVec);
    listenerFwd.x = tmpVec.x;
    listenerFwd.y = tmpVec.y;
    listenerFwd.z = tmpVec.z;
    this.audio.updateListener(this.renderer.camera.position, listenerFwd, listenerUp, dt);

    this.renderer.render();
    this.updateHud(dt, predicted.speed / SPEED_WALK, !predicted.grounded, predicted.crouching, now);
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
          this.ui.hud.showDeath(event.respawnAt, this.net?.serverNowMs() ?? performance.now());
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
        if (!local) this.audio.playAt(footstepSound(), vec(event.pos), 0.4, 30, 0.02);
        break;
      case 'land':
        if (!local && event.v >= 5) {
          this.audio.playAt(footstepSound(), vec(event.pos), clamp(event.v / 12, 0.4, 1), 40, 0.02);
        }
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
      case 'matchStart':
        this.applyRoomPhase(RoomPhase.Playing);
        break;
      default:
        break;
    }
  }

  private applyUiSlot(slot: number, now: number): void {
    this.lastUiSlot = slot;
    this.ui.hud.setActiveSlot(slot);
    if (slot === TOOL_GUN_UI_SLOT) {
      this.sandbox.setTool('toolGun');
      this.audio.play('equip', { volume: 0.62 });
      return;
    }
    this.closeSpawnMenu();
    this.sandbox.setTool('none');
    this.syncHeldWeapon(now);
  }

  private syncHeldWeapon(now: number): void {
    if (this.input.toolGunEquipped) return;
    const id = this.loadout[this.input.firearmSlot];
    if (!id) {
      this.weapon.unequip();
      return;
    }
    if (this.weapon.hasWeapon && this.weapon.weaponId === id) return;
    this.local.weaponId = id;
    this.weapon.equip(id, now);
  }

  private dropHeldWeapon(aimDir: Vec3): void {
    const slot = this.input.firearmSlot;
    const id = this.loadout[slot];
    if (!id) return;
    this.sandbox.throwWeapon(id, this.cameraVec(), aimDir);
    this.loadout[slot] = null;
    this.weapon.unequip();
    this.ui.hud.setLoadout(this.loadoutRows());
    this.audio.play('equip', { volume: 0.45 });
  }

  private tryPickupWorldWeapon(aimDir: Vec3): boolean {
    const world = this.sandbox.aimedWeapon;
    if (!world?.active) return false;
    const kind = world.kind;
    const origin = {
      x: this.local.renderPosition.x,
      y: this.local.renderPosition.y + EYE_HEIGHT_STAND,
      z: this.local.renderPosition.z,
    };
    if (!isWeaponId(kind)) {
      this.ui.hud.showToast('This one cannot go in a weapon slot');
      return true;
    }
    const taken = this.sandbox.takeLookWeapon(origin, INTERACT_RANGE);
    if (!taken || !isWeaponId(taken)) return false;

    const slot = this.slotForPickup();
    const previous = this.loadout[slot];
    if (previous) this.sandbox.throwWeapon(previous, this.cameraVec(), aimDir);
    this.loadout[slot] = taken;
    if (slot === this.input.firearmSlot && !this.input.toolGunEquipped) {
      this.local.weaponId = taken;
      this.weapon.equip(taken, performance.now());
    }
    this.ui.hud.setLoadout(this.loadoutRows());
    return true;
  }

  private slotForPickup(): number {
    const current = this.input.firearmSlot;
    if (!this.loadout[current]) return current;
    const empty = this.loadout.findIndex((id) => !id);
    return empty >= 0 ? empty : current;
  }

  private offlineRespawn(): void {
    const spawn = pickTeamSpawn(this.map, this.localTeam) ?? pickMapSpawn(this.map, 'player');
    if (!spawn) return;
    const pos = { x: spawn.position[0], y: spawn.position[1], z: spawn.position[2] };
    this.local.health = MAX_HEALTH;
    this.local.teleport(pos);
    this.input.setAim(spawn.yaw, 0);
    this.input.resetToggles();
    this.camera.reset();
    this.weapon.unequip();
    if (this.loadout[this.input.firearmSlot]) {
      this.weapon.equip(this.loadout[this.input.firearmSlot]!, performance.now());
    }
    this.ui.hud.hideDeath();
  }

  private updateHud(dt: number, speedRatio: number, airborne: boolean, crouching: boolean, now: number): void {
    const def = this.weapon.definition;
    this.ui.hud.setHealth(this.local.health, MAX_HEALTH);
    this.ui.hud.setActiveSlot(this.input.uiSlot);
    if (this.sandbox.toolGunActive) {
      this.ui.hud.setAmmo(0, 0, 1);
      this.ui.hud.setWeapon('TOOL GUN');
      this.ui.hud.setSpread(0.004 + speedRatio * 0.006);
      const kind =
        this.sandbox.selection.category === 'npc'
          ? 'NPC'
          : this.sandbox.selection.category === 'tools'
            ? 'Tool'
            : this.sandbox.selection.category === 'weapons'
              ? 'Weapon'
              : 'Prop';
      this.ui.hud.setToolGun(true, kind, this.sandbox.selection.spawnable);
      this.ui.hud.setScope(0, 'none');
      this.ui.hud.setCrosshairMotion(
        speedRatio,
        this.sandbox.lookHint === 'npc' || this.sandbox.lookHint === 'prop' || this.sandbox.lookHint === 'weapon',
        this.sandbox.lookHint === 'spawn' && this.sandbox.selection.spawnable,
      );
    } else if (!this.weapon.hasWeapon) {
      this.ui.hud.setAmmo(0, 0, 1);
      this.ui.hud.setWeapon('EMPTY');
      this.ui.hud.setSpread(0.004 + speedRatio * 0.006);
      this.ui.hud.setToolGun(false, 'NPC', true);
      this.ui.hud.setCrosshairMotion(speedRatio, Boolean(this.sandbox.aimedWeapon), false);
      this.ui.hud.setScope(0, 'none');
    } else {
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
      this.ui.hud.setToolGun(false, 'NPC', true);
      this.ui.hud.setCrosshairMotion(speedRatio, Boolean(this.sandbox.aimedWeapon), false);
      this.ui.hud.setScope(this.local.alive && def.scoped ? this.weapon.aimBlend : 0, def.scoped ? 'optic' : 'none');
    }
    this.ui.hud.setNet(this.fps, this.offline ? 0 : (this.net?.rttMs ?? 0), settingsStore.graphics.debugOverlay);
    this.ui.hud.setInteract(this.interactPrompt());
    const scopedOut =
      !this.sandbox.toolGunActive &&
      this.weapon.hasWeapon &&
      Boolean(def.scoped) &&
      this.weapon.aimBlend > 0.55;
    this.ui.hud.setCrosshairVisible(
      this.local.alive &&
        !this.paused &&
        !this.ui.hud.weaponWheelOpen &&
        !this.spawnMenu?.isOpen &&
        !scopedOut,
    );
    this.ui.hud.setScoreboard(this.scoreRows(), this.input.isActionHeld('scoreboard') && !this.ui.hud.chatting);
    this.ui.hud.setDebug(
      `tick ack ${this.net?.ackTick ?? 0}\n` +
        `rtt ${this.offline ? 'offline' : (this.net?.rttMs ?? 0).toFixed(0)} ms\n` +
        `draws ${this.renderer.drawCalls}  tris ${this.renderer.triangles}\n` +
        `particles ${this.effects.particleCount}\n` +
        `corr ${this.local.correctionCount}  err ${this.local.lastError.toFixed(3)}\n` +
        `pos ${this.local.renderPosition.x.toFixed(1)} ${this.local.renderPosition.y.toFixed(1)} ${this.local.renderPosition.z.toFixed(1)}`,
      settingsStore.graphics.debugOverlay,
    );
    this.ui.hud.update(dt, this.offline ? now : this.net?.serverNowMs() ?? now);
  }

  private loadoutRows() {
    return this.loadout.map((id, index) => {
      if (!id) return { id: '', name: '—' };
      const def = getWeapon(id);
      const live = index === this.input.uiSlot && !this.input.toolGunEquipped;
      return {
        id,
        name: def.name,
        mag: live ? this.weapon.ammoInMag : def.magazineSize,
        reserve: live ? this.weapon.ammoReserve : def.reserveAmmo,
        magSize: def.magazineSize,
      };
    });
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
    const npc = this.sandbox.hoveredNpc;
    if (NPC_MENU_ENABLED && npc?.active && !npc.dead) {
      const px = npc.position.x;
      const pz = npc.position.z;
      const dx = px - this.local.renderPosition.x;
      const dz = pz - this.local.renderPosition.z;
      if (dx * dx + dz * dz <= 3.6 * 3.6) return 'E  Inspect';
    }
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
    const weaponPrompt = this.sandbox.lookWeaponPrompt();
    if (weaponPrompt) return weaponPrompt;
    const propPrompt = this.sandbox.lookPropPrompt();
    if (propPrompt) return propPrompt;
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
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    for (const off of this.unsubs) off();
    this.input?.detach();
    this.input?.releaseLock();
    this.net?.disconnect();
    this.weapon?.dispose();
    this.toolGunView?.dispose();
    this.localCharacter?.dispose();
    this.localCharacter = null;
    this.entities?.dispose();
    this.sandbox?.dispose();
    this.spawnMenu?.dispose();
    this.effects?.dispose();
    this.mapBuilder?.dispose();
    this.mapDecor?.dispose();
    this.mapDecor = null;
    this.physics?.dispose();
    this.audio?.dispose();
    this.ui.hud.setLobbyInvite(null);
    this.ui.hideLobbyWait();
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

function propInteractSound(
  sound: 'duck' | 'radio' | 'whoopee' | 'cluck' | 'switch' | 'door' | 'squeak',
): SoundKey {
  if (sound === 'door') return 'door';
  if (sound === 'switch' || sound === 'radio') return 'switch';
  if (sound === 'whoopee') return 'pickup';
  return 'ui_click';
}
