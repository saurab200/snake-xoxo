import React, {useState} from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import SnakeMark from '../components/SnakeMark';
import {continueAsDemo} from '../state/authStore';

/**
 * First thing a new user sees. One job: explain what Tether is in two lines and
 * offer three clearly ranked ways in -- primary, secondary, and a quiet escape
 * hatch for a demo with no typing.
 */

type Props = {
  onLogin: () => void;
  onSignUp: () => void;
};

export default function AuthWelcomeScreen({onLogin, onSignUp}: Props) {
  const [busy, setBusy] = useState(false);

  async function demo() {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await continueAsDemo();
    } finally {
      // The auth gate unmounts this screen on success; resetting matters only
      // if it somehow does not.
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <SnakeMark size={86} />

        <Text style={styles.wordmark}>TETHER</Text>
        <Text style={styles.tagline}>Focus without distractions.</Text>
      </View>

      <View style={styles.pitch}>
        <Text style={styles.pitchTitle}>Own your attention.</Text>
        <Text style={styles.pitchBody}>
          Pull the snake to start a focus session. Tether blocks the apps that
          pull you away, and rewards the time you keep.
        </Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.primary}
          onPress={onSignUp}
          accessibilityRole="button"
          accessibilityLabel="Create a Tether account">
          <Text style={styles.primaryText}>Create account</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondary}
          onPress={onLogin}
          accessibilityRole="button"
          accessibilityLabel="Log in to Tether">
          <Text style={styles.secondaryText}>Log in</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.ghost}
          onPress={demo}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Continue as a demo user">
          {busy ? (
            <ActivityIndicator color="#8b949e" size="small" />
          ) : (
            <Text style={styles.ghostText}>Continue as demo</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0d1117',
    paddingHorizontal: 28,
    paddingTop: 56,
    paddingBottom: 36,
  },
  hero: {alignItems: 'center'},
  wordmark: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 6,
    marginTop: 20,
  },
  tagline: {color: '#8b949e', fontSize: 14, marginTop: 8},

  // Takes the slack, so the hero sits high and the buttons sit low regardless
  // of screen height.
  pitch: {flex: 1, justifyContent: 'center'},
  pitchTitle: {
    color: '#e6edf3',
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 33,
  },
  pitchBody: {
    color: '#8b949e',
    fontSize: 15,
    lineHeight: 23,
    marginTop: 12,
  },

  actions: {gap: 12},
  primary: {
    backgroundColor: '#1f6feb',
    borderRadius: 12,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {color: '#fff', fontSize: 16, fontWeight: '700'},
  secondary: {
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 12,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {color: '#e6edf3', fontSize: 16, fontWeight: '700'},
  ghost: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: {color: '#8b949e', fontSize: 14, fontWeight: '600'},
});
