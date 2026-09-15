import {useEffect, useState} from 'react';
import {Storage} from './storage';

/**
 * AUTH STORE
 *
 * ============================ READ THIS FIRST ============================
 * THIS IS NOT REAL AUTHENTICATION. It is an offline, on-device identity.
 *
 * Tether has no backend, so there is nothing to verify anyone against. The user
 * types an email and is signed in -- there is no password, because a password
 * checked only against the device it was typed on proves nothing and would be
 * security theatre. Anyone holding the phone is the account holder.
 *
 * What this DOES buy: a name and an email to hang a profile and a leaderboard
 * row on, persisted across restarts, with zero network dependency.
 *
 * Moving to a real backend means changing one function -- continueWithEmail --
 * to POST the address, verify it (a link or a code), and call signIn() with the
 * profile the server returns. Everything else here stays as it is.
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

/**
 * Deliberately permissive, and NO domain restriction.
 *
 * University and work addresses are the expected case, but personal ones are
 * accepted too: an allowlist would reject legitimate users, and a denylist of
 * free providers is trivially worked around. Real address validity can only be
 * proven by sending mail to it, which needs a backend we do not have.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * A display name from the address, for when the user does not give us one.
 *
 *   ada.lovelace@uni.edu  ->  Ada Lovelace
 *   saurab200@gmail.com   ->  Saurab200
 *
 * A decent guess, and wrong for plenty of addresses -- which is why the sign-in
 * screen offers a Name field and only falls back to this when it is left blank.
 *
 * Only ever cosmetic -- it is what the leaderboard shows. The email remains the
 * identity.
 */
export function displayNameFor(email: string): string {
  const local = normalizeEmail(email).split('@')[0] ?? '';
  const words = local
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(' ') || 'You';
}

/**
 * Long enough for anyone's real name, short enough that a paste accident does
 * not become a leaderboard row. There is no backend to satisfy, so this is the
 * only limit.
 */
const MAX_NAME_LENGTH = 60;

/** Trimmed and capped; empty means "the user left the field blank". */
export function normalizeName(name: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH);
}

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

/**
 * The name this address would end up with if the Name field is left blank: the
 * stored one for an account this device has seen, otherwise a guess from the
 * address.
 *
 * Exported so the sign-in screen can show it as the Name placeholder and be
 * telling the truth -- a returning user keeps the name they already chose, not
 * whatever displayNameFor() would have made up.
 */
export function fallbackNameFor(email: string): string {
  return findAccount(email)?.name ?? displayNameFor(email);
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
 * The one way in: an email, and you are signed in.
 *
 * Signs into the existing account for that address if this device has seen it
 * before, so points and profile survive a sign-out; otherwise creates one.
 * There is no separate sign-up and log-in because without a server there is
 * nothing to tell them apart.
 *
 * `name` is optional -- the screen never makes the user type one. Blank falls
 * back to the returning account's stored name, or to displayNameFor(email) for
 * a first sign-in. A name that IS typed always wins, including for a returning
 * user: renaming yourself should not require a way to clear local storage, and
 * only the name changes -- the account, and so the points, are the same one.
 *
 * REPLACE THIS to move to a real backend -- verify the address, then call
 * signIn() with the profile the server returns.
 */
export async function continueWithEmail(
  email: string,
  name = '',
): Promise<AuthResult> {
  await settle();

  if (!isValidEmail(email)) {
    return {ok: false, message: 'Please enter a valid email address.'};
  }

  const typed = normalizeName(name);

  await signIn({
    name: typed || fallbackNameFor(email),
    email: normalizeEmail(email),
  });
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
