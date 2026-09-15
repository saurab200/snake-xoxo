import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  SafeAreaView,
  StyleSheet,
  View,
} from 'react-native';
import SnakeMark from '../components/SnakeMark';
import AuthWelcomeScreen from './AuthWelcomeScreen';
import LoginScreen from './LoginScreen';
import SignUpScreen from './SignUpScreen';

/**
 * The unauthenticated flow.
 *
 * Three views behind plain local state -- no navigation library for what is
 * really one screen with three faces. Animated is safe here, unlike in the
 * overlays: this only ever renders while Tether is in the foreground, so the
 * frame loop is running.
 */

type AuthView = 'welcome' | 'login' | 'signup';

type Props = {
  /** True while persisted auth state is still being read. */
  initializing?: boolean;
};

export default function AuthFlow({initializing = false}: Props) {
  const [view, setView] = useState<AuthView>('welcome');

  // Cross-fade with a small lift on view change. Cheap, native-driven.
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [view, fade]);

  /**
   * Android back goes login/signup -> welcome instead of quitting the app.
   * Returning false on the welcome screen keeps the normal "exit" behaviour,
   * which is what a user expects from a root screen.
   */
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (view === 'welcome') {
        return false;
      }
      setView('welcome');
      return true;
    });
    return () => sub.remove();
  }, [view]);

  if (initializing) {
    // Branded hold rather than a spinner on a blank screen. Usually one frame.
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.splash}>
          <SnakeMark size={72} />
        </View>
      </SafeAreaView>
    );
  }

  const animatedStyle = {
    opacity: fade,
    transform: [
      {
        translateY: fade.interpolate({
          inputRange: [0, 1],
          outputRange: [10, 0],
        }),
      },
    ],
  };

  return (
    <SafeAreaView style={styles.root}>
      <Animated.View style={[styles.fill, animatedStyle]}>
        {view === 'welcome' ? (
          <AuthWelcomeScreen
            onLogin={() => setView('login')}
            onSignUp={() => setView('signup')}
          />
        ) : null}

        {view === 'login' ? (
          <LoginScreen
            onBack={() => setView('welcome')}
            onSwitchToSignUp={() => setView('signup')}
          />
        ) : null}

        {view === 'signup' ? (
          <SignUpScreen
            onBack={() => setView('welcome')}
            onSwitchToLogin={() => setView('login')}
          />
        ) : null}
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0d1117'},
  fill: {flex: 1},
  splash: {flex: 1, alignItems: 'center', justifyContent: 'center'},
});
