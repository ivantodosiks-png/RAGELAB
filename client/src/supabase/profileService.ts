import type {
  CosmeticItem,
  InventoryEntry,
  PlayerStats,
  Profile,
  RoomSummary,
  UserSettings,
} from '@ragelab/shared';
import { isLobbyCode, normalizeLobbyCode } from '@ragelab/shared';
import type { LeaderboardEntry } from '../../../supabase/types/database';
import { supabase, supabaseConfigured } from './client';

export interface FullProfile {
  profile: Profile;
  stats: PlayerStats;
  settings: unknown;
  inventory: InventoryEntry[];
  cosmetics: CosmeticItem[];
}

export interface WeaponStatRow {
  weaponId: string;
  kills: number;
  shotsFired: number;
  shotsHit: number;
  headshots: number;
  damageDealt: number;
}

/** All account-related reads/writes the client is allowed to do. */
export class ProfileService {
  async loadFull(userId: string): Promise<FullProfile | null> {
    if (!supabaseConfigured()) return null;
    const db = supabase();

    const [profileRes, statsRes, settingsRes, inventoryRes, cosmeticsRes] = await Promise.all([
      db.from('profiles').select('*').eq('id', userId).maybeSingle(),
      db.from('player_stats').select('*').eq('profile_id', userId).maybeSingle(),
      db.from('player_settings').select('settings').eq('profile_id', userId).maybeSingle(),
      db.from('player_inventory').select('item_id, equipped, acquired_at').eq('profile_id', userId),
      db.from('cosmetic_items').select('*').order('unlock_level', { ascending: true }),
    ]);

    if (profileRes.error || !profileRes.data) return null;
    const row = profileRes.data;

    const cosmetics: CosmeticItem[] = (cosmeticsRes.data ?? []).map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      itemType: c.item_type,
      rarity: c.rarity,
      data: (c.data ?? {}) as Record<string, unknown>,
    }));
    const keyById = new Map(cosmetics.map((c) => [c.id, c.key]));

    const stats = statsRes.data;

    return {
      profile: {
        id: row.id,
        username: row.username,
        avatarUrl: row.avatar_url,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      stats: {
        profileId: userId,
        kills: stats?.kills ?? 0,
        deaths: stats?.deaths ?? 0,
        headshots: stats?.headshots ?? 0,
        shotsFired: stats?.shots_fired ?? 0,
        shotsHit: stats?.shots_hit ?? 0,
        matchesPlayed: stats?.matches_played ?? 0,
        wins: stats?.wins ?? 0,
        playtimeSeconds: stats?.playtime_seconds ?? 0,
        xp: stats?.xp ?? 0,
        level: stats?.level ?? 1,
        updatedAt: stats?.updated_at ?? row.updated_at,
      },
      settings: settingsRes.data?.settings ?? null,
      inventory: (inventoryRes.data ?? []).map((entry) => ({
        itemId: entry.item_id,
        itemKey: keyById.get(entry.item_id) ?? 'unknown',
        equipped: entry.equipped,
        acquiredAt: entry.acquired_at,
      })),
      cosmetics,
    };
  }

  async loadWeaponStats(userId: string): Promise<WeaponStatRow[]> {
    if (!supabaseConfigured()) return [];
    const { data, error } = await supabase()
      .from('player_weapon_stats')
      .select('*')
      .eq('profile_id', userId)
      .order('kills', { ascending: false });
    if (error || !data) return [];
    return data.map((r) => ({
      weaponId: r.weapon_id,
      kills: r.kills,
      shotsFired: r.shots_fired,
      shotsHit: r.shots_hit,
      headshots: r.headshots,
      damageDealt: r.damage_dealt,
    }));
  }

  async updateProfile(
    userId: string,
    patch: { username?: string; avatarUrl?: string | null; bio?: string | null },
  ): Promise<{ ok: boolean; message?: string }> {
    if (!supabaseConfigured()) return { ok: false, message: 'Supabase is not configured' };
    const { error } = await supabase()
      .from('profiles')
      .update({
        ...(patch.username !== undefined ? { username: patch.username } : {}),
        ...(patch.avatarUrl !== undefined ? { avatar_url: patch.avatarUrl } : {}),
        ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
      })
      .eq('id', userId);
    if (error) {
      const duplicate = error.code === '23505' || /duplicate|unique/i.test(error.message);
      return { ok: false, message: duplicate ? 'That username is taken' : error.message };
    }
    return { ok: true };
  }

  async saveSettings(userId: string, settings: UserSettings): Promise<void> {
    if (!supabaseConfigured()) return;
    await supabase()
      .from('player_settings')
      .upsert({ profile_id: userId, settings: settings as never }, { onConflict: 'profile_id' });
  }

  async equipCosmetic(userId: string, itemId: string): Promise<void> {
    if (!supabaseConfigured()) return;
    await supabase()
      .from('player_inventory')
      .update({ equipped: true })
      .eq('profile_id', userId)
      .eq('item_id', itemId);
  }

  async leaderboard(limit = 25): Promise<LeaderboardEntry[]> {
    if (!supabaseConfigured()) return [];
    const { data, error } = await supabase().rpc('leaderboard', { p_limit: limit });
    if (error || !data) return [];
    return data;
  }

  /** Server browser data, mirrored into Supabase by the game server. */
  async activeServers(): Promise<RoomSummary[]> {
    if (!supabaseConfigured()) return [];
    const { data, error } = await supabase().rpc('active_servers', { p_stale_seconds: 45 });
    if (error || !data) return [];
    return data.map((row) => this.rowToRoom(row));
  }

  /** Resolve a shareable lobby code to a live room + public websocket. */
  async findLobby(code: string): Promise<RoomSummary | null> {
    if (!supabaseConfigured()) return null;
    const normalized = normalizeLobbyCode(code);
    if (!isLobbyCode(normalized)) return null;

    const { data, error } = await supabase().rpc('find_lobby', { p_code: normalized });
    if (!error && data && data.length > 0) return this.rowToRoom(data[0]!);

    const fallback = await supabase()
      .from('game_servers')
      .select('*')
      .eq('join_code', normalized)
      .maybeSingle();
    if (fallback.error || !fallback.data) return null;
    return this.rowToRoom(fallback.data);
  }

  private rowToRoom(row: {
    id: string;
    name: string;
    map_id: string;
    mode: string;
    player_count: number;
    max_players: number;
    has_password: boolean;
    region: string;
    tick_ms: number;
    created_at: string;
    ws_url: string | null;
    join_code: string | null;
  }): RoomSummary {
    return {
      id: row.id.includes(':') ? row.id.slice(row.id.indexOf(':') + 1) : row.id,
      name: row.name,
      mapId: row.map_id,
      mode: row.mode === 'deathmatch' ? 'deathmatch' : 'sandbox',
      playerCount: row.player_count,
      maxPlayers: row.max_players,
      hasPassword: row.has_password,
      region: row.region,
      tickMs: row.tick_ms,
      createdAt: new Date(row.created_at).getTime(),
      wsUrl: row.ws_url || undefined,
      joinCode: row.join_code || undefined,
    };
  }

  async reportPlayer(
    reporterId: string,
    targetId: string,
    reason: string,
  ): Promise<{ ok: boolean; message?: string }> {
    if (!supabaseConfigured()) return { ok: false, message: 'Supabase is not configured' };
    const { error } = await supabase()
      .from('reports')
      .insert({ reporter_id: reporterId, target_id: targetId, reason });
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  }
}

export const profileService = new ProfileService();
