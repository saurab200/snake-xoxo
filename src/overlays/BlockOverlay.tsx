import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {Focus, Overlay} from '../native';
import {formatRemaining, useFocusSession} from '../state/useFocusSession';

type Props = {
  packageName?: string;
  appLabel?: string;
  remainingMinutes?: number;
};

/**
 * PERSON B owns this file.
 *
 * Full-screen window shown when a blocked app is opened during a session.
 * Props are pushed in from TetherAccessibilityService.
 */
export default function BlockOverlay(props: Props) {
  const session = useFocusSession();
  const label = props.appLabel ?? props.packageName ?? 'That app';

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{label} is blocked</Text>
      <Text style={styles.timer}>
        {session.isActive
          ? `${formatRemaining(session.remainingMs)} left`
          : 'Session ended'}
      </Text>

      <TouchableOpacity
        style={styles.button}
        onPress={() => Overlay.hide('BlockOverlay')}>
        <Text style={styles.buttonText}>Back to focus</Text>
      </TouchableOpacity>

      {/* Escape hatch. Delete before the demo if you want it to feel strict. */}
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
  title: {color: '#fff', fontSize: 26, fontWeight: '700', textAlign: 'center'},
  timer: {color: '#8b949e', fontSize: 16, marginTop: 12, marginBottom: 40},
  button: {
    backgroundColor: '#1f6feb',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 10,
  },
  buttonText: {color: '#fff', fontSize: 16, fontWeight: '600'},
  secondary: {marginTop: 20, padding: 10},
  secondaryText: {color: '#8b949e', fontSize: 13},
});
