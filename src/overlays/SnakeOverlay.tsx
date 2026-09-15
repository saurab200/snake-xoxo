import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import {Focus, Overlay} from '../native';
import {useGamification} from '../state/gamificationStore';
import {XP_BAR_HEIGHT} from './XpBarOverlay';
import {Storage} from '../state/storage';
import {formatRemaining, useFocusSession} from '../state/useFocusSession';

/* ---- tuning knobs: this is the feel of the whole product ---- */
const MINUTES_PER_DP = 0.4;
const MIN_MINUTES = 5;
const MAX_MINUTES = 120;
const SNAP_MINUTES = 5;
const MAX_DRAG_DP = 340;
const COMMIT_THRESHOLD_DP = 20;

const HEAD_SIZE = 19;
const TAIL_SIZE = 5;

/**
 * Spiral geometry -- two competing constraints:
 *
 *  1. Consecutive segments must OVERLAP along the path, or the body reads as a
 *     row of dots instead of a continuous snake.
 *  2. Successive TURNS must NOT overlap, or the whole thing reads as a blob.
 *
 * Stepping by a constant angle fails both at once: circles bunch up near the
 * centre and gap badly at the rim. So we walk the spiral by constant ARC LENGTH
 * instead -- dTheta = arcStep / radius -- which keeps body spacing even, and let
 * the radius grow fast enough that neighbouring turns stay clear.
 */
const ARC_STEP = 7; // dp between segment centres, < body width => continuous
const GROWTH_PER_RADIAN = 3.1; // => ~19dp between turns, > body width => separated
const START_RADIUS = 8;
const MAX_RADIUS = 38;
const COIL_BOX = 110;

type Segment = {
  size: number;
  coilX: number;
  coilY: number;
  /** 0 at the head, 1 at the tail. */
  t: number;
};

/* ---- skin palette -------------------------------------------------------
 * GAMIFICATION, colour only.
 *
 * The geometry above is untouched: the unlocked skin only re-tints the snake.
 * One base colour is expanded into the three shades the snake has always used
 * (dark head, lightening body, darker rim), so any skin reads as the same snake.
 */

type Palette = {
  head: string;
  border: string;
  /** Body colour at t (0 = behind the head, 1 = tail tip). */
  body: (t: number) => string;
  /** Bright accent. The peek nub it was written for is gone; kept for the
   *  bezel tail and anything else that wants the undimmed skin colour. */
  accent: string;
};

/** The snake's original green, used whenever a skin colour is unparseable. */
const FALLBACK_RGB = {r: 34, g: 197, b: 94};

function hexToRgb(hex: string): {r: number; g: number; b: number} {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map(c => c + c)
          .join('')
      : clean;

  if (full.length !== 6) {
    return FALLBACK_RGB;
  }

  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);

  return isNaN(r) || isNaN(g) || isNaN(b) ? FALLBACK_RGB : {r, g, b};
}

