/**
 * Typed view of the RAGELAB Postgres schema.
 *
 * Kept in sync with supabase/migrations by hand so the repo has no dependency
 * on the Supabase CLI. To regenerate from a live database instead:
 *   npx supabase gen types typescript --project-id <ref> > supabase/types/database.ts
 *
 * The shape (Row/Insert/Update/Relationships per table) is what
 * `@supabase/postgrest-js` expects; deviating from it silently degrades every
 * query result to `never`.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          avatar_url: string | null;
          bio: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          username: string;
          avatar_url?: string | null;
          bio?: string | null;
        };
        Update: {
          username?: string;
          avatar_url?: string | null;
          bio?: string | null;
        };
        Relationships: [];
      };

      staff: {
        Row: {
          profile_id: string;
          role: string;
          created_at: string;
        };
        Insert: { profile_id: string; role?: string };
        Update: { role?: string };
        Relationships: [
          {
            foreignKeyName: 'staff_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };

      player_stats: {
        Row: {
          profile_id: string;
          kills: number;
          deaths: number;
          assists: number;
          headshots: number;
          shots_fired: number;
          shots_hit: number;
          damage_dealt: number;
          matches_played: number;
          wins: number;
          playtime_seconds: number;
          xp: number;
          level: number;
          longest_killstreak: number;
          updated_at: string;
        };
        Insert: { profile_id: string };
        Update: {
          kills?: number;
          deaths?: number;
          assists?: number;
          headshots?: number;
          shots_fired?: number;
          shots_hit?: number;
          damage_dealt?: number;
          matches_played?: number;
          wins?: number;
          playtime_seconds?: number;
          xp?: number;
          level?: number;
          longest_killstreak?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'player_stats_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };

      player_weapon_stats: {
        Row: {
          profile_id: string;
          weapon_id: string;
          kills: number;
          shots_fired: number;
          shots_hit: number;
          headshots: number;
          damage_dealt: number;
          updated_at: string;
        };
        Insert: { profile_id: string; weapon_id: string };
        Update: {
          kills?: number;
          shots_fired?: number;
          shots_hit?: number;
          headshots?: number;
          damage_dealt?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'player_weapon_stats_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };

      player_settings: {
        Row: { profile_id: string; settings: Json; updated_at: string };
        Insert: { profile_id: string; settings?: Json };
        Update: { settings?: Json };
        Relationships: [
          {
            foreignKeyName: 'player_settings_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };

      cosmetic_items: {
        Row: {
          id: string;
          key: string;
          name: string;
          item_type: string;
          rarity: 'common' | 'rare' | 'epic' | 'legendary';
          data: Json;
          unlock_level: number;
          created_at: string;
        };
        Insert: {
          key: string;
          name: string;
          item_type: string;
          rarity?: 'common' | 'rare' | 'epic' | 'legendary';
          data?: Json;
          unlock_level?: number;
        };
        Update: {
          key?: string;
          name?: string;
          item_type?: string;
          rarity?: 'common' | 'rare' | 'epic' | 'legendary';
          data?: Json;
          unlock_level?: number;
        };
        Relationships: [];
      };

      player_inventory: {
        Row: {
          profile_id: string;
          item_id: string;
          equipped: boolean;
          acquired_at: string;
        };
        Insert: { profile_id: string; item_id: string; equipped?: boolean };
        Update: { equipped?: boolean };
        Relationships: [
          {
            foreignKeyName: 'player_inventory_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'player_inventory_item_id_fkey';
            columns: ['item_id'];
            isOneToOne: false;
            referencedRelation: 'cosmetic_items';
            referencedColumns: ['id'];
          },
        ];
      };

      game_servers: {
        Row: {
          id: string;
          name: string;
          region: string;
          map_id: string;
          mode: string;
          player_count: number;
          max_players: number;
          has_password: boolean;
          tick_ms: number;
          ws_url: string | null;
          join_code: string | null;
          created_at: string;
          heartbeat_at: string;
        };
        Insert: {
          id: string;
          name: string;
          map_id: string;
          region?: string;
          mode?: string;
          player_count?: number;
          max_players?: number;
          has_password?: boolean;
          tick_ms?: number;
          ws_url?: string | null;
          join_code?: string | null;
          heartbeat_at?: string;
        };
        Update: {
          name?: string;
          region?: string;
          map_id?: string;
          mode?: string;
          player_count?: number;
          max_players?: number;
          has_password?: boolean;
          tick_ms?: number;
          ws_url?: string | null;
          join_code?: string | null;
          heartbeat_at?: string;
        };
        Relationships: [];
      };

      matches: {
        Row: {
          id: string;
          room_id: string;
          map_id: string;
          mode: string;
          started_at: string;
          ended_at: string | null;
          winner_id: string | null;
        };
        Insert: {
          room_id: string;
          map_id: string;
          mode?: string;
          started_at?: string;
        };
        Update: { ended_at?: string | null; winner_id?: string | null };
        Relationships: [
          {
            foreignKeyName: 'matches_winner_id_fkey';
            columns: ['winner_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };

      match_participants: {
        Row: {
          match_id: string;
          profile_id: string;
          kills: number;
          deaths: number;
          score: number;
          headshots: number;
          damage_dealt: number;
          playtime_seconds: number;
        };
        Insert: {
          match_id: string;
          profile_id: string;
          kills?: number;
          deaths?: number;
          score?: number;
          headshots?: number;
          damage_dealt?: number;
          playtime_seconds?: number;
        };
        Update: {
          kills?: number;
          deaths?: number;
          score?: number;
          headshots?: number;
          damage_dealt?: number;
          playtime_seconds?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'match_participants_match_id_fkey';
            columns: ['match_id'];
            isOneToOne: false;
            referencedRelation: 'matches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'match_participants_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };

      bans: {
        Row: {
          id: string;
          profile_id: string;
          reason: string;
          expires_at: string | null;
          created_at: string;
          created_by: string;
        };
        Insert: {
          profile_id: string;
          reason: string;
          expires_at?: string | null;
          created_by?: string;
        };
        Update: { reason?: string; expires_at?: string | null };
        Relationships: [
          {
            foreignKeyName: 'bans_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };

      reports: {
        Row: {
          id: string;
          reporter_id: string;
          target_id: string;
          reason: string;
          match_id: string | null;
          status: 'open' | 'reviewed' | 'dismissed';
          created_at: string;
        };
        Insert: {
          reporter_id: string;
          target_id: string;
          reason: string;
          match_id?: string | null;
        };
        Update: { status?: 'open' | 'reviewed' | 'dismissed' };
        Relationships: [
          {
            foreignKeyName: 'reports_reporter_id_fkey';
            columns: ['reporter_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reports_target_id_fkey';
            columns: ['target_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };

    Views: {
      [_ in never]: never;
    };

    Functions: {
      apply_player_stats: {
        Args: {
          p_profile_id: string;
          p_kills?: number;
          p_deaths?: number;
          p_headshots?: number;
          p_shots_fired?: number;
          p_shots_hit?: number;
          p_damage_dealt?: number;
          p_playtime_seconds?: number;
          p_matches_played?: number;
          p_wins?: number;
          p_killstreak?: number;
        };
        Returns: Database['public']['Tables']['player_stats']['Row'];
      };
      apply_weapon_stats: {
        Args: {
          p_profile_id: string;
          p_weapon_id: string;
          p_kills?: number;
          p_shots_fired?: number;
          p_shots_hit?: number;
          p_headshots?: number;
          p_damage_dealt?: number;
        };
        Returns: undefined;
      };
      is_banned: { Args: { p_profile_id: string }; Returns: boolean };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      admin_bootstrap: { Args: Record<PropertyKey, never>; Returns: boolean };
      my_active_ban: {
        Args: Record<PropertyKey, never>;
        Returns: Array<{ reason: string; created_at: string; expires_at: string | null }>;
      };
      admin_list_users: {
        Args: Record<PropertyKey, never>;
        Returns: Array<{
          profile_id: string;
          username: string;
          email: string | null;
          created_at: string;
          level: number;
          kills: number;
          deaths: number;
          banned: boolean;
          ban_reason: string | null;
          is_admin: boolean;
        }>;
      };
      admin_ban: { Args: { p_profile_id: string; p_reason: string }; Returns: undefined };
      admin_unban: { Args: { p_profile_id: string }; Returns: undefined };
      leaderboard: {
        Args: { p_limit?: number };
        Returns: Array<{
          profile_id: string;
          username: string;
          avatar_url: string | null;
          kills: number;
          deaths: number;
          level: number;
          kd: number;
        }>;
      };
      active_servers: {
        Args: { p_stale_seconds?: number };
        Returns: Database['public']['Tables']['game_servers']['Row'][];
      };
      find_lobby: {
        Args: { p_code: string };
        Returns: Database['public']['Tables']['game_servers']['Row'][];
      };
      grant_default_cosmetics: { Args: { p_profile_id: string }; Returns: undefined };
      sync_cosmetic_unlocks: { Args: { p_profile_id: string }; Returns: number };
    };

    Enums: {
      [_ in never]: never;
    };

    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

export type ProfileRow = Database['public']['Tables']['profiles']['Row'];
export type PlayerStatsRow = Database['public']['Tables']['player_stats']['Row'];
export type PlayerWeaponStatsRow = Database['public']['Tables']['player_weapon_stats']['Row'];
export type PlayerSettingsRow = Database['public']['Tables']['player_settings']['Row'];
export type CosmeticItemRow = Database['public']['Tables']['cosmetic_items']['Row'];
export type InventoryRow = Database['public']['Tables']['player_inventory']['Row'];
export type GameServerRow = Database['public']['Tables']['game_servers']['Row'];
export type MatchRow = Database['public']['Tables']['matches']['Row'];
export type ReportRow = Database['public']['Tables']['reports']['Row'];
export type LeaderboardEntry = Database['public']['Functions']['leaderboard']['Returns'][number];
