import { el } from './dom';
import type { SandboxController } from '../sandbox/sandboxController';
import type { SandboxQuality, SandboxTool } from '../sandbox/types';
import { SANDBOX_WEAPON_KINDS, type SandboxWeaponKind } from '../weapons/weaponAssets';

export class SandboxPanel {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly countInput: HTMLInputElement;
  private readonly heightInput: HTMLInputElement;
  private readonly offsetInput: HTMLInputElement;
  private readonly maxInput: HTMLInputElement;
  private readonly fxInput: HTMLInputElement;
  private readonly ragdollCheck: HTMLInputElement;
  private readonly autoCheck: HTMLInputElement;
  private readonly quality: HTMLSelectElement;
  private readonly inspect: HTMLElement;
  private readonly inspectState: HTMLElement;
  private readonly inspectMass: HTMLElement;
  private readonly inspectVel: HTMLElement;
  private readonly confirm: HTMLElement;
  private readonly liveLabel: HTMLElement;
  private readonly cursorHint: HTMLElement;
  private readonly weaponSelect: HTMLSelectElement;
  private collapsed = false;

  constructor(
    host: HTMLElement,
    private readonly sandbox: SandboxController,
  ) {
    this.root = el('aside', 'sandbox-panel hit');
    const head = el('header', 'sandbox-head');
    const title = el('div', 'sandbox-title', 'SANDBOX');
    const toggle = el('button', 'sandbox-collapse', '–');
    toggle.type = 'button';
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      this.collapsed = !this.collapsed;
      this.root.classList.toggle('collapsed', this.collapsed);
      toggle.textContent = this.collapsed ? '+' : '–';
    });
    head.append(title, toggle);

    this.body = el('div', 'sandbox-body');
    this.cursorHint = el('p', 'sandbox-hint', 'B — cursor mode · click world to use tool');
    this.liveLabel = el('p', 'sandbox-live', 'NPC 0 / 24');

    const countField = stepper('NPC Count', 1, 16, 1, (value) => {
      this.sandbox.patchSettings({ npcCount: value });
    });
    this.countInput = countField.input;

    const heightField = slider('Spawn Height', 0, 2.5, 0.05, 0.05, (value) => {
      this.sandbox.patchSettings({ spawnHeight: value });
    });
    this.heightInput = heightField.input;

    const offsetField = slider('Random Offset', 0, 3, 0.45, 0.05, (value) => {
      this.sandbox.patchSettings({ spawnRandomOffset: value });
    });
    this.offsetInput = offsetField.input;

    const ragdollField = toggleRow('Ragdoll On Spawn', false, (on) => {
      this.sandbox.patchSettings({ ragdollOnSpawn: on });
    });
    this.ragdollCheck = ragdollField.input;

    const autoField = toggleRow('Auto Cleanup', true, (on) => {
      this.sandbox.patchSettings({ autoCleanup: on });
    });
    this.autoCheck = autoField.input;

    const maxField = stepper('Maximum NPCs', 1, 64, 24, (value) => {
      this.sandbox.patchSettings({ maxNpcs: value });
    });
    this.maxInput = maxField.input;

    const fxField = stepper('Max Effects', 20, 800, 200, (value) => {
      this.sandbox.patchSettings({ maxEffects: value });
    });
    this.fxInput = fxField.input;

    this.quality = document.createElement('select');
    this.weaponSelect = document.createElement('select');

    this.body.append(
      this.cursorHint,
      this.liveLabel,
      section('NPC', [
        countField.wrap,
        toolRow(this.sandbox, [
          ['spawn', 'Spawn NPC'],
          ['delete', 'Delete NPC'],
          ['ragdoll', 'Ragdoll'],
          ['select', 'Select'],
        ]),
        btn('Spawn NPC', 'primary', () => this.onSpawnLook?.()),
        btn('Reset NPC', '', () => this.onResetNpc?.()),
        btn('Remove All NPCs', '', () => this.sandbox.removeAllNpcs()),
      ]),
      section('WEAPONS', [
        weaponSelect(this.weaponSelect, (kind) => this.sandbox.patchSettings({ weaponKind: kind })),
        toolRow(this.sandbox, [
          ['spawnWeapon', 'Spawn Weapon'],
          ['grab', 'Grab / Throw'],
        ]),
        btn('Spawn Weapon', 'primary', () => this.onSpawnWeaponLook?.()),
        btn('Remove Weapons', '', () => this.sandbox.removeAllWeapons()),
      ]),
      section('NPC SETTINGS', [
        heightField.wrap,
        offsetField.wrap,
        ragdollField.wrap,
        autoField.wrap,
        maxField.wrap,
        fxField.wrap,
        qualityRow(this.quality, (q) => {
          this.sandbox.patchSettings({ quality: q });
          this.onQuality?.(q);
        }),
      ]),
      (this.inspect = el('div', 'sandbox-inspect')),
      section('CLEANUP', [
        btn('Remove NPCs', '', () => this.sandbox.removeAllNpcs()),
        btn('Remove Effects', '', () => this.onClearEffects?.()),
        btn('Remove Decals', '', () => this.onClearDecals?.()),
        btn('Remove Physics Objects', '', () => {
          this.sandbox.removeAllNpcs();
          this.sandbox.removeAllWeapons();
        }),
        btn('Clear Everything', 'danger', () => this.showConfirm(true)),
        btn('Clear Scene', 'danger', () => this.showConfirm(true)),
      ]),
    );

    this.confirm = el('div', 'sandbox-confirm');
    this.confirm.append(
      el('p', '', 'Clear entire scene?'),
      (() => {
        const row = el('div', 'sandbox-confirm-row');
        row.append(
          btn('Cancel', '', () => this.showConfirm(false)),
          btn('Clear', 'danger', () => {
            this.showConfirm(false);
            this.onClearScene?.();
          }),
        );
        return row;
      })(),
    );
    this.confirm.hidden = true;

    this.inspectState = el('p', '', 'State: Idle');
    this.inspectMass = el('p', '', 'Mass: 0 kg');
    this.inspectVel = el('p', '', 'Velocity: 0 m/s');
    const inspectRow = el('div', 'sandbox-btn-row');
    inspectRow.append(
      btn('Ragdoll', '', () => this.sandbox.ragdollSelected()),
      btn('Reset', '', () => this.sandbox.resetSelected()),
      btn('Delete', 'danger', () => this.sandbox.deleteSelected()),
    );
    this.inspect.append(el('div', 'sandbox-kicker', 'NPC'), this.inspectState, this.inspectMass, this.inspectVel, inspectRow);
    this.inspect.hidden = true;

    this.root.append(head, this.body, this.confirm);
    this.root.addEventListener('mousedown', (event) => event.stopPropagation());
    this.root.addEventListener('click', (event) => event.stopPropagation());
    host.append(this.root);

    this.sandbox.onChange(() => this.refresh());
    this.refresh();
  }

  onSpawnLook: (() => void) | null = null;
  onSpawnWeaponLook: (() => void) | null = null;
  onResetNpc: (() => void) | null = null;
  onClearEffects: (() => void) | null = null;
  onClearDecals: (() => void) | null = null;
  onClearScene: (() => void) | null = null;
  onQuality: ((q: SandboxQuality) => void) | null = null;

  tick(): void {
    this.syncInspect();
  }

  refresh(): void {
    const s = this.sandbox.settings;
    this.countInput.value = String(s.npcCount);
    this.heightInput.value = String(s.spawnHeight);
    this.offsetInput.value = String(s.spawnRandomOffset);
    this.maxInput.value = String(s.maxNpcs);
    this.fxInput.value = String(s.maxEffects);
    this.ragdollCheck.checked = s.ragdollOnSpawn;
    this.autoCheck.checked = s.autoCleanup;
    this.quality.value = s.quality;
    this.weaponSelect.value = s.weaponKind;
    this.liveLabel.textContent = `NPC ${this.sandbox.liveCount} / ${s.maxNpcs} · WPN ${this.sandbox.weaponCount} / ${s.maxWeapons}`;
    this.cursorHint.textContent = this.sandbox.cursorMode
      ? 'Cursor mode on — click the world. B to lock mouse.'
      : 'B — cursor mode · click world to use tool';
    this.root.classList.toggle('cursor-on', this.sandbox.cursorMode);

    for (const node of this.root.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      node.classList.toggle('active', node.dataset.tool === this.sandbox.tool);
    }
    this.syncInspect();
  }

  private syncInspect(): void {
    const sel = this.sandbox.selectedNpc;
    if (!sel) {
      this.inspect.hidden = true;
      return;
    }
    this.inspect.hidden = false;
    this.inspectState.textContent = `State: ${sel.state}`;
    this.inspectMass.textContent = `Mass: ${sel.mass.toFixed(1)} kg`;
    this.inspectVel.textContent = `Velocity: ${sel.speed.toFixed(2)} m/s`;
  }

  private showConfirm(open: boolean): void {
    this.confirm.hidden = !open;
    this.body.style.display = open ? 'none' : '';
  }
}

