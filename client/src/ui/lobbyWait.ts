import type { PlayerIdentity } from '@ragelab/shared';
import { copyText } from './lobbyInvite';
import { clear, el } from './dom';

export interface LobbyWaitState {
  code: string;
  name: string;
  mapId: string;
  isHost: boolean;
  isAdmin: boolean;
  starting: boolean;
  players: PlayerIdentity[];
  hostPlayerId: number | null;
  localPlayerId: number;
  maxPlayers: number;
}

export class LobbyWait {
  readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly card: HTMLElement;
  onStart: (() => void) | null = null;
  onLeave: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.root = el('div', 'lobby-wait hit');
    this.root.hidden = true;

    const bg = el('div', 'lobby-bg');
    bg.innerHTML = `
      <div class="lobby-forest" aria-hidden="true"></div>
      <div class="lobby-mist" aria-hidden="true"></div>
      <div class="lobby-lamp-pole" aria-hidden="true">
        <div class="lobby-lamp-arm"></div>
        <div class="lobby-lamp-bulb"></div>
        <div class="lobby-lamp-glow"></div>
      </div>`;
    this.root.append(bg);

    this.stage = el('div', 'lobby-stage');
    this.card = el('div', 'lobby-wait-card');
    this.stage.append(this.card);
    this.root.append(this.stage);
    host.append(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
    this.root.classList.toggle('is-on', visible);
  }

  render(state: LobbyWaitState): void {
    clear(this.card);
    this.card.append(el('p', 'lobby-kicker', 'ONLINE LOBBY'));
    this.card.append(el('h2', '', state.isHost ? 'Lobby ready' : 'In lobby'));
    this.card.append(el('p', 'lobby-lead', `${state.name} · ${state.mapId}`));

    const codeBox = el('div', 'lobby-code-box');
    codeBox.append(el('span', 'lobby-code-label', 'Code'));
    const code = el('div', 'lobby-code', formatLobbyCode(state.code));
    codeBox.append(code);
    const copy = el('button', 'rl-btn lobby-copy', 'Copy');
    copy.addEventListener('click', async () => {
      const ok = await copyText(state.code);
      copy.textContent = ok ? 'Copied' : 'Failed';
      window.setTimeout(() => {
        copy.textContent = 'Copy';
      }, 1600);
    });
    codeBox.append(copy);
    this.card.append(codeBox);

    const list = el('div', 'lobby-players');
    list.append(el('h3', '', `Players · ${state.players.length}/${state.maxPlayers}`));
    if (state.players.length === 0) {
      list.append(el('p', 'lobby-empty', 'Nobody here yet. Share the code with friends.'));
    } else {
      for (const player of state.players) {
        const row = el('div', 'lobby-player');
        if (player.id === state.localPlayerId) row.classList.add('self');
        const name = el('span', 'lobby-player-name', player.username);
        row.append(name);
        if (player.id === state.hostPlayerId) row.append(el('span', 'lobby-badge', 'Host'));
        if (player.id === state.localPlayerId) row.append(el('span', 'lobby-badge muted', 'You'));
        list.append(row);
      }
    }
    this.card.append(list);

    const actions = el('div', 'lobby-actions');
    if (state.isHost) {
      const start = el('button', 'rl-btn primary lobby-start', state.starting ? 'Starting…' : 'Start match');
      start.disabled = state.starting;
      if (state.starting) start.classList.add('is-loading');
      start.addEventListener('click', () => this.onStart?.());
      actions.append(start);
    } else {
      actions.append(el('p', 'lobby-wait-note', 'Waiting for host…'));
    }
    const leave = el('button', 'rl-btn', 'Leave');
    leave.addEventListener('click', () => this.onLeave?.());
    actions.append(leave);
    this.card.append(actions);
  }
}

function formatLobbyCode(code: string): string {
  const raw = code.replace(/\s/g, '');
  return raw.length === 6 ? `${raw.slice(0, 3)} ${raw.slice(3)}` : raw;
}