function shade(hex: string, factor: number, toward: 0 | 255): string {
  const {r, g, b} = hexToRgb(hex);
  const mix = (c: number) => Math.round(c + (toward - c) * factor);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function buildPalette(base: string): Palette {
  return {
    head: shade(base, 0.45, 0),
    border: shade(base, 0.58, 0),
    accent: base,
    body: (t: number) => shade(base, t * 0.28, 255),
  };
}

/** Walk the spiral outward from the head until it reaches MAX_RADIUS. */
function buildSpiral(): Segment[] {
  const polar: {r: number; theta: number}[] = [];
  let theta = 0;
  let radius = START_RADIUS;

  while (radius < MAX_RADIUS && polar.length < 60) {
    polar.push({r: radius, theta});
    const dTheta = ARC_STEP / radius;
    theta += dTheta;
    radius += GROWTH_PER_RADIAN * dTheta;
  }

  /**
   * Rotate the whole spiral so the TAIL ends up directly below the head.
   *
   * Without this the spiral winds out to the top of the coil, so the grab point
   * sat above the head and you had to drag down past it -- backwards, given the
   * gesture is "pull the tail down". Screen y grows downward, so putting the
   * last point at +PI/2 puts the tail at the bottom.
   */
  const lastTheta = polar[polar.length - 1].theta;
  const rotation = Math.PI / 2 - lastTheta;

  const points = polar.map(({r, theta: t}) => ({
    x: r * Math.cos(t + rotation),
    y: r * Math.sin(t + rotation),
  }));

  const n = points.length;
  return points.map((p, i) => {
    const t = i / (n - 1);
    return {
      t,
      size: HEAD_SIZE - (HEAD_SIZE - TAIL_SIZE) * t,
      coilX: p.x,
      coilY: p.y,
    };
  });
}

const SEGMENT_DATA: Segment[] = buildSpiral();
const SEGMENTS = SEGMENT_DATA.length;


/**
 * Every snake window is pushed down by the XP bar's height.
 *
 * The bar is bolted to the bezel and spans the full width, so without this the
 * tail would hang behind it. Offsetting here keeps "the snake lives in the
 * bezel" true -- it now hangs from the bar rather than from the screen edge.
 */
const TOP_OFFSET = XP_BAR_HEIGHT;

/** At rest the snake is in the bezel, so this only has to fit the tail. */
export const SNAKE_LAYOUT = {
  width: 96,
  height: 64,
  y: TOP_OFFSET,
  gravity: 'top' as const,
  touchThrough: true,
  focusable: false,
};

/**
 * THE SNAKE LIVES IN THE BEZEL.
 *
 * dragY is the one value driving everything, through three stops:
 *
 *   0 .......... tucked up behind the top edge, only the tail tip showing
 *   COIL_AT .... fully out, coiled
 *   MAX_DRAG ... fully extended into a line
 *
 * So how far the snake emerges is exactly how far you pull: a short tug barely
 * brings it out, and only a full pull gets the whole animal on screen.
 */
const COIL_AT = 80;

/** Vertical gap between segments while stacked up behind the bezel. */
const BEZEL_SPACING = 3.2;

/**
 * Where the tail tip rests, measured from the top of the overlay window.
 *
 * Must clear the status bar (~24dp of TYPE_STATUS_BAR, which sits ABOVE
 * application overlays and swallows touches for the shade pull-down). Anything
 * above this line is drawn but cannot be grabbed.
 */
const TAIL_REST_Y = 10;

/** After a committed pull: hold the coil, then crawl home. */
const COIL_HOLD_MS = 900;
const CRAWL_HOME_MS = 2400;
const RETRACT_MS = 450;

/** Grown while dragging so a full pull is not clipped by the window. */
export const SNAKE_LAYOUT_DRAGGING = {
  width: 170,
  height: 440,
  y: TOP_OFFSET,
  gravity: 'top' as const,
  touchThrough: true,
  focusable: false,
};

/** Active: coiled snake plus the timer and add-reminder pills beside it. */
export const SNAKE_LAYOUT_ACTIVE = {
  width: 320,
  height: 104,
  y: TOP_OFFSET,
  gravity: 'top' as const,
  touchThrough: true,
  focusable: false,
};

function minutesFor(dragDp: number): number {
  const raw = Math.abs(dragDp) * MINUTES_PER_DP;
  const snapped = Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, snapped));
}


type SnakeBodyProps = {
  dragY: Animated.Value;
  /** Active skin's base colour. A plain string, so React.memo still holds. */
  skinColor: string;
};

/**
 * The snake body, memoised.
 *
 * All 31 segments move purely through Animated interpolations of dragY, so this
 * tree never needs to re-render -- not when the minute readout changes at a
 * detent, and not on the once-a-second session tick. Before the memo it was
 * being reconciled ~10 times per drag and once per second during a session,
 * rebuilding 31 views and 62 interpolation nodes each time for no visual gain.
 */
