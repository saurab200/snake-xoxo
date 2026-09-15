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
  MIN_NAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  isValidEmail,
  signUp,
} from '../state/authStore';

type Props = {
  onBack: () => void;
  onSwitchToLogin: () => void;
};

type Errors = {
  name?: string | null;
  email?: string | null;
  password?: string | null;
  confirm?: string | null;
  form?: string | null;
};

export default function SignUpScreen({onBack, onSwitchToLogin}: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  function validate(): Errors {
    const next: Errors = {};

    if (!name.trim()) {
      next.name = 'Name is required.';
    } else if (name.trim().length < MIN_NAME_LENGTH) {
      next.name = `Name must be at least ${MIN_NAME_LENGTH} characters.`;
    }

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

    if (!confirm) {
      next.confirm = 'Please confirm your password.';
    } else if (confirm !== password) {
      next.confirm = "Passwords don't match.";
    }

    return next;
  }

  async function submit() {
    if (busy) {
      return; // guard against a double tap landing two submissions
    }

    const found = validate();
    if (found.name || found.email || found.password || found.confirm) {
      setErrors(found);
      return;
    }

    setErrors({});
    setBusy(true);
    try {
      const result = await signUp(name, email, password);
      if (!result.ok) {
        setErrors({form: result.message});
      }
      // On success the auth gate swaps this screen out.
    } catch {
      setErrors({form: "Couldn't create your account. Please try again."});
    } finally {
      setBusy(false);
    }
  }

  /** Clear a field's error (and any form-level error) as soon as it is edited. */
  const clearOn =
    (key: keyof Errors) =>
    (setter: (v: string) => void) =>
    (text: string) => {
      setter(text);
      setErrors(e =>
        e[key] || e.form ? {...e, [key]: null, form: null} : e,
      );
    };

  return (
    <KeyboardAvoidingView
      style={styles.root}
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
          <Text style={styles.h1}>Create your Tether.</Text>
          <Text style={styles.sub}>Start building better focus habits.</Text>
        </View>

        <AuthTextInput
          label="Name"
          value={name}
          onChangeText={clearOn('name')(setName)}
          error={errors.name}
          placeholder="Ali"
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          onSubmitEditing={() => emailRef.current?.focus()}
        />

        <AuthTextInput
          ref={emailRef}
          label="Email"
          value={email}
          onChangeText={clearOn('email')(setEmail)}
          error={errors.email}
          placeholder="ali@example.com"
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
            setErrors(e =>
              e.password || e.confirm || e.form
                ? {...e, password: null, confirm: null, form: null}
                : e,
            );
          }}
          error={errors.password}
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          password
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="password-new"
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
        />

        <AuthTextInput
          ref={confirmRef}
          label="Confirm password"
          value={confirm}
          onChangeText={clearOn('confirm')(setConfirm)}
          error={errors.confirm}
          placeholder="Re-enter your password"
          password
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="password-new"
          textContentType="newPassword"
          // Last field: the keyboard's action submits the form.
          returnKeyType="go"
          onSubmitEditing={submit}
        />

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
          accessibilityLabel="Create account">
          {busy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.primaryText}>Create account</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          Your account stays on this device. No email, no password is stored.
        </Text>

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Already have an account?</Text>
          <TouchableOpacity
            onPress={onSwitchToLogin}
            hitSlop={{top: 10, bottom: 10, left: 8, right: 8}}
            accessibilityRole="button"
            accessibilityLabel="Log in">
            <Text style={styles.switchAction}>Log in</Text>
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
    paddingBottom: 48,
    flexGrow: 1,
  },
  back: {alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 12},
  backText: {color: '#8b949e', fontSize: 15, fontWeight: '600'},

  header: {alignItems: 'center', marginTop: 8, marginBottom: 28},
  h1: {color: '#fff', fontSize: 26, fontWeight: '800', marginTop: 14},
  sub: {color: '#8b949e', fontSize: 14, marginTop: 6, textAlign: 'center'},

  formError: {
    backgroundColor: '#3d1d1d',
    borderWidth: 1,
    borderColor: '#f85149',
    borderRadius: 8,
    padding: 12,
    marginTop: 4,
  },
  formErrorText: {color: '#ffb3ae', fontSize: 13, lineHeight: 18},

  primary: {
    backgroundColor: '#1f6feb',
    borderRadius: 12,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  primaryBusy: {opacity: 0.65},
  primaryText: {color: '#fff', fontSize: 16, fontWeight: '700'},

  disclaimer: {
    color: '#6e7681',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 12,
  },

  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 20,
  },
  switchLabel: {color: '#8b949e', fontSize: 14},
  switchAction: {color: '#1f6feb', fontSize: 14, fontWeight: '700'},
});