function section(title: string, children: HTMLElement[]): HTMLElement {
  const wrap = el('section', 'sandbox-section');
  wrap.append(el('h3', '', title), ...children);
  return wrap;
}

function btn(label: string, extra: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', `rl-btn sandbox-btn${extra ? ` ${extra}` : ''}`, label);
  node.type = 'button';
  node.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return node;
}

function toolRow(sandbox: SandboxController, tools: Array<[SandboxTool, string]>): HTMLElement {
  const row = el('div', 'sandbox-btn-row');
  for (const [id, label] of tools) {
    const node = btn(label, '', () => sandbox.setTool(sandbox.tool === id ? 'none' : id));
    node.dataset.tool = id;
    row.append(node);
  }
  return row;
}

function stepper(
  label: string,
  min: number,
  max: number,
  value: number,
  onChange: (value: number) => void,
): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = el('label', 'sandbox-field');
  wrap.append(el('span', '', label));
  const row = el('div', 'sandbox-step');
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.value = String(value);
  const minus = btn('–', '', () => {
    input.value = String(Math.max(min, Number(input.value) - 1));
    onChange(Number(input.value));
  });
  const plus = btn('+', '', () => {
    input.value = String(Math.min(max, Number(input.value) + 1));
    onChange(Number(input.value));
  });
  input.addEventListener('change', () => onChange(Number(input.value)));
  row.append(minus, input, plus);
  wrap.append(row);
  return { wrap, input };
}

