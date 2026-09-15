import React, {useCallback, useEffect, useState} from 'react';
import {
  AppState,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {Overlay} from '../native';
import {
  levelForPoints,
  levelInfoFor,
  useGamification,
} from '../state/gamificationStore';

/**
 * THE REWARD MOMENT.
 *
 * Shown when a focus session completes. It has to be an OVERLAY rather than a
 * screen in App.tsx, because when a session ends the user is not in Tether --
 * they are in whatever app they were using, or on the home screen. A modal
 * inside the app would be seen minutes later, if at all, and the reward loop
 * only works if the payoff lands at the moment the work finishes.
 *
 * Deliberately NOT focusable and NOT touch-modal: a celebration that swallows
 * the back button or blocks the app underneath is a bug, not a flourish. It
 * dismisses on tap and takes itself down after AUTO_DISMISS_MS regardless.
 *
 * WHY NOTHING HERE IS TIME-DRIVEN BY DEFAULT
 * ------------------------------------------
 * By the time a session ends, Android has paused MainActivity -- the user is in
 * another app. In that state React Native stops driving ReactChoreographer AND
 * pauses JS timers, so `Animated`, `setInterval` and `setTimeout` all freeze.
 * `useNativeDriver` does not help; it is still frame-driven.
 *
 * This was measured, not guessed. The first version faded in from opacity 0 with
 * Animated: the window was created at the right size and React mounted with the
 * right props, but no frame ever ran, so the card stayed at opacity 0 and the
 * celebration was invisible in the only situation it exists for. Replacing
 * Animated with setInterval failed identically -- and the 4.6s auto-dismiss also
 * never fired, leaving the window up indefinitely, which is what proved that
 * timers are paused too.
 *
 * So: the card renders its FINISHED state on first paint and depends on nothing
 * to become visible. Motion is an enhancement, applied only while the host is
 * resumed (the in-app preview, or a session that ends with Tether open).
 *
 * State updates themselves DO work while paused -- native events keep arriving,
 * which is how BlockOverlay counts down over other apps -- so tap-to-dismiss
 * still works.
 */

type Props = {
  /**
   * Changes on every award. Required because OverlayManager.show() on an
   * already-visible window only pushes new props -- React never remounts -- so
   * without a changing value a second session would silently replay nothing.
   */
  nonce?: number;
  pointsAwarded?: number;
  /** Name of a skin this award just unlocked, if any. */
  unlockedSkin?: string;
};

export const REWARD_LAYOUT = {
  width: Overlay.MATCH_PARENT,
  height: 300,
  gravity: 'center' as const,
  /** Never take key input; the back button must keep working underneath. */
  focusable: false,
  /** Taps outside the card reach the app below. */
  touchThrough: true,
};

const AUTO_DISMISS_MS = 4600;
const COUNT_UP_MS = 700;
const TRACK_WIDTH = 232;
/** ~30fps. Enough to read as motion, few enough renders to stay cheap. */
const FRAME_MS = 33;

/** Decelerating ease, so the number and bar land softly. */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export default function RewardOverlay({
  nonce = 0,
  pointsAwarded = 0,
  unlockedSkin,
}: Props) {
  /**
   * Read the rest from the module store rather than passing it over the bridge.
   * The overlay shares this JS context with the app, so totalPoints, level and
   * the active skin colour are simply available -- and staying off the Bundle
   * keeps the prop surface to the two things the store cannot know: which award
   * this is, and how big it was.
   */
  const {totalPoints, activeSkinColor, level, xpToNext} = useGamification();

  // Where the bar sat before this award, so it can visibly travel.
  const before = Math.max(0, totalPoints - pointsAwarded);
  const startProgress = levelInfoFor(before).progress;
  const endProgress = levelInfoFor(totalPoints).progress;
  const leveledUp = levelForPoints(totalPoints) > levelForPoints(before);

  /**
   * Single 0..1 driver for the whole card, seeded at 1 = FINISHED.
   *
   * Seeding at the end state is the fix: the card is fully readable on its very
   * first paint, so it cannot be hidden by an animation that never runs.
   */
  const [t, setT] = useState(1);

  const dismiss = useCallback(() => {
    Overlay.hide('RewardOverlay').catch(() => {});
  }, []);

  useEffect(() => {
    // Re-runs on every new award because `nonce` changes, which is the only
    // signal available when the window is reused without a remount.

    // Animate only when the host is resumed. Backgrounded, neither timers nor
    // Animated advance, so starting from 0 would leave the card invisible.
    if (AppState.currentState !== 'active') {
      setT(1);
      return;
    }

    setT(0);
    const startedAt = Date.now();
    const ticker = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= COUNT_UP_MS) {
        setT(1);
        clearInterval(ticker);
        return;
      }
      setT(elapsed / COUNT_UP_MS);
    }, FRAME_MS);

    return () => clearInterval(ticker);
  }, [nonce]);

  /**
   * Dismissal, belt and braces.
   *
   * The timeout is the normal path but only fires while the host is resumed, so
   * a card shown over another app waits for a tap. The AppState listener is the
   * safety net: whatever happened while we were backgrounded, the celebration
   * never bleeds into the next time the user opens Tether.
   */
  useEffect(() => {
    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        dismiss();
      }
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [nonce, dismiss]);

  const eased = easeOut(t);

  /**
   * The entrance settles quickly (by a third of the way through) so the card is
   * legible while the number is still counting.
   */
  const appear = Math.min(1, t * 3);
  const cardStyle = {
    opacity: appear,
    transform: [
      {translateY: 26 * (1 - appear)},
      {scale: 0.92 + 0.08 * appear},
    ],
  };

  const displayXp = Math.round(pointsAwarded * eased);

  /**
   * Bar fill, as a width fraction of the track.
   *
   * On a level-up the bar runs to the top in the first 60% of the animation and
   * then fills into the new level, so the moment reads as "you crossed a line"
   * rather than "a bar moved". Width is fine here: this is a JS-driven
   * animation already, so there is no native driver to be excluded from.
   */
  const barProgress = leveledUp
    ? t < 0.6
      ? startProgress + (1 - startProgress) * easeOut(t / 0.6)
      : endProgress * easeOut((t - 0.6) / 0.4)
    : startProgress + (endProgress - startProgress) * eased;

  const fillStyle = {
    backgroundColor: activeSkinColor,
    width: Math.max(0, Math.min(1, barProgress)) * TRACK_WIDTH,
  };

  // The badge pops in once the bar has crossed over into the new level.
  const badgePop = leveledUp ? Math.max(0, Math.min(1, (t - 0.6) / 0.25)) : 0;
  const badgeStyle = {
    opacity: badgePop,
    transform: [{scale: 0.6 + 0.4 * badgePop}],
  };

  return (
    <View style={styles.root} pointerEvents="box-none">
      <TouchableWithoutFeedback onPress={dismiss}>
        <View style={[styles.card, cardStyle]}>
          <Text style={styles.eyebrow}>SESSION COMPLETE</Text>

          <View style={styles.xpRow}>
            <Text style={[styles.xpValue, {color: activeSkinColor}]}>
              +{displayXp}
            </Text>
            <Text style={styles.xpUnit}>XP</Text>
          </View>

          {leveledUp ? (
            <View
              style={[
                styles.levelUp,
                badgeStyle,
                {borderColor: activeSkinColor},
              ]}>
              <Text style={[styles.levelUpText, {color: activeSkinColor}]}>
                LEVEL {level}
              </Text>
            </View>
          ) : (
            <Text style={styles.levelLine}>Level {level}</Text>
          )}

          <View style={styles.track}>
            <View style={[styles.fill, fillStyle]} />
          </View>

          <Text style={styles.footnote}>
            {leveledUp
              ? `${xpToNext} XP to level ${level + 1}`
              : `${xpToNext} XP to level ${level + 1} · ${totalPoints} total`}
          </Text>

          {unlockedSkin ? (
            <Text style={[styles.unlocked, {color: activeSkinColor}]}>
              🐍 {unlockedSkin} skin unlocked
            </Text>
          ) : null}

          <Text style={styles.dismissHint}>tap to dismiss</Text>
        </View>
      </TouchableWithoutFeedback>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  card: {
    width: 288,
    backgroundColor: '#161b22',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#30363d',
    paddingVertical: 22,
    paddingHorizontal: 24,
    alignItems: 'center',
    // Reads as a floating card rather than part of the app underneath.
    elevation: 18,
  },
  eyebrow: {
    color: '#8b949e',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
  },
  xpRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginTop: 10,
  },
  xpValue: {
    fontSize: 52,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  xpUnit: {color: '#8b949e', fontSize: 16, fontWeight: '800'},
  levelUp: {
    marginTop: 6,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  levelUpText: {fontSize: 12, fontWeight: '900', letterSpacing: 1.5},
  levelLine: {
    color: '#e6edf3',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 8,
  },
  track: {
    width: TRACK_WIDTH,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: '#30363d',
    overflow: 'hidden',
    marginTop: 16,
  },
  /** Width is supplied per-frame by fillStyle; height fills the track. */
  fill: {height: '100%', borderRadius: 3},
  footnote: {color: '#8b949e', fontSize: 11, marginTop: 10},
  unlocked: {fontSize: 13, fontWeight: '700', marginTop: 12},
  dismissHint: {color: '#484f58', fontSize: 10, marginTop: 14},
});
