import type { RoomSummary } from '@ragelab/shared';
import { config } from '../config';
import { log } from '../logger';
import { serviceClient } from '../auth/supabase';

/**
 * Mirrors live room state into `public.game_servers` so the client's server
 * browser can be a plain Supabase query instead of a custom discovery service.
 * Rows are keyed by `<instanceId>:<roomId>` and pruned on shutdown.
 */
export class ServerRegistry {
  private known = new Set<string>();
  private failures = 0;

  private get enabled(): boolean {
    return config.persist && serviceClient() !== null;
  }

  private rowId(roomId: string): string {
    return `${config.instanceId}:${roomId}`;
  }

  async heartbeat(rooms: RoomSummary[]): Promise<void> {
    if (!this.enabled || this.failures > 5) return;
    const client = serviceClient()!;
    const publicUrl = config.publicWsUrl || null;
    if (!publicUrl) {
      if (this.known.size > 0) await this.unregisterAll();
      return;
    }

    const rows = rooms.map((room) => ({
      id: this.rowId(room.id),
      name: room.name,
      region: config.region,
      map_id: room.mapId,
      mode: room.mode,
      player_count: room.playerCount,
      max_players: room.maxPlayers,
      has_password: room.hasPassword,
      tick_ms: room.tickMs,
      ws_url: publicUrl,
      heartbeat_at: new Date().toISOString(),
    }));

    try {
      if (rows.length > 0) {
        const { error } = await client.from('game_servers').upsert(rows, { onConflict: 'id' });
        if (error) throw new Error(error.message);
        for (const row of rows) this.known.add(row.id);
      }

      // Remove rows for rooms that no longer exist.
      const live = new Set(rows.map((r) => r.id));
      const stale = [...this.known].filter((id) => !live.has(id));
      if (stale.length > 0) {
        const { error } = await client.from('game_servers').delete().in('id', stale);
        if (error) throw new Error(error.message);
        for (const id of stale) this.known.delete(id);
      }
      this.failures = 0;
    } catch (err) {
      this.failures += 1;
      log.warn('server registry heartbeat failed', {
        attempt: this.failures,
        message: (err as Error).message,
      });
    }
  }

  async unregisterAll(): Promise<void> {
    if (!this.enabled || this.known.size === 0) return;
    const client = serviceClient()!;
    try {
      await client.from('game_servers').delete().in('id', [...this.known]);
      this.known.clear();
      log.info('server registry cleaned up');
    } catch (err) {
      log.warn('server registry cleanup failed', { message: (err as Error).message });
    }
  }
}
