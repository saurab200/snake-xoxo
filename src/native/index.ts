import {DeviceEventEmitter, NativeModules} from 'react-native';

const {
  TetherFocus,
  TetherOverlay,
  TetherBlocking,
  TetherPermissions,
  TetherReminders,
  TetherClock,
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
    | 'bottomRight'
    | 'left'
    | 'right';
  /** true => this window can take key input (e.g. swallow the back button) */
  focusable?: boolean;
  /** true => taps outside this window reach the app underneath */
  touchThrough?: boolean;
  /**
   * false => the window is invisible to touch (FLAG_NOT_TOUCHABLE).
   *
   * `touchThrough` only forwards taps that land OUTSIDE the window; every touch
   * inside it is swallowed whether or not a component handles it. A full-screen
   * decorative overlay must therefore set this false, or it makes the whole
   * phone unresponsive for as long as it is up. Defaults to true.
   */
  touchable?: boolean;
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

  /**
   * Show once `delayMs` has passed, timed by the native main looper.
   *
   * Use this rather than `setTimeout(() => show(...))`. Overlays are wanted
   * precisely when Tether is backgrounded, and JS timers do not run then -- a
   * delayed show written in JS simply never happens. A `hide` or an immediate
   * `show` of the same overlay cancels a pending one.
   */
  showAfter: (
    name: string,
    options: OverlayOptions,
    props: Record<string, unknown> | null,
    delayMs: number,
  ): Promise<boolean> =>
    TetherOverlay.showAfter(name, options, props, delayMs),

  /** Resize/move without remounting React -- component state survives. */
  setLayout: (name: string, options: OverlayOptions): Promise<boolean> =>
    TetherOverlay.setLayout(name, options),

  /**
   * Resize once `delayMs` has passed, timed by the native main looper.
   *
   * Use this instead of `setTimeout(() => setLayout(...))` for anything that
   * has to happen when an animation ends. Overlays are on screen precisely when
   * Tether is backgrounded, and JS timers and native-driver animation callbacks
   * both stop being delivered then -- the resize would simply never happen.
   *
   * A later setLayout, setLayoutAfter or hide on the same overlay cancels it.
   */
  setLayoutAfter: (
    name: string,
    options: OverlayOptions,
    delayMs: number,
  ): Promise<boolean> => TetherOverlay.setLayoutAfter(name, options, delayMs),

  update: (name: string, props: Record<string, unknown>): Promise<boolean> =>
    TetherOverlay.update(name, props),

  hide: (name: string): Promise<boolean> => TetherOverlay.hide(name),

  /**
   * Remove once `delayMs` has passed, timed by the native main looper.
   *
   * The other half of showAfter, and what makes a transient overlay safe to put
   * on screen at all: the removal is queued natively the moment the window goes
   * up, so it happens even if the JS thread never runs again. A `setTimeout`
   * here would leave the overlay on screen forever.
   *
   * A later `show` of the same overlay cancels a pending hide.
   */
  hideAfter: (name: string, delayMs: number): Promise<boolean> =>
    TetherOverlay.hideAfter(name, delayMs),

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

  /**
   * Packages Tether refuses to hide -- launcher, dialer, Settings, keyboard.
   * Hiding these would leave no way back into the device.
   */
  getProtectedPackages: (): Promise<string[]> =>
    TetherBlocking.getProtectedPackages(),
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
/* The animation clock                                                 */
/* ------------------------------------------------------------------ */

export const Clock = {
  /**
   * Emit ~30 progress frames per second over `durationMs`, as `tether:clock`
   * events carrying this `id` and a `t` running 0 -> 1.
   *
   * This exists because an overlay cannot animate itself. Overlays are on
   * screen only while Tether is backgrounded, and RN then advances neither
   * `Animated` (native driver included) nor JS timers -- a tween freezes
   * part-way and strands whatever it was drawing. Re-renders driven by native
   * events DO still happen, which is why the timer pill counts down, so the
   * clock lives natively and JS only paints. See HANDOFF.md section 10.
   *
   * Starting a run with an id already in flight replaces it. Native caps the
   * duration and always sends a final frame, so a run cannot outlive itself.
   */
  start: (id: number, durationMs: number): Promise<boolean> =>
    TetherClock.start(id, durationMs),

  /** Stop a run early. A final frame (`t: 1, done: true`) is still delivered. */
  cancel: (id: number): Promise<boolean> => TetherClock.cancel(id),
};

/* ------------------------------------------------------------------ */
/* Events emitted from native                                          */
/* ------------------------------------------------------------------ */

export type TickEvent = {remainingMs: number; remainingMinutes: number};
/** One animation frame from NativeClock. `t` is 0..1; `done` marks the last. */
export type ClockEvent = {id: number; t: number; done: boolean};
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

  /** Animation frames from Clock.start(). See src/state/nativeClock.ts. */
  onClock: (fn: (e: ClockEvent) => void) =>
    DeviceEventEmitter.addListener('tether:clock', fn),
};

/** True when the native side is actually linked (i.e. not a stale JS-only build). */
export const isNativeReady = Boolean(TetherFocus && TetherOverlay);