function slider(
  label: string,
  min: number,
  max: number,
  value: number,
  step: number,
  onChange: (value: number) => void,
): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = el('label', 'sandbox-field');
  const cap = el('span', '', `${label}: ${value.toFixed(2)}`);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => {
    cap.textContent = `${label}: ${Number(input.value).toFixed(2)}`;
    onChange(Number(input.value));
  });
  wrap.append(cap, input);
  return { wrap, input };
}

function toggleRow(
  label: string,
  value: boolean,
  onChange: (on: boolean) => void,
): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = el('label', 'sandbox-check');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  wrap.append(input, el('span', '', label));
  return { wrap, input };
}

function qualityRow(select: HTMLSelectElement, onChange: (q: SandboxQuality) => void): HTMLElement {
  const wrap = el('label', 'sandbox-field');
  wrap.append(el('span', '', 'NPC / VFX budget'));
  select.className = 'sandbox-select';
  for (const [id, label] of [
    ['low', 'Low'],
    ['medium', 'Medium'],
    ['high', 'High'],
  ] as const) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = label;
    select.append(opt);
  }
  select.value = 'medium';
  select.addEventListener('change', () => onChange(select.value as SandboxQuality));
  wrap.append(select);
  return wrap;
}

function weaponSelect(select: HTMLSelectElement, onChange: (kind: SandboxWeaponKind) => void): HTMLElement {
  const wrap = el('label', 'sandbox-field');
  wrap.append(el('span', '', 'Weapon'));
  select.className = 'sandbox-select';
  const labels: Record<SandboxWeaponKind, string> = {
    pistol: 'Pistol',
    rifle: 'Rifle',
    shotgun: 'Shotgun',
    smg: 'SMG',
    melee: 'Melee',
  };
  for (const id of SANDBOX_WEAPON_KINDS) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = labels[id];
    select.append(opt);
  }
  select.value = 'pistol';
  select.addEventListener('change', () => onChange(select.value as SandboxWeaponKind));
  wrap.append(select);
  return wrap;
}
