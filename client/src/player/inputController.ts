import { Button, clamp, wrapAngle, type ControlSettings } from '@ragelab/shared';

export interface AimState {
  yaw: number;
  pitch: number;
}

/**
 * Translates raw keyboard/mouse events into the intent the network protocol
 * expects. Nothing here knows about the simulation - it only produces move
 * axes, a button bitmask and an aim direction.
 */
export class InputController {
  private readonly pressed = new Set<string>();
  private readonly mouseButtons = new Set<number>();
  /** Actions triggered by a wheel tick, consumed once. */
  private wheelDelta = 0;

  private controls: ControlSettings;
  private locked = false;
  private enabled = false;

  yaw = 0;
  pitch = 0;

  /** Slot the player wants to hold, driven by number keys and the wheel. */
  weaponSlot = 0;
  loadoutSize = 5;

  /** Latched toggle states for toggle-style sprint/crouch/aim. */
  private toggleSprint = false;
  private toggleCrouch = false;
  private toggleAim = false;

  /** Single-frame edges consumed by the UI (not sent to the server). */
  private readonly uiEdges = new Set<string>();

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (isTypingTarget(event.target)) return;
    this.pressed.add(event.code);
    this.handleActionEdge(event.code);
    // Prevent the browser eating gameplay keys while playing.
    if (this.locked && GAMEPLAY_KEYS.has(event.code)) event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!this.locked) return;
    this.mouseButtons.add(event.button);
    this.handleActionEdge(`Mouse${event.button}`);
    event.preventDefault();
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    this.mouseButtons.delete(event.button);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return;
    // Pointer lock reports raw deltas; 0.0022 rad per unit at sensitivity 1
    // matches the feel of mainstream shooters at 800 DPI.
    const scale = 0.0022 * this.controls.sensitivity * (this.aimingNow() ? this.controls.aimSensitivityMultiplier : 1);
    this.yaw = wrapAngle(this.yaw - event.movementX * scale);
    const pitchDelta = event.movementY * scale * (this.controls.invertY ? 1 : -1);
    this.pitch = clamp(this.pitch + pitchDelta, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.locked) return;
    this.wheelDelta += event.deltaY;
    event.preventDefault();
  };

  private readonly onPointerLockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) {
      this.pressed.clear();
      this.mouseButtons.clear();
    }
    this.lockListeners.forEach((fn) => fn(this.locked));
  };

  private readonly onBlur = (): void => {
    this.pressed.clear();
    this.mouseButtons.clear();
  };

  private readonly onContextMenu = (event: Event): void => {
    if (this.locked) event.preventDefault();
  };

  private readonly lockListeners: Array<(locked: boolean) => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    controls: ControlSettings,
  ) {
    this.controls = controls;
  }

  attach(): void {
    if (this.enabled) return;
    this.enabled = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    if (!this.enabled) return;
    this.enabled = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  onLockChange(handler: (locked: boolean) => void): () => void {
    this.lockListeners.push(handler);
    return () => {
      const index = this.lockListeners.indexOf(handler);
      if (index >= 0) this.lockListeners.splice(index, 1);
    };
  }

  updateControls(controls: ControlSettings): void {
    this.controls = controls;
  }

  requestLock(): void {
    if (this.locked) return;
    void this.canvas.requestPointerLock?.();
  }

  releaseLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  get isLocked(): boolean {
    return this.locked;
  }

  setAim(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  private binding(action: string): string {
    return this.controls.bindings[action] ?? '';
  }

  private isDown(action: string): boolean {
    const code = this.binding(action);
    if (!code) return false;
    if (code.startsWith('Mouse')) return this.mouseButtons.has(Number(code.slice(5)));
    return this.pressed.has(code);
  }

  private aimingNow(): boolean {
    return this.controls.toggleAim ? this.toggleAim : this.isDown('aim');
  }

  /** Rising-edge handling for toggles, weapon slots and UI shortcuts. */
  private handleActionEdge(code: string): void {
    const bindings = this.controls.bindings;
    for (const [action, bound] of Object.entries(bindings)) {
      if (bound !== code) continue;
      switch (action) {
        case 'sprint':
          if (this.controls.toggleSprint) this.toggleSprint = !this.toggleSprint;
          break;
        case 'crouch':
          if (this.controls.toggleCrouch) this.toggleCrouch = !this.toggleCrouch;
          break;
        case 'aim':
          if (this.controls.toggleAim) this.toggleAim = !this.toggleAim;
          break;
        case 'weapon1':
        case 'weapon2':
        case 'weapon3':
        case 'weapon4':
        case 'weapon5':
          this.weaponSlot = Number(action.slice(6)) - 1;
          break;
        default:
          this.uiEdges.add(action);
      }
    }
  }

  /** Consume a UI edge such as `scoreboard` or `chat`. */
  consumeEdge(action: string): boolean {
    if (!this.uiEdges.has(action)) return false;
    this.uiEdges.delete(action);
    return true;
  }

  clearEdges(): void {
    this.uiEdges.clear();
  }

  isActionHeld(action: string): boolean {
    return this.isDown(action);
  }

  /** Called once per simulation tick to build the command payload. */
  sample(): { moveX: number; moveZ: number; buttons: number; weaponSlot: number } {
    if (this.wheelDelta !== 0) {
      const steps = this.wheelDelta > 0 ? 1 : -1;
      this.weaponSlot =
        (this.weaponSlot + steps + this.loadoutSize) % Math.max(1, this.loadoutSize);
      this.wheelDelta = 0;
    }

    let moveX = 0;
    let moveZ = 0;
    if (this.isDown('forward')) moveZ += 1;
    if (this.isDown('back')) moveZ -= 1;
    if (this.isDown('right')) moveX += 1;
    if (this.isDown('left')) moveX -= 1;

    let buttons = 0;
    if (this.isDown('jump')) buttons |= Button.Jump;
    if (this.controls.toggleSprint ? this.toggleSprint : this.isDown('sprint')) {
      buttons |= Button.Sprint;
    }
    if (this.controls.toggleCrouch ? this.toggleCrouch : this.isDown('crouch')) {
      buttons |= Button.Crouch;
    }
    if (this.isDown('fire')) buttons |= Button.Fire;
    if (this.aimingNow()) buttons |= Button.Aim;
    if (this.isDown('reload')) buttons |= Button.Reload;
    if (this.isDown('interact')) buttons |= Button.Interact;
    if (this.isDown('dropProp')) buttons |= Button.Drop;

    this.weaponSlot = clamp(this.weaponSlot, 0, Math.max(0, this.loadoutSize - 1));

    return { moveX, moveZ, buttons, weaponSlot: this.weaponSlot };
  }

  /** Clear latched toggles, e.g. on respawn. */
  resetToggles(): void {
    this.toggleSprint = false;
    this.toggleCrouch = false;
    this.toggleAim = false;
  }
}

const GAMEPLAY_KEYS = new Set([
  'Space',
  'Tab',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ControlLeft',
  'ShiftLeft',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'F3',
  'KeyB',
]);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}
