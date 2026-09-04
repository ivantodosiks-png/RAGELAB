import { log } from '../logger';
import { config } from '../config';
import { serviceClient } from '../auth/supabase';

export interface LoadedProfile {
  id: string;
  username: string;
  avatarUrl: string | null;
  level: number;
  banned: boolean;
  banReason: string | null;
  isAdmin: boolean;
}

/**
 * Load the account row for an authenticated user. The profile is created by a
 * Postgres trigger on signup, so a missing row means something went wrong
 * upstream rather than "new player".
 */
export async function loadProfile(userId: string): Promise<LoadedProfile | null> {
  const client = serviceClient();
  if (!client) return null;

  const [{ data: profile, error: profileError }, banResult, statsResult, staffResult] = await Promise.all([
    client.from('profiles').select('id, username, avatar_url').eq('id', userId).maybeSingle(),
    client
      .from('bans')
      .select('reason, expires_at')
      .eq('profile_id', userId)
      .order('created_at', { ascending: false })
      .limit(5),
    client.from('player_stats').select('level').eq('profile_id', userId).maybeSingle(),
    client.from('staff').select('profile_id').eq('profile_id', userId).maybeSingle(),
  ]);

  if (profileError) {
    log.warn('failed to load profile', { userId, message: profileError.message });
    return null;
  }
  if (!profile) return null;

  let banned = false;
  let banReason: string | null = null;
  for (const ban of banResult.data ?? []) {
    if (ban.expires_at === null || new Date(ban.expires_at).getTime() > Date.now()) {
      banned = true;
      banReason = ban.reason;
      break;
    }
  }

  return {
    id: profile.id,
    username: profile.username,
    avatarUrl: profile.avatar_url,
    level: statsResult.data?.level ?? 1,
    banned,
    banReason,
    isAdmin: Boolean(staffResult.data),
  };
}

export async function grantAdminIfListed(userId: string, email: string | null): Promise<void> {
  if (!email || config.adminEmails.length === 0) return;
  if (!config.adminEmails.includes(email.trim().toLowerCase())) return;
  const client = serviceClient();
  if (!client) return;
  const { error } = await client.from('staff').upsert({ profile_id: userId, role: 'admin' }, { onConflict: 'profile_id' });
  if (error) log.warn('failed to grant admin', { userId, message: error.message });
}
