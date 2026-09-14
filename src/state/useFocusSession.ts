import {useCallback, useEffect, useState} from 'react';
import {
  Focus,
  FocusState,
  LockoutState,
  RemindersApi,
  TetherEvents,
} from '../native';

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
const NO_LOCKOUT: LockoutState = {
  isLockedOut: false,
  lockoutUntilMs: 0,
  lockoutRemainingMs: 0,
  lockoutLabel: null,
};

export function useFocusSession() {
  const [state, setState] = useState<FocusState>(EMPTY);
  const [lockout, setLockout] = useState<LockoutState>(NO_LOCKOUT);

  const refresh = useCallback(async () => {
    try {
      setState(await Focus.getState());
      setLockout(await RemindersApi.getLockout());
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
    const lock = TetherEvents.onLockoutChanged(setLockout);

    // The native tick does not push lockout every second, so count down locally
    // between pushes to keep the display smooth.
    const local = setInterval(() => {
      setLockout(prev =>
        prev.isLockedOut
          ? {
              ...prev,
              lockoutRemainingMs: Math.max(0, prev.lockoutUntilMs - Date.now()),
              isLockedOut: prev.lockoutUntilMs > Date.now(),
            }
          : prev,
      );
    }, 1000);

    return () => {
      tick.remove();
      session.remove();
      lock.remove();
      clearInterval(local);
    };
  }, [refresh]);

  return {...state, ...lockout, refresh};
}

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
