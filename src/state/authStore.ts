import {useEffect, useState} from 'react';
import {Storage} from './storage';

/**
 * AUTH STORE
 *
 * ============================ READ THIS FIRST ============================
 * THIS IS NOT REAL AUTHENTICATION. It is an offline, on-device demo flow.
 *
 * Tether has no backend and no auth endpoint, so there is nothing to verify a
 * password against. Passwords are checked for *shape* while the form is open
 * and then thrown away -- they are never stored, hashed or transmitted. Anyone
 * who knows a previously used email can "log in" on this device.
 *
 * That is a deliberate hackathon trade: it demonstrates the whole experience
 * with zero network dependency, which is what a live demo needs. Replacing it
 * with a real API means changing only the two marked functions below; the
 * screens, validation and persistence shape stay as they are.
 * =========================================================================
 *
 * Same shape as gamificationStore: a module-level store with subscriptions, so
 * no state library is needed and any React root can read it.
 */

export const AUTH_MODE: 'demo-local' | 'rest' = 'demo-local';

export type AuthUser = {
  name: string;
  email: string;
};

export type AuthState = {
  /** False until persisted state has been read, so we can avoid a UI flash. */
  initialized: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
};

/** Never throws. Screens render `message` inline; there is no error dialog. */
export type AuthResult = {ok: true} | {ok: false; message: string};

/* ------------------------------------------------------------------ */
/* Shared validation -- one source of truth for store and screens      */
/* ------------------------------------------------------------------ */

export const MIN_PASSWORD_LENGTH = 6;
export const MIN_NAME_LENGTH = 2;

/**
 * Deliberately permissive. Real address validity can only be proven by sending
 * mail to it, so anything stricter just rejects legitimate addresses.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const DEMO_USER: AuthUser = {
  name: 'Demo User',
  email: 'demo@tether.app',
};

/**
 * A short, deliberate pause so the button's loading state is perceptible
 * instead of flickering. Long enough to feel real, short enough not to annoy.
 */
const SETTLE_MS = 420;

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

let state: AuthState = {
  initialized: false,
  isAuthenticated: false,
  user: null,
};

/** Locally created accounts. Name + email only -- no credentials. */
let accounts: AuthUser[] = [];

const listeners = new Set<() => void>();

export function getAuthState(): AuthState {
  return state;
}

export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  listeners.forEach(l => {
    try {
      l();
    } catch {
      /* one bad listener must not break the others */
    }
  });
}

function commit(next: Partial<AuthState>): void {
  state = {...state, ...next};
  emit();
}

async function persistSession(user: AuthUser | null): Promise<void> {
  try {
    await Storage.setAuthSession(
      user ? JSON.stringify({...user, authenticated: true}) : '',
    );
  } catch {
    /* best effort; the in-memory session still works for this run */
  }
}

async function persistAccounts(): Promise<void> {
  try {
    await Storage.setAuthAccounts(JSON.stringify(accounts));
  } catch {
    /* best effort */
  }
}

function findAccount(email: string): AuthUser | undefined {
  const wanted = normalizeEmail(email);
  return accounts.find(a => normalizeEmail(a.email) === wanted);
}

function rememberAccount(user: AuthUser): void {
  if (!findAccount(user.email)) {
    accounts = [...accounts, user];
  } else {
    // Keep the latest name for a returning email.
    accounts = accounts.map(a =>
      normalizeEmail(a.email) === normalizeEmail(user.email) ? user : a,
    );
  }
}

const settle = () => new Promise<void>(r => setTimeout(r, SETTLE_MS));

/* ------------------------------------------------------------------ */
/* Hydration                                                           */
/* ------------------------------------------------------------------ */

function parseUser(raw: unknown): AuthUser | null {
  const obj = raw as Partial<AuthUser> & {authenticated?: unknown};
  if (
    !obj ||
    typeof obj.name !== 'string' ||
    typeof obj.email !== 'string' ||
    obj.authenticated !== true
  ) {
    return null;
  }
  return {name: obj.name, email: obj.email};
}

let initialized = false;

/**
 * Idempotent. Safe to call from a component effect and from module scope.
 * Always ends with `initialized: true`, even if storage fails, so the UI can
 * never be stuck on a splash screen.
 */
export function initializeAuth(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  (async () => {
    try {
      const [sessionRaw, accountsRaw] = await Promise.all([
        Storage.getAuthSession(),
        Storage.getAuthAccounts(),
      ]);

      if (accountsRaw) {
        const parsed = JSON.parse(accountsRaw);
        if (Array.isArray(parsed)) {
          accounts = parsed
            .map(a => parseUser({...a, authenticated: true}))
            .filter((a): a is AuthUser => a !== null);
        }
      }

      if (sessionRaw) {
        const user = parseUser(JSON.parse(sessionRaw));
        if (user) {
          commit({isAuthenticated: true, user});
        }
      }
    } catch {
      /* corrupt or missing state simply means "signed out" */
    } finally {
      commit({initialized: true});
    }
  })();
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

async function signIn(user: AuthUser): Promise<void> {
  rememberAccount(user);
  await persistAccounts();
  await persistSession(user);
  commit({isAuthenticated: true, user});
}

/**
 * REPLACE THIS to move to a real backend: POST the credentials, and on success
 * call signIn() with the profile the server returns. Everything else is UI.
 */
export async function login(
  email: string,
  password: string,
): Promise<AuthResult> {
  await settle();

  if (!isValidEmail(email)) {
    return {ok: false, message: 'Please enter a valid email address.'};
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  const existing = findAccount(email);
  if (!existing) {
    // Honest about being device-local rather than pretending to check a server.
    return {
      ok: false,
      message: 'No Tether account on this device for that email.',
    };
  }

  await signIn(existing);
  return {ok: true};
}

/**
 * REPLACE THIS to move to a real backend. Note what is absent: the password is
 * used for validation and then dropped. It is never persisted.
 */
export async function signUp(
  name: string,
  email: string,
  password: string,
): Promise<AuthResult> {
  await settle();

  if (name.trim().length < MIN_NAME_LENGTH) {
    return {ok: false, message: 'Please enter your name.'};
  }
  if (!isValidEmail(email)) {
    return {ok: false, message: 'Please enter a valid email address.'};
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  await signIn({name: name.trim(), email: email.trim()});
  return {ok: true};
}

/** The always-works path, for a demo with no typing and no network. */
export async function continueAsDemo(): Promise<AuthResult> {
  await signIn(DEMO_USER);
  return {ok: true};
}

/**
 * Clears the SESSION ONLY.
 *
 * Focus history, gamification points, the selected skin, the blocklist,
 * integrations and reminders all live under different keys and are deliberately
 * left untouched -- signing out is not a factory reset.
 */
export async function logout(): Promise<void> {
  await persistSession(null);
  commit({isAuthenticated: false, user: null});
}

/* ------------------------------------------------------------------ */
/* React hook                                                          */
/* ------------------------------------------------------------------ */

export function useAuth(): AuthState {
  const [snap, setSnap] = useState<AuthState>(getAuthState());

  useEffect(() => {
    // Self-initialising, like useGamification. Idempotent, so mounting this
    // from several places cannot hydrate twice.
    initializeAuth();
    setSnap(getAuthState());
    return subscribeAuth(() => setSnap(getAuthState()));
  }, []);

  return snap;
}
