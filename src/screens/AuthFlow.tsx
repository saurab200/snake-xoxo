import React, {useEffect, useRef} from 'react';
import {
  Animated,
  Easing,
  SafeAreaView,
  StyleSheet,
  View,
} from 'react-native';
import SnakeMark from '../components/SnakeMark';
import AuthWelcomeScreen from './AuthWelcomeScreen';

/**
 * The unauthenticated flow: one screen.
 *
 * It used to be three -- welcome, sign up, log in -- behind local state. With
 * no password there is nothing to tell signing up from logging in, so the
 * welcome screen asks for an email and that is the entire flow. No navigation
 * library, and no back handler, because there is nowhere to go back to.
 *
 * Animated is safe here, unlike in the overlays: this only ever renders while
 * Tether is in the FOREGROUND, so the frame loop is running. See HANDOFF.md
 * section 10 for why that distinction matters so much in this codebase.
 */

type Props = {
  /** True while persisted auth state is still being read. */
  initializing?: boolean;
};

export default function AuthFlow({initializing = false}: Props) {
  // A one-off fade-in on mount. Cheap, native-driven.
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [fade]);

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
        <AuthWelcomeScreen />
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0d1117'},
  fill: {flex: 1},
  splash: {flex: 1, alignItems: 'center', justifyContent: 'center'},
});
