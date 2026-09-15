import React, {useState} from 'react';
import {LayoutChangeEvent, StyleSheet, Text, View} from 'react-native';
import {useGamification} from '../state/gamificationStore';
import {useNativeProgress} from '../state/nativeClock';
import {TASK_CARD_LAYOUT} from './TaskCardOverlay';
import {XP_BAR_HEIGHT} from './XpBarOverlay';

/**
 * THE XP IN FLIGHT -- a window that exists for about a second.
 *
 * The task panel and the XP bar are SEPARATE system windows: one anchored to the
 * right edge, one 18dp tall across the top. Nothing can be drawn across that
 * boundary, so the XP cannot literally leave one and arrive in the other. This
 * overlay is the screen-sized stage they are both pinned to -- it goes up when a
 * task is ticked, carries the point from the row to the bar, and is removed
 * again by `Overlay.hideAfter`.
 *
 * Two things here are load-bearing rather than stylistic:
 *
 *  - `touchable: false`. An overlay window swallows every touch inside its own
 *    bounds and unhandled touches are NOT forwarded (HANDOFF.md section 5). A
 *    full-screen window without FLAG_NOT_TOUCHABLE would make the entire phone
 *    unresponsive for as long as it was up.
 *  - The removal is queued NATIVELY the moment the window appears. A JS timer
 *    would not fire -- overlays are only ever seen while Tether is backgrounded
 *    -- and this thing covers the screen, so "probably leaves" is not good
 *    enough. Native owns both the clock it animates on and the clock it dies on.
 */

/** One flourish, start to finish. Also what hideAfter is measured against. */
export const XP_FLIGHT_MS = 1200;

/** Grace after the last frame, so the window is not torn down mid-paint. */
export const XP_FLIGHT_HIDE_GRACE_MS = 150;

export const XP_FLIGHT_LAYOUT = {
  width: -1, // MATCH_PARENT
  height: -1, // MATCH_PARENT
  gravity: 'top' as const,
  touchThrough: true,
  /** Decorative and screen-sized: it must never take a touch. See above. */
  touchable: false,
  focusable: false,
};

/**
 * Rotated by run id, so two ticks in a row never say the same thing.
 *
 * Short enough to read in the second the card is on screen, and phrased as
 * "carry on" rather than "well done" -- the point of the panel is the next task,
 * not the one just cleared.
 */
export const ENCOURAGEMENTS = [
  "Great — you're in flow. Line up another one.",
  'One down. Momentum is doing the work now.',
  'Cleared. Grab the next smallest thing.',
  "Flow state holding. What's next?",
  'Nice work. Keep the run going.',
];

/* -- the path ------------------------------------------------------------- */

/** Fraction of the run the token spends travelling; the rest holds the words. */
const FLY_FRACTION = 0.48;

/** How far above the bar the arc bulges, in dp. */
const ARC_LIFT = 46;

const TOKEN_W = 58;
const TOKEN_H = 28;

const easeInOut = (u: number) =>
  u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;

const clamp01 = (u: number) => Math.min(1, Math.max(0, u));

/** Progress of `u` through the window [from, to], clamped to 0..1. */
const ramp = (u: number, from: number, to: number) =>
  clamp01((u - from) / Math.max(to - from, 0.0001));

const bezier = (p0: number, c: number, p1: number, u: number) =>
  (1 - u) * (1 - u) * p0 + 2 * (1 - u) * u * c + u * u * p1;

type Props = {
  /** The native clock run this flourish paints. See src/state/nativeClock.ts. */
  runId?: number;
  /** Where the tick control was, in TaskCardOverlay's own window coordinates. */
  fromX?: number;
  fromY?: number;
  /** XP actually awarded, so the token cannot claim points that were not paid. */
  amount?: number;
};

