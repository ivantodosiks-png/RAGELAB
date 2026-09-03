import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config';
import { log } from '../logger';

const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const URL_WAIT_MS = 45_000;
const HEALTH_WAIT_MS = 20_000;

export interface PublicTunnel {
  stop: () => void;
}

export function isLoopbackWsUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return true;
  }
}

/**
 * Publish the local game port on a public wss:// URL so friends outside LAN
 * can join this listen server. Uses Cloudflare quick tunnels (no account).
 */
export async function startPublicTunnel(port: number): Promise<PublicTunnel | null> {
  if (!config.publicTunnel) return null;
  if (config.publicWsUrl && !isLoopbackWsUrl(config.publicWsUrl)) {
    log.info('using configured public websocket URL', { url: config.publicWsUrl });
    return null;
  }

  let binary: string;
  try {
    binary = await resolveCloudflared();
  } catch (err) {
    log.warn('public tunnel unavailable', { message: (err as Error).message });
    return null;
  }

  const child = spawn(binary, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const httpsUrl = await waitForTunnelUrl(child);
  if (!httpsUrl) {
    stopChild(child);
    log.warn('public tunnel did not publish a URL; internet join is disabled');
    return null;
  }

  await waitUntilHealthy(httpsUrl);
  config.publicWsUrl = httpsToWss(httpsUrl);
  log.info('public tunnel ready — friends can join from any internet', {
    ws: config.publicWsUrl,
    http: httpsUrl,
  });

  child.on('exit', (code, signal) => {
    log.warn('public tunnel exited', { code, signal });
  });

  return {
    stop: () => stopChild(child),
  };
}

function httpsToWss(httpsUrl: string): string {
  const url = new URL(httpsUrl);
  url.protocol = 'wss:';
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function waitForTunnelUrl(child: ChildProcess): Promise<string | null> {
  return new Promise((resolveUrl) => {
    let found: string | null = null;
    let buf = '';
    const timer = setTimeout(() => {
      cleanup();
      resolveUrl(found);
    }, URL_WAIT_MS);

    const onData = (chunk: Buffer): void => {
      buf = (buf + chunk.toString('utf8')).slice(-8000);
      const match = buf.match(TUNNEL_URL_RE);
      if (!match || found) return;
      found = match[0];
      cleanup();
      resolveUrl(found);
    };

    const cleanup = (): void => {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('error', (err) => {
      log.warn('public tunnel failed to start', { message: err.message });
      cleanup();
      resolveUrl(null);
    });
    child.once('exit', () => {
      if (found) return;
      cleanup();
      resolveUrl(null);
    });
  });
}

async function waitUntilHealthy(httpsUrl: string): Promise<void> {
  const deadline = Date.now() + HEALTH_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${httpsUrl}/health`, {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) return;
    } catch {
      /* tunnel is still propagating */
    }
    await sleep(1000);
  }
}

async function resolveCloudflared(): Promise<string> {
  const fromPath = await whichCloudflared();
  if (fromPath) return fromPath;

  const dest = cachedBinaryPath();
  if (existsSync(dest)) return dest;

  const url = downloadUrl();
  log.info('downloading cloudflared for public internet hosting', { url, dest });
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`cloudflared download failed (${res.status})`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, bytes);
  if (process.platform !== 'win32') chmodSync(dest, 0o755);
  return dest;
}

function cachedBinaryPath(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, 'package.json')) && existsSync(resolve(dir, 'server'))) {
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const name = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  return resolve(dir, 'tmp-assets', 'tools', name);
}

function downloadUrl(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  if (process.platform === 'win32') {
    return `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-${arch}.exe`;
  }
  if (process.platform === 'darwin') {
    return `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${arch}`;
  }
  return `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`;
}

function whichCloudflared(): Promise<string | null> {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const name = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  return new Promise((resolvePath) => {
    const child = spawn(cmd, [name], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      resolvePath(code === 0 && first ? first : null);
    });
    child.on('error', () => resolvePath(null));
  });
}

function stopChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.killed) return;
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
