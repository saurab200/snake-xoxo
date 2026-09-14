import {AppState} from 'react-native';
import {Focus, Overlay, Permissions} from '../native';
import {
  SNAKE_LAYOUT,
  SNAKE_LAYOUT_ACTIVE,
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

async function showSnake() {
  try {
    const {overlay} = await Permissions.getStatus();
    if (!overlay) {
      return; // nothing we can do until the user grants it
    }
    // The snake needs the process alive to stay on screen.
    await Focus.arm();

    const {isActive} = await Focus.getState();
    await Overlay.show(
      'SnakeOverlay',
      isActive ? SNAKE_LAYOUT_ACTIVE : SNAKE_LAYOUT,
    );
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