export default function XpFlightOverlay({
  runId,
  fromX = 0,
  fromY = 0,
  amount = 0,
}: Props) {
  // dp size of this window, i.e. the display minus the system bars. Every other
  // overlay is laid out inside that same box, which is what makes the task
  // panel's position derivable below instead of guessed.
  const [size, setSize] = useState<{w: number; h: number} | null>(null);
  const onLayout = (e: LayoutChangeEvent) =>
    setSize({
      w: e.nativeEvent.layout.width,
      h: e.nativeEvent.layout.height,
    });

  const {progress, activeSkinColor} = useGamification();
  const {t} = useNativeProgress(runId ?? null);

  // Nothing until the first frame lands: a token parked at its start point
  // while this root mounts would read as a stutter.
  if (t === null || size === null || amount <= 0) {
    return <View style={styles.root} pointerEvents="none" onLayout={onLayout} />;
  }

  /* Where the row was. TASK_CARD_LAYOUT is a right-anchored, vertically
   * centred window of a known size, so its origin inside this one is exact. */
  const panelX = size.w - TASK_CARD_LAYOUT.x - TASK_CARD_LAYOUT.width;
  const panelY = (size.h - TASK_CARD_LAYOUT.height) / 2;
  const startX = panelX + fromX;
  const startY = panelY + fromY;

  /* Where it lands: the leading edge of the bar's fill, which the award has
   * already moved. The point arrives exactly where the bar just grew to. */
  const trackLeft = 10;
  const trackWidth = size.w - 20;
  const targetX = trackLeft + clamp01(Math.max(progress, 0.02)) * trackWidth;
  const targetY = XP_BAR_HEIGHT / 2;

  const fly = easeInOut(ramp(t, 0, FLY_FRACTION));
  const x = bezier(startX, startX, targetX, fly);
  const y = bezier(startY, targetY - ARC_LIFT, targetY, fly);

  // Swells as it leaves the row, shrinks into the bar as it arrives.
  const tokenScale = 0.65 + 0.55 * Math.sin(Math.PI * Math.min(fly * 1.15, 1));
  const tokenOpacity = ramp(t, 0, 0.08) * (1 - ramp(fly, 0.86, 1));

  // The bar taking the hit: a ring at the landing point, once, on arrival.
  const impact = ramp(t, FLY_FRACTION - 0.04, FLY_FRACTION + 0.22);
  const impactScale = 0.3 + 2.4 * impact;

  const message = ENCOURAGEMENTS[(runId ?? 0) % ENCOURAGEMENTS.length];
  const wordsIn = ramp(t, 0.1, 0.28);
  const wordsOut = ramp(t, 0.85, 1);
  const wordsOpacity = wordsIn * (1 - wordsOut);

  return (
    <View style={styles.root} pointerEvents="none" onLayout={onLayout}>
      {impact > 0 && impact < 1 ? (
        <View
          style={[
            styles.impact,
            {
              left: targetX - 13,
              top: targetY - 13,
              borderColor: activeSkinColor,
              opacity: 0.55 * (1 - impact),
              transform: [{scale: impactScale}],
            },
          ]}
        />
      ) : null}

      <View
        style={[
          styles.token,
          {
            left: x - TOKEN_W / 2,
            top: y - TOKEN_H / 2,
            borderColor: activeSkinColor,
            opacity: tokenOpacity,
            transform: [{scale: tokenScale}],
          },
        ]}>
        <Text style={[styles.tokenAmount, {color: activeSkinColor}]}>
          +{amount}
        </Text>
        <Text style={styles.tokenUnit}>XP</Text>
      </View>

      <View
        style={[
          styles.words,
          {
            opacity: wordsOpacity,
            transform: [{translateY: -10 + 10 * easeInOut(wordsIn)}],
          },
        ]}>
        <View style={[styles.wordsDot, {backgroundColor: activeSkinColor}]} />
        <Text style={styles.wordsText} numberOfLines={2}>
          {message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Transparent stage. Everything on it is absolutely placed. */
  root: {flex: 1},

  /** The point itself, in flight. */
  token: {
    position: 'absolute',
    width: TOKEN_W,
    height: TOKEN_H,
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: 'rgba(8,12,20,0.94)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  tokenAmount: {fontSize: 14, fontWeight: '900'},
  tokenUnit: {
    color: '#cbd5e1',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: 1,
  },

  /** Expanding ring where the point meets the bar. */
  impact: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
  },

  /**
   * Centred under the bar the point just flew into, but BELOW the snake's own
   * window (168px of it, ~64dp) -- the session timer and the + are live
   * controls, and a card that sat on top of them for a second would read as the
   * flourish breaking the UI even though touches pass straight through it.
   */
  words: {
    position: 'absolute',
    top: XP_BAR_HEIGHT + 96,
    alignSelf: 'center',
    maxWidth: 300,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: 'rgba(8,12,20,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.3)',
  },
  wordsDot: {width: 6, height: 6, borderRadius: 3},
  wordsText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
});
