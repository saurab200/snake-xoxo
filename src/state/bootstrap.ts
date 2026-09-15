import {AppState} from 'react-native';
import {Focus, Overlay, Permissions} from '../native';
import {KILL_LAYOUT} from '../overlays/KillSwitchOverlay';
import {SNAKE_LAYOUT, SNAKE_LAYOUT_ACTIVE} from '../overlays/SnakeOverlay';
import {XP_BAR_LAYOUT} from '../overlays/XpBarOverlay';

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
     * No armed gate any more.
     *
     * The snake is a permanent fixture from install onward, so there is no
     * state in which it should be absent while the overlay permission is
     * granted. arm() is still called because it starts the foreground service
     * the snake needs to stay on screen; it is idempotent.
     */
    await Focus.arm();

    const {isActive} = await Focus.getState();
    await Overlay.show(
      'SnakeOverlay',
      isActive ? SNAKE_LAYOUT_ACTIVE : SNAKE_LAYOUT,
    );
    // The panic button travels with the snake -- it has to be reachable in
    // exactly the situations where the snake is visible.
    await Overlay.show('KillSwitchOverlay', KILL_LAYOUT);
    // The XP bar is the other permanent fixture: it is where every point the
    // user earns visibly lands, so it outlives any one session too.
    await Overlay.show('XpBarOverlay', XP_BAR_LAYOUT);
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
      Overlay.hide('XpBarOverlay').catch(() => {});
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
 * Repair hatch for the Focus tab's "Re-pin snake".
 *
 * Nothing in normal operation takes the snake away any more, so this exists for
 * the cases outside our control: the overlay permission was revoked and later
 * granted again, or Android tore the window down. It is safe to call at will.
 */
export async function rearm(): Promise<void> {
  try {
    await Focus.arm();
  } catch {
    /* native not ready */
  }
  showSnake();
}
