import React, {forwardRef, useState} from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
} from 'react-native';

/**
 * Labelled input for the auth screens: label, field, inline error, focus ring
 * and an optional password reveal.
 *
 * Exists because the same six fields across Login and Sign Up would otherwise
 * repeat this markup verbatim. Nothing else in the app uses it yet, so it stays
 * deliberately unabstracted -- no theme prop, no variants.
 */

type Props = Omit<TextInputProps, 'style'> & {
  label: string;
  /** Shown below the field. Also turns the border red. */
  error?: string | null;
  /** Renders a Show/Hide control and manages secureTextEntry itself. */
  password?: boolean;
};

const AuthTextInput = forwardRef<TextInput, Props>(function AuthTextInput(
  {label, error, password, ...inputProps},
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const hasError = Boolean(error);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>

      <View
        style={[
          styles.inputWrap,
          focused && styles.inputWrapFocused,
          hasError && styles.inputWrapError,
        ]}>
        <TextInput
          {...inputProps}
          ref={ref}
          style={styles.input}
          placeholderTextColor="#484f58"
          secureTextEntry={password ? !revealed : inputProps.secureTextEntry}
          onFocus={e => {
            setFocused(true);
            inputProps.onFocus?.(e);
          }}
          onBlur={e => {
            setFocused(false);
            inputProps.onBlur?.(e);
          }}
        />

        {password ? (
          <TouchableOpacity
            onPress={() => setRevealed(v => !v)}
            style={styles.reveal}
            // Generous slop: the control itself is small but must be easy to hit.
            hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}>
            <Text style={styles.revealText}>{revealed ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {hasError ? (
        // Announced to screen readers when it appears, rather than silently
        // turning the border red.
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
});

export default AuthTextInput;

const styles = StyleSheet.create({
  field: {marginBottom: 16},
  label: {
    color: '#8b949e',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 7,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 10,
    paddingHorizontal: 14,
    // Comfortably above the 48dp minimum touch target.
    minHeight: 54,
  },
  inputWrapFocused: {borderColor: '#1f6feb'},
  inputWrapError: {borderColor: '#f85149'},
  input: {
    flex: 1,
    color: '#e6edf3',
    fontSize: 15,
    paddingVertical: 14,
  },
  reveal: {paddingLeft: 10, paddingVertical: 6},
  revealText: {color: '#1f6feb', fontSize: 13, fontWeight: '700'},
  error: {color: '#f85149', fontSize: 12, marginTop: 6, lineHeight: 16},
});
