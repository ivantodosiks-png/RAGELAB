import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const INJECT = '<script>window.__RAGELAB_SAME_ORIGIN__=true</script>';

function candidateDistDirs(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    resolve(process.cwd(), 'client/dist'),
    resolve(here, '../../client/dist'),
    resolve(here, '../../../client/dist'),
  ];
}

export function resolveClientDist(): string | null {
  for (const dir of candidateDistDirs()) {
    if (existsSync(join(dir, 'index.html'))) return dir;
  }
  return null;
}

export class StaticSite {
  private readonly indexHtml: Buffer | null;

  constructor(private readonly dist: string | null) {
    if (!dist) {
      this.indexHtml = null;
      return;
    }
    const raw = readFileSync(join(dist, 'index.html'), 'utf8');
    const withFlag = raw.includes('__RAGELAB_SAME_ORIGIN__')
      ? raw
      : raw.replace('<head>', `<head>${INJECT}`);
    this.indexHtml = Buffer.from(withFlag, 'utf8');
  }

  get enabled(): boolean {
    return this.dist !== null && this.indexHtml !== null;
  }

  tryServe(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
    if (!this.enabled || !this.dist || !this.indexHtml) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;

    let rel = decodeURIComponent(pathname);
    if (rel.includes('\0')) return false;
    if (rel === '/' || rel === '') rel = '/index.html';

    const spa = rel === '/index.html' || extname(rel) === '';
    if (spa) {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': this.indexHtml.byteLength,
        'cache-control': 'no-store',
      });
      if (req.method !== 'HEAD') res.end(this.indexHtml);
      else res.end();
      return true;
    }

    const target = resolve(this.dist, `.${rel}`);
    const inside = relative(this.dist, target);
    if (inside.startsWith('..') || !existsSync(target) || !statSync(target).isFile()) {
      return false;
    }

    this.streamFile(res, target, req.method === 'HEAD');
    return true;
  }

  private streamFile(res: ServerResponse, file: string, headOnly: boolean): void {
    const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const size = statSync(file).size;
    const cache = extname(file) === '.html' ? 'no-store' : 'public, max-age=31536000, immutable';
    res.writeHead(200, {
      'content-type': type,
      'content-length': size,
      'cache-control': cache,
    });
    if (headOnly) {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  }
}
