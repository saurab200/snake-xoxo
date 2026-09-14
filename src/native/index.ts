import {DeviceEventEmitter, NativeModules} from 'react-native';

const {
  TetherFocus,
  TetherOverlay,
  TetherBlocking,
  TetherPermissions,
  TetherReminders,
} = NativeModules;

/* ------------------------------------------------------------------ */
/* THE SHARED CONTRACT -- agree on this before splitting up            */
/* ------------------------------------------------------------------ */

export type FocusState = {
  isActive: boolean;
  durationMinutes: number;
  endAtMs: number;
  remainingMs: number;
  remainingMinutes: number;
  /**
   * Optional completion flag. The native layer does not currently set this on
   * its session-end event, but the gamification dev simulation does, and JS
   * consumers may read it when present. Absence is treated as "unknown" and the
   * gamification store infers completion from the last observed tick instead.
   */
  completedSuccessfully?: boolean;
};

export type LockoutState = {
  isLockedOut: boolean;
  lockoutUntilMs: number;
  lockoutRemainingMs: number;
  lockoutLabel: string | null;
};

export type Reminder = {
  id: string;
  title: string;
  dueAtMs: number;
  /** How long the total lockout lasts once this falls due. */
  lockMinutes: number;
  fired: boolean;
};

export type InstalledApp = {
  packageName: string;
  label: string;
};

export type PermissionStatus = {
  overlay: boolean;
  accessibility: boolean;
  notifications: boolean;
};

/* ------------------------------------------------------------------ */
/* Person A -- timer + session                                         */
/* ------------------------------------------------------------------ */

export const Focus = {
  /** Start the foreground service. Call after permissions are granted. */
  arm: (): Promise<boolean> => TetherFocus.arm(),
  disarm: (): Promise<boolean> => TetherFocus.disarm(),

  /** False after the kill switch, until the user explicitly brings it back. */
  isArmed: (): Promise<boolean> => TetherFocus.isArmed(),

  startSession: (minutes: number, blocklist: string[]): Promise<FocusState> =>
    TetherFocus.startSession(minutes, blocklist),

  stopSession: (): Promise<FocusState> => TetherFocus.stopSession(),

  getState: (): Promise<FocusState> => TetherFocus.getState(),

  setBlocklist: (blocklist: string[]): Promise<boolean> =>
    TetherFocus.setBlocklist(blocklist),

  setWidgetTriggers: (packages: string[]): Promise<boolean> =>
    TetherFocus.setWidgetTriggers(packages),
};

/* ------------------------------------------------------------------ */
/* Person A + C -- floating windows                                    */
/* ------------------------------------------------------------------ */

export type OverlayOptions = {
  /** dp, or Overlay.MATCH_PARENT / Overlay.WRAP_CONTENT */
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  gravity?:
    | 'top'
    | 'bottom'
    | 'center'
    | 'topLeft'
    | 'topRight'
    | 'bottomLeft'
    | 'bottomRight';
  /** true => this window can take key input (e.g. swallow the back button) */
  focusable?: boolean;
  /** true => taps outside this window reach the app underneath */
  touchThrough?: boolean;
};

export const Overlay = {
  MATCH_PARENT: TetherOverlay?.MATCH_PARENT ?? -1,
  WRAP_CONTENT: TetherOverlay?.WRAP_CONTENT ?? -2,

  /**
   * `name` must match a component registered via AppRegistry in index.js.
   * Calling show() on something already visible just updates its props.
   */
  show: (
    name: string,
    options?: OverlayOptions,
    props?: Record<string, unknown>,
  ): Promise<boolean> =>
    TetherOverlay.show(name, options ?? null, props ?? null),

  /** Resize/move without remounting React -- component state survives. */
  setLayout: (name: string, options: OverlayOptions): Promise<boolean> =>
    TetherOverlay.setLayout(name, options),

  update: (name: string, props: Record<string, unknown>): Promise<boolean> =>
    TetherOverlay.update(name, props),

  hide: (name: string): Promise<boolean> => TetherOverlay.hide(name),
  hideAll: (): Promise<boolean> => TetherOverlay.hideAll(),
  isShowing: (name: string): Promise<boolean> => TetherOverlay.isShowing(name),
};

