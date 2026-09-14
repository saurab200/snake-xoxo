import {useCallback, useEffect, useState} from 'react';
import {Focus, FocusState, TetherEvents} from '../native';

const EMPTY: FocusState = {
  isActive: false,
  durationMinutes: 0,
  endAtMs: 0,
  remainingMs: 0,
  remainingMinutes: 0,
};

/**
 * Subscribes to the native session. Works from the main app AND from inside an
 * overlay -- both run in the same JS context, so both get the same events.
 */
export function useFocusSession() {
  const [state, setState] = useState<FocusState>(EMPTY);

  const refresh = useCallback(async () => {
    try {
      setState(await Focus.getState());
    } catch {
      /* native not linked yet -- rebuild the app */
    }
  }, []);

  useEffect(() => {
    refresh();

    const tick = TetherEvents.onTick(e =>
      setState(prev => ({
        ...prev,
        remainingMs: e.remainingMs,
        remainingMinutes: e.remainingMinutes,
      })),
    );
    const session = TetherEvents.onSessionChanged(setState);

    return () => {
      tick.remove();
      session.remove();
    };
  }, [refresh]);

  return {...state, refresh};
}

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
