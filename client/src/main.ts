import './ui/styles.css';
import { authService } from './supabase/auth';
import { GAME_SERVER_URL, supabaseConfigured } from './supabase/client';
import { UiApp, type JoinRequest } from './ui/app';
import { parseLobbyInvite } from './ui/lobbyInvite';
import { GameSession } from './core/gameSession';
import { MenuBackdrop } from './ui/menuBackdrop';

const canvasEl = document.querySelector<HTMLCanvasElement>('#viewport');
const uiRootEl = document.querySelector<HTMLElement>('#ui-root');
if (!canvasEl || !uiRootEl) throw new Error('RAGELAB markup is missing #viewport or #ui-root');
const canvas: HTMLCanvasElement = canvasEl;
const uiRoot: HTMLElement = uiRootEl;

const ui = new UiApp(uiRoot);
let session: GameSession | null = null;
let joining = false;
let backdrop: MenuBackdrop | null = null;

function startMenuWorld(): void {
  backdrop?.stop();
  backdrop = new MenuBackdrop(canvas);
  backdrop.start();
}

function stopMenuWorld(): void {
  backdrop?.stop();
  backdrop = null;
}

ui.onJoin = (request) => {
  void join(request);
};
ui.onLeaveMatch = () => {
  leave();
};
ui.onStartMatch = () => {
  session?.requestStartMatch();
};

async function boot(): Promise<void> {
  await authService.initialize();
  await ui.refreshAuth();
  authService.events.on('changed', () => {
    void ui.refreshAuth();
  });
  startMenuWorld();
  ui.showMenu();
  const invite = parseLobbyInvite();
  if (invite) {
    ui.menu.pendingJoinCode = invite.code;
    ui.menu.show('play');
    void ui.joinInvite(invite);
  }
  console.info(
    `[RAGELAB] client ready · server ${GAME_SERVER_URL} · supabase ${supabaseConfigured() ? 'on' : 'off'}`,
  );
}

async function join(request: JoinRequest): Promise<void> {
  if (joining) return;
  joining = true;
    stopMenuWorld();
    ui.setConnecting(true, request.offline ? 'Starting offline…' : 'Connecting to game server…');
    try {
      const token = request.offline ? null : await authService.freshAccessToken();
      const next = await GameSession.start(canvas, ui, {
        username: request.username,
        token: token ?? undefined,
        roomId: request.roomId,
        mapId: request.mapId,
        password: request.password,
        wsUrl: request.wsUrl,
        roomCode: request.roomCode,
        offline: request.offline,
        team: request.team,
        create: request.create,
      });
    session?.dispose();
    session = next;
  } catch (err) {
    ui.setConnecting(false);
    ui.menu.setCreateBusy(false);
    startMenuWorld();
    ui.showMenu();
    ui.toast(err instanceof Error ? err.message : String(err));
  } finally {
    joining = false;
  }
}

function leave(): void {
  session?.dispose();
  session = null;
  ui.menu.setCreateBusy(false);
  startMenuWorld();
  ui.showMenu();
}

window.addEventListener('beforeunload', () => {
  session?.dispose();
});

boot().catch((err) => {
  console.error('[RAGELAB] boot failed', err);
  ui.toast('Failed to start the client');
  startMenuWorld();
  ui.showMenu();
});