/* ------------------------------------------------------------------ */
/* Reminders + total lockout                                           */
/* ------------------------------------------------------------------ */

export const RemindersApi = {
  list: (): Promise<Reminder[]> => TetherReminders.list(),

  add: (input: {
    title: string;
    dueAtMs: number;
    lockMinutes: number;
  }): Promise<boolean> => TetherReminders.add(input),

  remove: (id: string): Promise<boolean> => TetherReminders.remove(id),

  getLockout: (): Promise<LockoutState> => TetherReminders.getLockout(),

  /** Manual trigger, for demoing lockout without waiting for a due date. */
  startLockout: (minutes: number, label?: string): Promise<boolean> =>
    TetherReminders.startLockout(minutes, label ?? null),

  stopLockout: (): Promise<boolean> => TetherReminders.stopLockout(),
};

/* ------------------------------------------------------------------ */
/* Person B -- blocking                                                */
/* ------------------------------------------------------------------ */

export const Blocking = {
  isAccessibilityEnabled: (): Promise<boolean> =>
    TetherBlocking.isAccessibilityEnabled(),
  openAccessibilitySettings: (): Promise<boolean> =>
    TetherBlocking.openAccessibilitySettings(),
  getInstalledApps: (): Promise<InstalledApp[]> =>
    TetherBlocking.getInstalledApps(),
  getSuggestedBlocklist: (): Promise<string[]> =>
    TetherBlocking.getSuggestedBlocklist(),
  openBatteryOptimizationSettings: (): Promise<boolean> =>
    TetherBlocking.openBatteryOptimizationSettings(),

  /**
   * Device Owner unlocks the strongest blocking mode: blocked apps vanish from
   * the launcher entirely instead of being covered by an overlay.
   */
  isDeviceOwner: (): Promise<boolean> => TetherBlocking.isDeviceOwner(),
  getHiddenCount: (): Promise<number> => TetherBlocking.getHiddenCount(),
  restoreHiddenApps: (): Promise<boolean> =>
    TetherBlocking.restoreHiddenApps(),
};

/* ------------------------------------------------------------------ */
/* Permissions (all of them are settings screens, not dialogs)         */
/* ------------------------------------------------------------------ */

export const Permissions = {
  getStatus: (): Promise<PermissionStatus> => TetherPermissions.getStatus(),
  openOverlaySettings: (): Promise<boolean> =>
    TetherPermissions.openOverlaySettings(),
  openAccessibilitySettings: (): Promise<boolean> =>
    TetherPermissions.openAccessibilitySettings(),
  openNotificationSettings: (): Promise<boolean> =>
    TetherPermissions.openNotificationSettings(),
};

/* ------------------------------------------------------------------ */
/* Events emitted from native                                          */
/* ------------------------------------------------------------------ */

export type TickEvent = {remainingMs: number; remainingMinutes: number};
export type SessionEvent = FocusState;
export type ForegroundAppEvent = {packageName: string; blocked: boolean};

export const TetherEvents = {
  onTick: (fn: (e: TickEvent) => void) =>
    DeviceEventEmitter.addListener('tether:tick', fn),

  onSessionChanged: (fn: (e: SessionEvent) => void) =>
    DeviceEventEmitter.addListener('tether:session', fn),

  /** Person B produces this; Person C consumes it. */
  onForegroundApp: (fn: (e: ForegroundAppEvent) => void) =>
    DeviceEventEmitter.addListener('tether:foregroundApp', fn),

  onLockoutChanged: (fn: (e: LockoutState) => void) =>
    DeviceEventEmitter.addListener('tether:lockout', fn),

  onRemindersChanged: (fn: () => void) =>
    DeviceEventEmitter.addListener('tether:reminders', fn),
};

/** True when the native side is actually linked (i.e. not a stale JS-only build). */
export const isNativeReady = Boolean(TetherFocus && TetherOverlay);
