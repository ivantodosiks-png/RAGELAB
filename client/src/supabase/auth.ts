import type { Session, User } from '@supabase/supabase-js';
import { EventBus } from '../core/eventBus';
import { supabase, supabaseConfigured } from './client';

export interface AuthEvents {
  changed: AuthState;
}

export interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  user: User | null;
  session: Session | null;
}

export interface AuthResult {
  ok: boolean;
  message?: string;
  /** True when the account was created but needs email confirmation. */
  needsConfirmation?: boolean;
}

/**
 * Thin wrapper over Supabase Auth. The access token it exposes is what the game
 * server verifies during the WebSocket handshake, so this is the single place
 * the client proves who it is.
 */
export class AuthService {
  readonly events = new EventBus<AuthEvents>();
  private state: AuthState = { status: 'loading', user: null, session: null };

  get current(): AuthState {
    return this.state;
  }

  get accessToken(): string | null {
    return this.state.session?.access_token ?? null;
  }

  get isSignedIn(): boolean {
    return this.state.status === 'signedIn';
  }

  async initialize(): Promise<AuthState> {
    if (!supabaseConfigured()) {
      this.setState({ status: 'signedOut', user: null, session: null });
      return this.state;
    }

    const { data } = await supabase().auth.getSession();
    this.setState(
      data.session
        ? { status: 'signedIn', user: data.session.user, session: data.session }
        : { status: 'signedOut', user: null, session: null },
    );

    supabase().auth.onAuthStateChange((_event, session) => {
      this.setState(
        session
          ? { status: 'signedIn', user: session.user, session }
          : { status: 'signedOut', user: null, session: null },
      );
    });

    return this.state;
  }

  async signUp(email: string, password: string, username: string): Promise<AuthResult> {
    if (!supabaseConfigured()) return { ok: false, message: 'Supabase is not configured' };
    const { data, error } = await supabase().auth.signUp({
      email,
      password,
      // The `handle_new_user` trigger reads this to seed the profile row.
      options: { data: { username } },
    });
    if (error) return { ok: false, message: error.message };
    if (!data.session) return { ok: true, needsConfirmation: true };
    return { ok: true };
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    if (!supabaseConfigured()) return { ok: false, message: 'Supabase is not configured' };
    const { error } = await supabase().auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  }

  async signOut(): Promise<void> {
    if (!supabaseConfigured()) return;
    await supabase().auth.signOut();
  }

  /** Refresh if the token is close to expiry, so joins never fail on a stale JWT. */
  async freshAccessToken(): Promise<string | null> {
    if (!this.state.session) return null;
    const expiresAt = this.state.session.expires_at ?? 0;
    const secondsLeft = expiresAt - Math.floor(Date.now() / 1000);
    if (secondsLeft > 60) return this.state.session.access_token;

    const { data, error } = await supabase().auth.refreshSession();
    if (error || !data.session) return this.state.session.access_token;
    this.setState({ status: 'signedIn', user: data.session.user, session: data.session });
    return data.session.access_token;
  }

  private setState(next: AuthState): void {
    this.state = next;
    this.events.emit('changed', next);
  }
}

export const authService = new AuthService();
