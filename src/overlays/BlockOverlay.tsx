import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {Focus, Overlay} from '../native';
import {formatRemaining, useFocusSession} from '../state/useFocusSession';

type Props = {
  packageName?: string;
  appLabel?: string;
  /** First-paint fallback only. The live value comes from useFocusSession. */
  remainingMinutes?: number;
  lockedOut?: boolean;
  lockoutLabel?: string | null;
};

/**
 * PERSON 2 (Person B) owns this file.
 *
 * Full-screen window shown when a blocked app is opened during a session.
 * Props are pushed in from TetherAccessibilityService.
 */
export default function BlockOverlay(props: Props) {
  const session = useFocusSession();
  const [dismissing, setDismissing] = useState(false);
  const label = props.appLabel ?? props.packageName ?? 'That app';

  // useFocusSession loads lockout state asynchronously, so on the very first
  // paint isLockedOut is still false. The accessibility service already knows
  // the answer and pushes it in as a prop -- trust that until the hook catches
  // up, or the wall briefly renders "available again" during a lockout and the
  // auto-dismiss effect below latches before the real state arrives.
  const lockedOut = session.isLockedOut || props.lockedOut === true;
  const lockoutLabel = session.lockoutLabel ?? props.lockoutLabel ?? null;

  // When the session ends while the wall is up, show a completion state briefly
  // and then take ourselves down. The user should never have to dismiss a wall
  // for a session that is already over.
  useEffect(() => {
    if (session.isActive || lockedOut || dismissing) {
      return;
    }
    setDismissing(true);
    const t = setTimeout(() => Overlay.hide('BlockOverlay'), 2000);
    return () => clearTimeout(t);
  }, [session.isActive, lockedOut, dismissing]);

  // A lockout is stricter than a session: no escape hatch, and the app that was
  // opened has already been closed rather than merely covered.
  if (lockedOut) {
    return (
      <View style={[styles.root, styles.locked]}>
        <Text style={styles.lockBadge}>TOTAL LOCKOUT</Text>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.title}>was closed</Text>

        {lockoutLabel ? (
          <Text style={styles.reason}>“{lockoutLabel}” is due</Text>
        ) : null}

        <Text style={[styles.timer, styles.timerLocked]}>
          {formatRemaining(session.lockoutRemainingMs)}
        </Text>
        <Text style={styles.timerCaption}>until apps unlock</Text>

        <Text style={styles.lockNote}>
          No early exit during a lockout. Go do the thing.
        </Text>
      </View>
    );
  }

  if (!session.isActive) {
    return (
      <View style={styles.root}>
        <Text style={styles.done}>Session complete</Text>
        <Text style={styles.timer}>{label} is available again</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.title}>is blocked</Text>

      {/*
        Live value from the tick event, not the mount-time prop -- otherwise this
        number freezes at whatever it was when the wall appeared.
      */}
      <Text style={styles.timer}>{formatRemaining(session.remainingMs)}</Text>
      <Text style={styles.timerCaption}>remaining</Text>

      <TouchableOpacity
        style={styles.button}
        onPress={() => Overlay.hide('BlockOverlay')}>
        <Text style={styles.buttonText}>Back to focus</Text>
      </TouchableOpacity>

      {/* Escape hatch. A demo nobody can exit is a demo that gets remembered badly. */}
      <TouchableOpacity
        style={styles.secondary}
        onPress={async () => {
          await Focus.stopSession();
          await Overlay.hide('BlockOverlay');
        }}>
        <Text style={styles.secondaryText}>End session early</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  locked: {backgroundColor: '#1a0505'},
  lockBadge: {
    color: '#fca5a5',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 18,
  },
  reason: {color: '#9ca3af', fontSize: 14, marginTop: 10, fontStyle: 'italic'},
  timerLocked: {color: '#ef4444'},
  lockNote: {color: '#7f1d1d', fontSize: 12, marginTop: 30, textAlign: 'center'},
  root: {
    flex: 1,
    backgroundColor: '#0d1117',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  label: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '800',
    textAlign: 'center',
  },
  title: {color: '#8b949e', fontSize: 20, marginTop: 2},
  done: {color: '#3fb950', fontSize: 30, fontWeight: '800'},
  timer: {
    color: '#1f6feb',
    fontSize: 52,
    fontWeight: '800',
    marginTop: 36,
    fontVariant: ['tabular-nums'],
  },
  timerCaption: {color: '#6e7681', fontSize: 13, marginBottom: 44},
  button: {
    backgroundColor: '#1f6feb',
    paddingHorizontal: 32,
    paddingVertical: 15,
    borderRadius: 10,
  },
  buttonText: {color: '#fff', fontSize: 16, fontWeight: '600'},
  secondary: {marginTop: 22, padding: 10},
  secondaryText: {color: '#8b949e', fontSize: 13},
});
