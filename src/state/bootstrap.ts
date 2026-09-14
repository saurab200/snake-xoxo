import {AppState} from 'react-native';
import {Focus, Overlay, Permissions} from '../native';
import {KILL_LAYOUT} from '../overlays/KillSwitchOverlay';
import {
  SNAKE_LAYOUT,
  SNAKE_LAYOUT_ACTIVE,
  SNAKE_LAYOUT_PEEK,
} from '../overlays/SnakeOverlay';

/**
 * Keeps the snake permanently pinned to the top of the screen.
 *
 * Runs at module scope from index.js, not from a component: Android destroys
 * MainActivity routinely, and anything mounted from App.tsx dies with it. The JS
 * context outlives every activity, and the foreground service keeps the process
 * alive, so this survives.
 */

let started = false;

/**
 * Whether the snake has retreated to the bezel.
 *
 * Module scope, NOT component state: the overlay is unmounted every time the
 * user opens Tether (it would otherwise cover the app's own UI) and remounted
 * when they leave. Anything kept inside the component is destroyed on every
 * one of those trips, which reset the peek state and restarted the idle clock
 * from zero.
 */
let snakePeeking = false;

export function setSnakePeeking(value: boolean): void {
  snakePeeking = value;
}

export function isSnakePeeking(): boolean {
  return snakePeeking;
}

async function showSnake() {
  try {
    const {overlay} = await Permissions.getStatus();
    if (!overlay) {
      return; // nothing we can do until the user grants it
    }
    // The snake needs the process alive to stay on screen.
    await Focus.arm();

    const {isActive} = await Focus.getState();
    const layout = isActive
      ? SNAKE_LAYOUT_ACTIVE
      : snakePeeking
      ? SNAKE_LAYOUT_PEEK
      : SNAKE_LAYOUT;

    await Overlay.show('SnakeOverlay', layout, {peeking: snakePeeking});
    // The panic button travels with the snake -- it has to be reachable in
    // exactly the situations where the snake is visible.
    await Overlay.show('KillSwitchOverlay', KILL_LAYOUT);
  } catch {
    /* native not ready yet; the AppState hook below retries */
  }
}

export function startSnake(): void {
  if (started) {
    return;
  }
  started = true;

  /**
   * The snake belongs on TOP OF OTHER APPS -- not on top of Tether itself,
   * where it covers the app's own controls (it sat right over the blocklist
   * search box). So it hides whenever Tether is in the foreground and comes
   * back the moment the user leaves.
   *
   * This doubles as the permission retry: SYSTEM_ALERT_WINDOW is granted on a
   * Settings screen, so the first attempt usually fails, and every return to
   * the background re-attempts it.
   */
  const apply = (state: string) => {
    if (state === 'active') {
      Overlay.hide('SnakeOverlay').catch(() => {});
      Overlay.hide('KillSwitchOverlay').catch(() => {});
    } else {
      showSnake();
    }
  };

  apply(AppState.currentState);
  AppState.addEventListener('change', apply);
}

export function hideSnake(): Promise<boolean> {
  return Overlay.hide('SnakeOverlay');
}

/**
 * After the kill switch stops everything, startSnake's AppState listener is
 * still installed but `started` stays true, so nothing re-shows the overlays
 * until the user next leaves the app. This lets the app re-arm explicitly.
 */
export function rearm(): void {
  showSnake();
}
