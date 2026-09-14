import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {Focus, Overlay} from '../native';
import {formatRemaining, useFocusSession} from '../state/useFocusSession';

type Props = {
  packageName?: string;
  appLabel?: string;
  /** First-paint fallback only. The live value comes from useFocusSession. */
  remainingMinutes?: number;
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

  // When the session ends while the wall is up, show a completion state briefly
  // and then take ourselves down. The user should never have to dismiss a wall
  // for a session that is already over.
  useEffect(() => {
    if (session.isActive || dismissing) {
      return;
    }
    setDismissing(true);
    const t = setTimeout(() => Overlay.hide('BlockOverlay'), 2000);
    return () => clearTimeout(t);
  }, [session.isActive, dismissing]);

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
