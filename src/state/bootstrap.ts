import {AppState} from 'react-native';
import {Focus, Overlay, Permissions} from '../native';
import {KILL_LAYOUT} from '../overlays/KillSwitchOverlay';
import {SNAKE_LAYOUT, SNAKE_LAYOUT_ACTIVE} from '../overlays/SnakeOverlay';

/**
 * Keeps the snake permanently pinned to the top of the screen.
 *
 * Runs at module scope from index.js, not from a component: Android destroys
 * MainActivity routinely, and anything mounted from App.tsx dies with it. The JS
 * context outlives every activity, and the foreground service keeps the process
 * alive, so this survives.
 */

let started = false;

async function showSnake() {
  try {
    const {overlay} = await Permissions.getStatus();
    if (!overlay) {
      return; // nothing we can do until the user grants it
    }

    /**
     * Respect an explicit close.
     *
     * This used to call arm() unconditionally on every process start. The
     * accessibility service revives the process, so "stop everything" undid
     * itself within seconds -- the kill switch cleared the flag and this put it
     * straight back.
     */
    if (!(await Focus.isArmed())) {
      return;
    }

    // The snake needs the process alive to stay on screen. Idempotent.
    await Focus.arm();

    const {isActive} = await Focus.getState();
    await Overlay.show(
      'SnakeOverlay',
      isActive ? SNAKE_LAYOUT_ACTIVE : SNAKE_LAYOUT,
    );
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
      Overlay.hide('TaskCardOverlay').catch(() => {});
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
 * Bring the snake back after a kill switch.
 *
 * Must arm explicitly: showSnake() now refuses to run while disarmed, which is
 * the whole point of the fix above.
 */
export async function rearm(): Promise<void> {
  try {
    await Focus.arm();
  } catch {
    /* native not ready */
  }
  showSnake();
}