const SnakeBody = React.memo(function SnakeBody({
  dragY,
  skinColor,
}: SnakeBodyProps) {
  // Derived once per skin change, not per render.
  const palette = useMemo(() => buildPalette(skinColor), [skinColor]);

  return (
    <>
      {SEGMENT_DATA.map((seg, i) => {
        const isHead = i === 0;

        /**
         * Resting position behind the bezel: the whole body stacked upward
         * from the tail, so everything but the last few segments sits above
         * the window and is clipped away.
         */
        const bezelY =
          TAIL_REST_Y - 44 - (SEGMENTS - 1 - i) * BEZEL_SPACING;

        const translateX = dragY.interpolate({
          inputRange: [0, COIL_AT, MAX_DRAG_DP],
          outputRange: [0, seg.coilX, 0],
          extrapolate: 'clamp',
        });
        const translateY = dragY.interpolate({
          inputRange: [0, COIL_AT, MAX_DRAG_DP],
          outputRange: [bezelY, seg.coilY, MAX_DRAG_DP * seg.t],
          extrapolate: 'clamp',
        });

        return (
          <Animated.View
            key={i}
            style={[
              styles.segment,
              {
                width: seg.size,
                height: seg.size,
                borderRadius: seg.size / 2,
                backgroundColor: isHead ? palette.head : palette.body(seg.t),
                borderColor: palette.border,
                marginLeft: -seg.size / 2,
                marginTop: -seg.size / 2,
                zIndex: SEGMENTS - i,
                transform: [{translateX}, {translateY}],
              },
            ]}>
            {isHead ? (
              <View style={styles.face}>
                <View style={styles.eye} />
                <View style={styles.eye} />
              </View>
            ) : null}
          </Animated.View>
        );
      })}
    </>
  );
});

/** Isolated so a detent re-renders one text node, not the whole body. */
const DurationReadout = React.memo(function DurationReadout({
  minutes,
}: {
  minutes: number;
}) {
  return (
    <View style={styles.readout}>
      <Text style={styles.readoutValue}>{minutes}</Text>
      <Text style={styles.readoutUnit}>min</Text>
    </View>
  );
});

/**
 * PERSON 1 (Person A) owns this file.
 *
 * The demo hook: a green snake coiled at the top of the screen. Grab its tail,
 * pull down, and it uncoils -- the further you pull, the longer the focus
 * session. Release and it recoils, with a timer pill and an add-reminder pill
 * appearing beside it.
 */
