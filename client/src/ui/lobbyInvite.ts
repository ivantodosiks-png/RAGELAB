import { isLobbyCode, normalizeLobbyCode } from '@ragelab/shared';
import { isPublicGameServerUrl } from '../supabase/client';

export interface LobbyInvite {
  code: string;
  wsUrl?: string;
}

export function parseLobbyInvite(): LobbyInvite | null {
  const query = new URLSearchParams(window.location.search);
  const code = normalizeLobbyCode(query.get('join') || query.get('code') || '');
  if (!isLobbyCode(code)) return null;
  const ws = query.get('ws') || query.get('server') || undefined;
  return { code, wsUrl: ws || undefined };
}

export function lobbyInviteUrl(code: string, wsUrl?: string | null): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('join', normalizeLobbyCode(code));
  if (wsUrl && isPublicGameServerUrl(wsUrl)) {
    url.searchParams.set('ws', wsUrl);
  }
  return url.toString();
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
