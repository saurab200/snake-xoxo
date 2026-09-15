import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useGamification} from '../state/gamificationStore';

/** Thin enough to read as part of the bezel rather than as UI. */
export const XP_BAR_HEIGHT = 18;

/**
 * Pinned to the very top, full width, above everything else the app draws.
 *
 * The window sits just under the status bar (application overlays are laid out
 * below it), so the bar reads as a strip attached to the bezel. The snake hangs
 * from underneath it -- SNAKE_LAYOUT is offset by XP_BAR_HEIGHT so the two do
 * not overlap.
 */
export const XP_BAR_LAYOUT = {
  width: -1, // MATCH_PARENT
  height: XP_BAR_HEIGHT,
  gravity: 'top' as const,
  touchThrough: true,
  focusable: false,
};

/**
 * Where earned XP goes.
 *
 * Every point the user earns -- ticking a task off, or sitting out a whole
 * focus session -- lands in the same pot the leaderboard ranks on, and this is
 * the running picture of it: how far through the current level they are.
 *
 * NOT ANIMATED, on purpose. The bar is on screen precisely when Tether is
 * backgrounded, and in that state React Native advances neither Animated nor JS
 * timers -- a fill that tweened would simply freeze part-way. Every render
 * paints the final state. State updates themselves arrive fine, because they
 * come from native events and touches rather than from a clock.
 *
 * The XP flying in from a ticked task is drawn by XpFlightOverlay, a separate
 * window, on a native clock. It aims at this bar's fill edge -- which is why the
 * track's 10dp inset is repeated there.
 */
export default function XpBarOverlay() {
  const {level, xpIntoLevel, xpForLevel, progress, activeSkinColor} =
    useGamification();

  // Keep a sliver visible at 0 XP so the bar reads as a container, not a void.
  const fill = Math.max(progress * 100, progress > 0 ? 2 : 0);

  return (
    <View style={styles.root} pointerEvents="none">
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {width: `${fill}%`, backgroundColor: activeSkinColor},
          ]}
        />
      </View>

      <View style={styles.labels}>
        <Text style={styles.level}>LV {level}</Text>
        <Text style={styles.xp}>
          {xpIntoLevel}/{xpForLevel} XP
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, justifyContent: 'center'},

  /** The empty container. Dark and translucent so it works on any wallpaper. */
  track: {
    position: 'absolute',
    left: 10,
    right: 10,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(8,12,20,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
    overflow: 'hidden',
  },
  fill: {height: '100%', borderRadius: 6},

  /**
   * Sits on top of the fill rather than beside it: at 18dp there is no room for
   * a row, and the text has to stay legible whether the bar behind it is empty
   * or full.
   */
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
  },
  level: {
    color: '#f8fafc',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowRadius: 2,
  },
  xp: {
    color: '#e2e8f0',
    fontSize: 9,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowRadius: 2,
  },
});