export default function SnakeOverlay() {
  const session = useFocusSession();
  /**
   * GAMIFICATION: read through the module-level store, NOT React context. This
   * overlay is its own React root mounted by OverlayManager, so it shares no
   * provider tree with App.tsx -- but it does share this JS module.
   */
  const {activeSkinColor} = useGamification();
  const palette = useMemo(() => buildPalette(activeSkinColor), [
    activeSkinColor,
  ]);

  // Animated.Value, NOT state: driving this from setState re-rendered the whole
  // tree 60x/second and visibly stuttered during the one moment that matters.
  const dragY = useRef(new Animated.Value(0)).current;

  const dragRef = useRef(0);
  const lastMinutes = useRef(0);
  const grown = useRef(false);

  const [minutes, setMinutes] = useState(0);
  const [dragging, setDragging] = useState(false);

  /**
   * When the snake will have finished animating home, as a timestamp.
   *
   * The big drag window has to stay up until then or the snake would be clipped
   * halfway through its own exit. This is a deadline rather than a boolean
   * because the resize it guards is scheduled natively -- see recoil().
   */
  const returnsAt = useRef(0);

  /**
   * What the window should become when the crawl home finishes.
   *
   * Needed because a committed pull knows a session is coming before the state
   * says so: startSession() is awaited after recoil() starts the animation, so
   * for a beat `resting` is still false. Without this the resize scheduled
   * mid-crawl targets the tiny idle window, and if the await ran past the
   * deadline the session pills would be laid out in a 96x64dp box.
   */
  const returnsTo = useRef(SNAKE_LAYOUT);

  const pan = useMemo(
    () =>
      PanResponder.create({
        /**
         * The window is grown on touch-DOWN, not on grant.
         *
         * Growing it once the drag was already underway re-laid-out the view
         * mid-gesture and swallowed most of the travel: a 420px pull was
         * registering as ~25dp, so the readout crept to 10 min and the release
         * never cleared the commit threshold. Resizing before any movement is
         * measured keeps gesture.dy honest.
         */
        onStartShouldSetPanResponder: () => {
          if (session.isActive) {
            return false;
          }
          grow();
          return true;
        },
        onMoveShouldSetPanResponder: () => !session.isActive,

        onPanResponderGrant: () => {
          grow();
          setDragging(true);
        },

        onPanResponderMove: (_, gesture) => {
          const next = Math.max(0, Math.min(MAX_DRAG_DP, gesture.dy));
          dragRef.current = next;
          dragY.setValue(next);

          const m = minutesFor(next);
          if (m !== lastMinutes.current) {
            lastMinutes.current = m;
            setMinutes(m);
            Vibration.vibrate(10); // detent
          }
        },

        onPanResponderRelease: async () => {
          const distance = dragRef.current;
          const committed = distance >= COMMIT_THRESHOLD_DP;
          recoil(committed);

          if (!committed) {
            return; // a tap, not a pull
          }
          Vibration.vibrate(30); // commit
          const blocklist = await Storage.getBlocklist();
          await Focus.startSession(minutesFor(distance), blocklist);
        },

        onPanResponderTerminate: () => recoil(false),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.isActive],
  );

  function grow() {
    if (grown.current) {
      return;
    }
    grown.current = true;
    Overlay.setLayout('SnakeOverlay', SNAKE_LAYOUT_DRAGGING).catch(() => {});
  }

  /**
   * A committed pull earns the full performance: the snake settles into a coil,
   * sits there for a beat, then crawls slowly back up into the bezel. A pull
   * too short to start anything just retracts -- it never fully emerges, so
   * there is nothing to show off.
   */
  function recoil(committed: boolean) {
    dragRef.current = 0;
    lastMinutes.current = 0;
    setMinutes(0);
    setDragging(false);

    // The gesture is over, so the next touch-down is free to grow the window
    // again. Reset here rather than when the animation ends: that callback is
    // not delivered while Tether is backgrounded.
    grown.current = false;

    const total = committed
      ? COIL_HOLD_MS + CRAWL_HOME_MS + 300
      : RETRACT_MS + 200;
    returnsAt.current = Date.now() + total;
    returnsTo.current = committed ? SNAKE_LAYOUT_ACTIVE : SNAKE_LAYOUT;

    /**
     * Book the shrink NATIVELY, now.
     *
     * Nothing in JS can be relied on to run when this animation ends. The
     * overlay is on screen exactly when Tether is backgrounded, and in that
     * state neither a setTimeout nor the completion callback of a native-driver
     * animation is delivered -- so the window used to stay at its full drag size
     * forever, clipping the + pill and leaving a 170x440dp slab over the
     * launcher.
     *
     * The effect below refines the target once the session state settles; each
     * call cancels the previous one, and a new pull cancels it outright.
     */
    Overlay.setLayoutAfter('SnakeOverlay', returnsTo.current, total).catch(
      () => {},
    );

    if (!committed) {
      Animated.timing(dragY, {
        toValue: 0,
        duration: RETRACT_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.sequence([
      Animated.spring(dragY, {
        toValue: COIL_AT,
        useNativeDriver: true,
        tension: 60,
        friction: 10,
      }),
      /**
       * A hold, expressed as a no-op timing rather than Animated.delay.
       *
       * Animated.delay defaults to the JS driver, and mixing drivers inside one
       * sequence broke the chain: the snake animated home correctly but the
       * completion callback never fired, so the window stayed at its full
       * drag size and the session pills rendered halfway down the screen.
       */
      Animated.timing(dragY, {
        toValue: COIL_AT,
        duration: COIL_HOLD_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(dragY, {
        toValue: 0,
        duration: CRAWL_HOME_MS,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }

  /**
   * The resting window size is driven from session state, NOT decided inside
   * recoil().
   *
   * It used to be set in the spring's completion callback, which closes over the
   * session value from the render that created it. On release that value is
   * still "idle" -- startSession() has not resolved yet -- so the window snapped
   * back to the narrow idle width and clipped the + pill off the right edge.
   */
  const resting = session.isActive || session.isLockedOut;

  useEffect(() => {
    if (dragging) {
      return; // mid-pull: the window is already at its full drag size
    }
    const wait = returnsAt.current - Date.now();

    if (wait > 0) {
      // Still crawling home. Hand the resize to the native clock, which keeps
      // running while Tether is backgrounded, and keep the target the pull
      // asked for -- session state may not have caught up yet.
      if (resting) {
        returnsTo.current = SNAKE_LAYOUT_ACTIVE;
      }
      Overlay.setLayoutAfter('SnakeOverlay', returnsTo.current, wait).catch(
        () => {},
      );
      return;
    }

    Overlay.setLayout(
      'SnakeOverlay',
      resting ? SNAKE_LAYOUT_ACTIVE : SNAKE_LAYOUT,
    ).catch(() => {});
  }, [resting, dragging]);

  const coiled = (
    <View style={styles.coil} pointerEvents="box-none">
      <SnakeBody dragY={dragY} skinColor={activeSkinColor} />
      {dragging ? <DurationReadout minutes={minutes} /> : null}
    </View>
  );

  if (!resting) {
    return (
      <View style={styles.root} pointerEvents="box-none">
        <View {...pan.panHandlers} style={styles.coilGrab}>
          {coiled}
        </View>
      </View>
    );
  }

  // --- active: coil + the two pills ---------------------------------------
  const lockedOut = session.isLockedOut;
  const label = lockedOut
    ? formatRemaining(session.lockoutRemainingMs)
    : formatRemaining(session.remainingMs);

  return (
    <View style={styles.activeRow} pointerEvents="box-none">
      <View {...pan.panHandlers} style={styles.activeCoil}>
        {coiled}
      </View>

      <TouchableOpacity
        style={[
          styles.pill,
          // Skin tint; the locked style still wins, it must always read as red.
          {backgroundColor: palette.head},
          lockedOut && styles.pillLocked,
        ]}
        onPress={() => !lockedOut && Focus.stopSession()}>
        <Text style={styles.pillText}>{label}</Text>
        {lockedOut ? <Text style={styles.pillSub}>locked</Text> : null}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.plusPill, {backgroundColor: palette.head}]}
        onPress={() =>
          Overlay.show(
            'ReminderOverlay',
            {
              width: Overlay.MATCH_PARENT,
              height: Overlay.MATCH_PARENT,
              gravity: 'center',
              focusable: true,
              touchThrough: false,
            },
            {},
          )
        }>
        <Text style={styles.plusText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, alignItems: 'center', justifyContent: 'flex-start'},
  coil: {width: COIL_BOX, height: 100, marginTop: 6},
  segment: {
    position: 'absolute',
    left: '50%',
    top: 44,
    alignItems: 'center',
    justifyContent: 'center',
    // A darker rim separates overlapping coils so the spiral stays readable.
    borderWidth: 1.5,
    borderColor: '#14532d',
  },
  face: {flexDirection: 'row', gap: 5, marginTop: -3},
  eye: {width: 5, height: 5, borderRadius: 3, backgroundColor: '#f0fdf4'},
  readout: {
    position: 'absolute',
    left: 74,
    top: 30,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
    backgroundColor: '#052e16',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  readoutValue: {color: '#4ade80', fontWeight: '800', fontSize: 20},
  readoutUnit: {color: '#86efac', fontWeight: '600', fontSize: 11},

  /** Gesture host in the coil state; sized to the coil so it catches the body. */
  coilGrab: {width: COIL_BOX, height: 150, alignItems: 'center'},
  /**
   * Pinned to the TOP, not centred.
   *
   * Centring meant the pills sat at the vertical middle of whatever the window
   * happened to be, which is only the right answer once it has settled at
   * 104dp. Aligning to the top makes their position independent of the window
   * height, so the timer and + appear directly under the status bar during the
   * crawl home and do not move afterwards. The window itself already starts
   * below the status bar, so no extra inset is needed.
   */
  activeRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 8,
  },
  /**
   * Same box and same top alignment as the resting window, so the tail is
   * clipped identically. Centring it here (or scaling it) made the snake look
   * noticeably longer during a session than at rest.
   */
  activeCoil: {
    width: 96,
    height: 64,
    overflow: 'hidden',
  },
  pill: {
    backgroundColor: '#16a34a',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 18,
    alignItems: 'center',
    elevation: 6,
  },
  pillLocked: {backgroundColor: '#b91c1c'},
  pillText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  pillSub: {color: '#fecaca', fontSize: 9, fontWeight: '700'},
  plusPill: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#16a34a',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  plusText: {color: '#fff', fontSize: 24, fontWeight: '700', marginTop: -3},
});
