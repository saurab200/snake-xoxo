import React, {useRef, useState} from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AuthTextInput from '../components/AuthTextInput';
import SnakeMark from '../components/SnakeMark';
import {
  continueWithEmail,
  fallbackNameFor,
  isValidEmail,
} from '../state/authStore';

/**
 * The whole sign-in experience: two fields, one button.
 *
 * There is no password, no separate sign-up, and no confirmation step. Tether
 * has no backend, so a password could only ever be checked against the device
 * it was typed on -- which proves nothing while costing the user a form. The
 * email is what a profile and a leaderboard row hang on, so that is the only
 * thing we require. University and work addresses are the expected case;
 * personal ones are accepted too (see isValidEmail).
 *
 * Name is optional on purpose. It is what the leaderboard shows, and guessing
 * it from the address gets "Saurab200" often enough to be worth asking -- but
 * requiring it puts a second thing between someone at a demo and the app, and
 * the guess is good enough to fall back on.
 */
export default function AuthWelcomeScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<TextInput>(null);

  const ready = isValidEmail(email);

  async function submit() {
    if (busy) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await continueWithEmail(email, name);
      if (!result.ok) {
        setError(result.message);
      }
      // On success the auth gate unmounts this screen; nothing to do here.
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.root}
        keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <SnakeMark size={86} />
          <Text style={styles.wordmark}>MEDUSA</Text>
          <Text style={styles.tagline}>Welcome to focus Maxxing</Text>
        </View>

        <View style={styles.pitch}>
          <Text style={styles.pitchTitle}>Own your attention.</Text>
          <Text style={styles.pitchBody}>
            Pull the snake to start a focus session. Medusa blocks the apps that
            pull you away, and rewards the time you keep.
          </Text>
        </View>

        <View style={styles.actions}>
          <AuthTextInput
            label="Name"
            // Once the address parses, the placeholder is the exact name we
            // would fall back to -- so leaving the field alone reads as a
            // choice rather than as something unfinished.
            placeholder={ready ? fallbackNameFor(email) : 'Optional'}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoCorrect={false}
            textContentType="name"
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
            // The email field is the one that gates Continue, so the keyboard
            // should move there rather than submitting a half-filled form.
            blurOnSubmit={false}
            editable={!busy}
          />

          <AuthTextInput
            ref={emailRef}
            label="Email"
            placeholder="you@university.edu"
            value={email}
            onChangeText={t => {
              setEmail(t);
              if (error) {
                setError(null);
              }
            }}
            error={error}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="go"
            onSubmitEditing={submit}
            editable={!busy}
          />

          <TouchableOpacity
            style={[styles.primary, !ready && styles.primaryDisabled]}
            onPress={submit}
            disabled={busy || !ready}
            accessibilityRole="button"
            accessibilityLabel="Continue into Medusa">
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.primaryText}>Continue</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.fineprint}>
            Your name is what the leaderboard shows, and only the email is
            required. Both stay on this device: no password, no verification
            email.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1, backgroundColor: '#0d1117'},
  root: {
    flexGrow: 1,
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

  // Takes the slack, so the hero sits high and the field sits low regardless
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
  /** Dimmed until the address parses, so the button says what it will do. */
  primaryDisabled: {opacity: 0.45},
  primaryText: {color: '#fff', fontSize: 16, fontWeight: '700'},
  fineprint: {
    color: '#6e7681',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
