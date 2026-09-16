import React, {useState} from 'react';
import {LayoutChangeEvent, StyleSheet, Text, View} from 'react-native';
import {useGamification} from '../state/gamificationStore';
import {useNativeProgress} from '../state/nativeClock';
import {XP_BAR_HEIGHT} from './XpBarOverlay';

/**
 * THE XP IN FLIGHT -- a window that exists for about three seconds.
 *
 * The task panel and the XP bar are SEPARATE system windows: one anchored to the
 * right edge, one 18dp tall across the top. Nothing can be drawn across that
 * boundary, so the XP cannot literally leave one and arrive in the other. This
 * overlay is the screen-sized stage they are both pinned to -- it goes up when a
 * task is ticked, holds the point in the middle of the screen, carries it up
 * to the bar and leaves the encouragement in its place, then is removed again
 * by `Overlay.hideAfter`.
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

/**
 * One flourish, start to finish. Also what hideAfter is measured against.
 *
 * Three seconds, and nearly two of them are the words. The flourish used to be
 * 1.2s of mostly travel, which was long enough to see and far too short to
 * READ -- the sentence was gone before it had been taken in. The point of the
 * card is the encouragement; the token is how it gets announced.
 */
export const XP_FLIGHT_MS = 3000;

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
 * Short enough to read in the ~1.9s the card is on screen, and phrased as
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

/**
 * THE TIMELINE, in fractions of XP_FLIGHT_MS.
 *
 *   0                 HOLD_UNTIL            FLY_FRACTION            1
 *   |── pop in ──┬── hold at centre ──┬── fly to the bar ──┬── words ──|
 *                                     └── words fade in ───────────────┘
 *
 * The token is born in the MIDDLE OF THE SCREEN rather than at the tick box.
 * Starting it on the row meant it launched from wherever the user's thumb was,
 * off to one side and already moving -- easy to miss entirely. Centre-screen it
 * gets a beat to be noticed before it goes anywhere.
 *
 * It then leaves, and the words take the space it was occupying. That hand-off
 * is the whole idea: the eye is already on the centre of the screen, so the
 * sentence appears where the user is looking instead of somewhere else.
 */

/** Token holds at centre until here -- deliberately under a second. */
const HOLD_UNTIL = 0.27;

/**
 * When the token reaches the bar, as a fraction of the run.
 *
 * Exported because the bar's XP is released on arrival, not at the end of the
 * run: everything after this is the words being read, and holding the points
 * back for that too left a visible beat where the token had clearly landed but
 * the bar had not moved yet.
 */
export const FLY_FRACTION = 0.5;

/** The words: in as the token departs, out once there has been time to read. */
const WORDS_IN_FROM = HOLD_UNTIL;
const WORDS_IN_TO = 0.34;
const WORDS_OUT_FROM = 0.88;
const WORDS_OUT_TO = 0.97;

/** How far above the bar the arc bulges, in dp. */
const ARC_LIFT = 46;

const TOKEN_W = 58;
const TOKEN_H = 28;

/** Tall enough for a two-line message to stay centred on the launch point. */
const WORDS_BAND_H = 96;

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
  /** XP actually awarded, so the token cannot claim points that were not paid. */
  amount?: number;
};

export default function XpFlightOverlay({
  runId,
  amount = 0,
}: Props) {
  // dp size of this window, i.e. the display minus the system bars. Both the
  // centre the token launches from and the bar it lands on are derived from it.
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

  /* Where it starts: the middle of the screen. Not the tick box -- see the
   * timeline note above for why the row is the wrong place to launch from. */
  const startX = size.w / 2;
  const startY = size.h / 2;

  /* Where it lands: the leading edge of the bar's fill as it stands NOW.
   *
   * The bar used to grow the instant the tick was pressed, so this aimed at the
   * edge the award had already created. The points are now held back until the
   * token gets here, so it aims at the edge as it is and the bar grows out from
   * under it -- the token is delivering the XP rather than chasing it. */
  const trackLeft = 10;
  const trackWidth = size.w - 20;
  const targetX = trackLeft + clamp01(Math.max(progress, 0.02)) * trackWidth;
  const targetY = XP_BAR_HEIGHT / 2;

  // 0 for the whole hold, then the journey. The token sits dead still at centre
  // until HOLD_UNTIL rather than creeping, which is what makes the hold read as
  // a deliberate beat instead of a slow start.
  const fly = easeInOut(ramp(t, HOLD_UNTIL, FLY_FRACTION));
  const x = bezier(startX, startX, targetX, fly);
  const y = bezier(startY, targetY - ARC_LIFT, targetY, fly);

  // Pops in, settles to full size for the hold, then shrinks into the bar.
  const pop = ramp(t, 0, 0.1);
  const holdScale = 0.6 + 0.4 * easeInOut(pop);
  const tokenScale = holdScale * (1 - 0.35 * easeInOut(fly));
  const tokenOpacity = pop * (1 - ramp(fly, 0.86, 1));

  // The bar taking the hit: a ring at the landing point, once, on arrival.
  const impact = ramp(t, FLY_FRACTION - 0.04, FLY_FRACTION + 0.22);
  const impactScale = 0.3 + 2.4 * impact;

  const message = ENCOURAGEMENTS[(runId ?? 0) % ENCOURAGEMENTS.length];
  const wordsIn = ramp(t, WORDS_IN_FROM, WORDS_IN_TO);
  const wordsOut = ramp(t, WORDS_OUT_FROM, WORDS_OUT_TO);
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

      {/* A band across the middle, so the card is centred on the point the
          token just left whether it wraps to one line or two. */}
      <View style={[styles.wordsBand, {top: startY - WORDS_BAND_H / 2}]}>
        <View
          style={[
            styles.words,
            {
              opacity: wordsOpacity,
              transform: [{translateY: 12 - 12 * easeInOut(wordsIn)}],
            },
          ]}>
          <View style={[styles.wordsDot, {backgroundColor: activeSkinColor}]} />
          <Text style={styles.wordsText} numberOfLines={2}>
            {message}
          </Text>
        </View>
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
   * The band the words are centred in, placed on the token's launch point.
   *
   * They used to sit just under the XP bar, which put the sentence at the top
   * of the screen while the eye was still down where the token had been. Now
   * the token vacates the centre and the words move into it.
   *
   * Being mid-screen also keeps it clear of the snake's own window at the top,
   * whose session timer and + are live controls -- a card parked over them
   * reads as the flourish having broken the UI, even though every touch passes
   * straight through this one.
   */
  wordsBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: WORDS_BAND_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  words: {
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
