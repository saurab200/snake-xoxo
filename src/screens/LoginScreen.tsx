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
  MIN_PASSWORD_LENGTH,
  isValidEmail,
  login,
} from '../state/authStore';

type Props = {
  onBack: () => void;
  onSwitchToSignUp: () => void;
};

type Errors = {
  email?: string | null;
  password?: string | null;
  form?: string | null;
};

export default function LoginScreen({onBack, onSwitchToSignUp}: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const passwordRef = useRef<TextInput>(null);

  function validate(): Errors {
    const next: Errors = {};

    if (!email.trim()) {
      next.email = 'Email is required.';
    } else if (!isValidEmail(email)) {
      next.email = 'Please enter a valid email address.';
    }

    if (!password) {
      next.password = 'Password is required.';
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }

    return next;
  }

  async function submit() {
    if (busy) {
      return; // guard against a double tap landing two submissions
    }

    const found = validate();
    if (found.email || found.password) {
      setErrors(found);
      return;
    }

    setErrors({});
    setBusy(true);
    try {
      const result = await login(email, password);
      if (!result.ok) {
        // Store-level failures are surfaced inline, never as a dialog.
        setErrors({form: result.message});
      }
      // On success the auth gate swaps this screen out; nothing to do here.
    } catch {
      setErrors({form: "Couldn't sign in. Please try again."});
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      // Android resizes the window itself; 'height' cooperates with that, while
      // 'padding' fights it and leaves a gap above the keyboard.
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.back}
          hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <SnakeMark size={54} />
          <Text style={styles.h1}>Welcome back.</Text>
          <Text style={styles.sub}>Ready to protect your focus?</Text>
        </View>

        <AuthTextInput
          label="Email"
          value={email}
          onChangeText={t => {
            setEmail(t);
            if (errors.email || errors.form) {
              setErrors(e => ({...e, email: null, form: null}));
            }
          }}
          error={errors.email}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />

        <AuthTextInput
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={t => {
            setPassword(t);
            if (errors.password || errors.form) {
              setErrors(e => ({...e, password: null, form: null}));
            }
          }}
          error={errors.password}
          placeholder="••••••••"
          password
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="password"
          textContentType="password"
          // Last field: the keyboard's action submits the form.
          returnKeyType="go"
          onSubmitEditing={submit}
        />

        <TouchableOpacity
          style={styles.forgot}
          onPress={() =>
            setErrors({
              form: 'Password reset needs a backend — use Continue as demo for now.',
            })
          }
          accessibilityRole="button"
          accessibilityLabel="Forgot password">
          <Text style={styles.forgotText}>Forgot password?</Text>
        </TouchableOpacity>

        {errors.form ? (
          <View style={styles.formError} accessibilityLiveRegion="polite">
            <Text style={styles.formErrorText}>{errors.form}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.primary, busy && styles.primaryBusy]}
          onPress={submit}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{disabled: busy, busy}}
          accessibilityLabel="Log in">
          {busy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.primaryText}>Log in</Text>
          )}
        </TouchableOpacity>

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Don't have an account?</Text>
          <TouchableOpacity
            onPress={onSwitchToSignUp}
            hitSlop={{top: 10, bottom: 10, left: 8, right: 8}}
            accessibilityRole="button"
            accessibilityLabel="Create an account">
            <Text style={styles.switchAction}>Create account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0d1117'},
  scroll: {
    paddingHorizontal: 28,
    paddingTop: 20,
    // Room to scroll the CTA clear of the keyboard on short screens.
    paddingBottom: 48,
    flexGrow: 1,
  },
  back: {alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 12},
  backText: {color: '#8b949e', fontSize: 15, fontWeight: '600'},

  header: {alignItems: 'center', marginTop: 12, marginBottom: 32},
  h1: {
    color: '#fff',
    fontSize: 27,
    fontWeight: '800',
    marginTop: 16,
  },
  sub: {color: '#8b949e', fontSize: 14, marginTop: 6},

  forgot: {alignSelf: 'flex-end', paddingVertical: 4, marginTop: -4},
  forgotText: {color: '#1f6feb', fontSize: 13, fontWeight: '600'},

  formError: {
    backgroundColor: '#3d1d1d',
    borderWidth: 1,
    borderColor: '#f85149',
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
  },
  formErrorText: {color: '#ffb3ae', fontSize: 13, lineHeight: 18},

  primary: {
    backgroundColor: '#1f6feb',
    borderRadius: 12,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  primaryBusy: {opacity: 0.65},
  primaryText: {color: '#fff', fontSize: 16, fontWeight: '700'},

  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 22,
  },
  switchLabel: {color: '#8b949e', fontSize: 14},
  switchAction: {color: '#1f6feb', fontSize: 14, fontWeight: '700'},
});
