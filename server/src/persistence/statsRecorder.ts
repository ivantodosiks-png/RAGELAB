import { log } from '../logger';
import { serviceClient } from '../auth/supabase';
import type { PlayerEntity } from '../game/playerEntity';

/**
 * Flush one play session to Supabase.
 *
 * Everything goes through `apply_player_stats` / `apply_weapon_stats`, which are
 * additive SQL functions. That keeps the write idempotent-ish under retries and
 * means the client can never author its own progression.
 */
export async function flushSession(
  entity: PlayerEntity,
  sessionEndMs: number,
  countMatch: boolean,
): Promise<void> {
  const client = serviceClient();
  if (!client) return;
  const profileId = entity.identity.profileId;
  if (!profileId || entity.identity.isGuest) return;

  const stats = entity.stats;
  const playtimeSeconds = Math.max(0, Math.round((sessionEndMs - stats.joinedAt) / 1000));

  const nothingHappened =
    stats.kills === 0 &&
    stats.deaths === 0 &&
    stats.shotsFired === 0 &&
    playtimeSeconds < 5;
  if (nothingHappened) return;

  try {
    const { error } = await client.rpc('apply_player_stats', {
      p_profile_id: profileId,
      p_kills: stats.kills,
      p_deaths: stats.deaths,
      p_headshots: stats.headshots,
      p_shots_fired: stats.shotsFired,
      p_shots_hit: stats.shotsHit,
      p_damage_dealt: Math.round(stats.damageDealt),
      p_playtime_seconds: playtimeSeconds,
      p_matches_played: countMatch ? 1 : 0,
      p_wins: 0,
      p_killstreak: stats.bestKillstreak,
    });
    if (error) throw new Error(error.message);

    for (const [weaponId, w] of stats.weapon) {
      if (w.shotsFired === 0 && w.kills === 0) continue;
      const { error: weaponError } = await client.rpc('apply_weapon_stats', {
        p_profile_id: profileId,
        p_weapon_id: weaponId,
        p_kills: w.kills,
        p_shots_fired: w.shotsFired,
        p_shots_hit: w.shotsHit,
        p_headshots: w.headshots,
        p_damage_dealt: Math.round(w.damage),
      });
      if (weaponError) {
        log.warn('weapon stat flush failed', { weaponId, message: weaponError.message });
      }
    }

    // Level ups may have unlocked cosmetics.
    const { error: unlockError } = await client.rpc('sync_cosmetic_unlocks', {
      p_profile_id: profileId,
    });
    if (unlockError) {
      log.debug('cosmetic unlock sync failed', { message: unlockError.message });
    }

    log.info('session stats flushed', {
      profileId,
      kills: stats.kills,
      deaths: stats.deaths,
      playtimeSeconds,
    });
  } catch (err) {
    log.warn('session stats flush failed', {
      profileId,
      message: (err as Error).message,
    });
  }
}
