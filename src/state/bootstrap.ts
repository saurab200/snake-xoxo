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

  showSnake();

  // The overlay permission is granted on a Settings screen, so the first attempt
  // often fails. Retry whenever the user comes back to the app.
  AppState.addEventListener('change', state => {
    if (state === 'active') {
      showSnake();
    }
  });
}

export function hideSnake(): Promise<boolean> {
  return Overlay.hide('SnakeOverlay');
}
