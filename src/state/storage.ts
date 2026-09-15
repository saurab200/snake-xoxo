import {NativeModules} from 'react-native';

const {TetherStorage} = NativeModules;

/**
 * Backed by Android SharedPreferences via TetherStorage, NOT AsyncStorage.
 *
 * Why: the AccessibilityService needs the blocklist at boot, before any JS has
 * run. Keeping it in native prefs means blocking works on a cold start.
 */

const KEYS = {
  blocklist: 'blocklist',
  canvasToken: 'canvas.token',
  canvasHost: 'canvas.host',
  gamification: 'gamification.state',
  authSession: 'auth.session',
  authAccounts: 'auth.accounts',
} as const;

export const Storage = {
  getBlocklist: (): Promise<string[]> =>
    TetherStorage.getStringArray(KEYS.blocklist),

  setBlocklist: (list: string[]): Promise<boolean> =>
    TetherStorage.setStringArray(KEYS.blocklist, list),

  getCanvasToken: (): Promise<string | null> =>
    TetherStorage.getItem(KEYS.canvasToken),

  setCanvasToken: (token: string): Promise<boolean> =>
    TetherStorage.setItem(KEYS.canvasToken, token),

  getCanvasHost: (): Promise<string | null> =>
    TetherStorage.getItem(KEYS.canvasHost),

  setCanvasHost: (host: string): Promise<boolean> =>
    TetherStorage.setItem(KEYS.canvasHost, host),

  /**
   * Gamification snapshot, persisted as a single JSON blob (points + active
   * skin + credited-session dedup metadata). One key keeps it atomic.
   */
  getGamification: (): Promise<string | null> =>
    TetherStorage.getItem(KEYS.gamification),

  setGamification: (json: string): Promise<boolean> =>
    TetherStorage.setItem(KEYS.gamification, json),

  /**
   * Signed-in session: name, email, authenticated. NEVER a password.
   *
   * Written as '' to clear, because TetherStorage has no remove() -- readers
   * treat an empty string the same as absent.
   */
  getAuthSession: (): Promise<string | null> =>
    TetherStorage.getItem(KEYS.authSession),

  setAuthSession: (json: string): Promise<boolean> =>
    TetherStorage.setItem(KEYS.authSession, json),

  /**
   * Locally created demo accounts (name + email only), kept separately from the
   * session so that logging out does not forget who signed up.
   */
  getAuthAccounts: (): Promise<string | null> =>
    TetherStorage.getItem(KEYS.authAccounts),

  setAuthAccounts: (json: string): Promise<boolean> =>
    TetherStorage.setItem(KEYS.authAccounts, json),
};
