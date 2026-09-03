import './ui/styles.css';
import { authService } from './supabase/auth';
import { GAME_SERVER_URL, supabaseConfigured } from './supabase/client';
import { UiApp, type JoinRequest } from './ui/app';
import { GameSession } from './core/gameSession';

const canvasEl = document.querySelector<HTMLCanvasElement>('#viewport');
const uiRootEl = document.querySelector<HTMLElement>('#ui-root');
if (!canvasEl || !uiRootEl) throw new Error('RAGELAB markup is missing #viewport or #ui-root');
const canvas: HTMLCanvasElement = canvasEl;
const uiRoot: HTMLElement = uiRootEl;

const ui = new UiApp(uiRoot);
let session: GameSession | null = null;
let joining = false;

ui.onJoin = (request) => {
  void join(request);
};
ui.onLeaveMatch = () => {
  leave();
};

async function boot(): Promise<void> {
  await authService.initialize();
  await ui.refreshAuth();
  authService.events.on('changed', () => {
    void ui.refreshAuth();
  });
  ui.showMenu();
  console.info(
    `[RAGELAB] client ready · server ${GAME_SERVER_URL} · supabase ${supabaseConfigured() ? 'on' : 'off'}`,
  );
}

async function join(request: JoinRequest): Promise<void> {
  if (joining) return;
  joining = true;
  ui.setConnecting(true, 'Connecting to game server…');
  try {
    const token = await authService.freshAccessToken();
    const next = await GameSession.start(canvas, ui, {
      username: request.username,
      token: token ?? undefined,
      roomId: request.roomId,
      mapId: request.mapId,
      password: request.password,
      create: request.create,
    });
    session?.dispose();
    session = next;
  } catch (err) {
    ui.setConnecting(false);
    ui.showMenu();
    ui.toast(err instanceof Error ? err.message : String(err));
  } finally {
    joining = false;
  }
}

function leave(): void {
  session?.dispose();
  session = null;
  ui.showMenu();
}

window.addEventListener('beforeunload', () => {
  session?.dispose();
});

boot().catch((err) => {
  console.error('[RAGELAB] boot failed', err);
  ui.toast('Failed to start the client');
  ui.showMenu();
});
