import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  Animated,
  DeviceEventEmitter,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import {Focus, Overlay} from '../native';
import {isSnakePeeking, setSnakePeeking} from '../state/bootstrap';
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
  color: string;
  coilX: number;
  coilY: number;
  /** 0 at the head, 1 at the tail. */
  t: number;
};

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
      // Head is deepest green, body lightens toward the tail.
      color:
        i === 0
          ? '#166534'
          : `rgb(${Math.round(34 + t * 70)}, ${Math.round(
              180 - t * 10,
            )}, ${Math.round(84 + t * 50)})`,
      coilX: p.x,
      coilY: p.y,
    };
  });
}

const SEGMENT_DATA: Segment[] = buildSpiral();
const SEGMENTS = SEGMENT_DATA.length;


/** Idle: a coiled snake, small enough not to punch a hole in the app below. */
export const SNAKE_LAYOUT = {
  width: 120,
  height: 110,
  gravity: 'top' as const,
  touchThrough: true,
  focusable: false,
};

/**
 * Peek: the snake has retreated up behind the bezel and only the tip of its
 * tail is showing. Small enough to be ignorable, big enough to grab.
 */
export const SNAKE_LAYOUT_PEEK = {
  width: 64,
  height: 34,
  /**
   * Offset clear of the status bar.
   *
   * The status bar is ~24dp of TYPE_STATUS_BAR, which sits ABOVE application
   * overlays in z-order and swallows touches for the shade pull-down. At y=0
   * the tail was drawn correctly but was completely untappable -- the system
   * took every touch before it reached us.
   */
  y: 26,
  gravity: 'top' as const,
  touchThrough: true,
  focusable: false,
};

/** Idle this long with no session and no touch, and the snake goes to peek. */
const IDLE_HIDE_MS = 10 * 60 * 1000;

/**
 * Force the snake to the bezel immediately, without waiting out the idle
 * timer. Used by the dev panel, and handy for demoing the peek state.
 */
export const PEEK_NOW_EVENT = 'tether:peekNow';

/** Grown while dragging so a full pull is not clipped by the window. */
export const SNAKE_LAYOUT_DRAGGING = {
  width: 170,
  height: 440,
  gravity: 'top' as const,
  touchThrough: true,
  focusable: false,
};

/** Active: coiled snake plus the timer and add-reminder pills beside it. */
export const SNAKE_LAYOUT_ACTIVE = {
  width: 320,
  height: 104,
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
const SnakeBody = React.memo(function SnakeBody({dragY}: SnakeBodyProps) {
  return (
    <>
      {SEGMENT_DATA.map((seg, i) => {
        // The tail starts moving first, so outer segments lead the uncoil.
        const startAt = ((SEGMENTS - 1 - i) / SEGMENTS) * 90;
        const isHead = i === 0;

        const translateX = dragY.interpolate({
          inputRange: [startAt, MAX_DRAG_DP],
          outputRange: [seg.coilX, 0],
          extrapolate: 'clamp',
        });
        const translateY = dragY.interpolate({
          inputRange: [startAt, MAX_DRAG_DP],
          outputRange: [seg.coilY, MAX_DRAG_DP * seg.t],
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
                backgroundColor: seg.color,
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

  // Animated.Value, NOT state: driving this from setState re-rendered the whole
  // tree 60x/second and visibly stuttered during the one moment that matters.
  const dragY = useRef(new Animated.Value(0)).current;

  const dragRef = useRef(0);
  const lastMinutes = useRef(0);
  const grown = useRef(false);

  const [minutes, setMinutes] = useState(0);
  const [dragging, setDragging] = useState(false);
  /**
   * Seeded by READING module scope, not from an initial prop.
   *
   * Props go native -> Bundle -> JS on mount, which is an extra hop that can
   * arrive empty; the module variable is simply there. Same bundle, same JS
   * context, so it is always current.
   */
  const [peeking, setPeekingState] = useState(() => isSnakePeeking());

  // Keep the module-scope copy in step so the state survives a remount.
  const setPeeking = (value: boolean) => {
    setSnakePeeking(value);
    setPeekingState(value);
  };
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !session.isActive,
        onMoveShouldSetPanResponder: () => !session.isActive,

        onPanResponderGrant: () => {
          wake();
          setDragging(true);
          if (!grown.current) {
            grown.current = true;
            Overlay.setLayout('SnakeOverlay', SNAKE_LAYOUT_DRAGGING).catch(
              () => {},
            );
          }
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
          recoil();

          if (distance < COMMIT_THRESHOLD_DP) {
            return; // a tap, not a pull
          }
          Vibration.vibrate(30); // commit
          const blocklist = await Storage.getBlocklist();
          await Focus.startSession(minutesFor(distance), blocklist);
        },

        onPanResponderTerminate: recoil,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.isActive],
  );

  function recoil() {
    dragRef.current = 0;
    lastMinutes.current = 0;
    setMinutes(0);
    setDragging(false);

    Animated.spring(dragY, {
      toValue: 0,
      useNativeDriver: true,
      tension: 70,
      friction: 11,
    }).start(() => {
      grown.current = false;
    });
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

  /** Any interaction brings the snake back out and restarts the idle clock. */
  function wake() {
    setPeeking(false);
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  }

  // The snake stays fully visible for the whole of an operation, and only
  // retreats to the bezel after a long stretch of doing nothing.
  useEffect(() => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    if (resting || dragging) {
      setPeeking(false);
      return;
    }
    idleTimer.current = setTimeout(() => setPeeking(true), IDLE_HIDE_MS);
    return () => {
      if (idleTimer.current) {
        clearTimeout(idleTimer.current);
      }
    };
  }, [resting, dragging]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(PEEK_NOW_EVENT, () => {
      if (!resting) {
        setPeeking(true);
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resting]);

  useEffect(() => {
    if (dragging) {
      return; // the drag layout owns the window while a pull is in progress
    }
    Overlay.setLayout(
      'SnakeOverlay',
      resting
        ? SNAKE_LAYOUT_ACTIVE
        : peeking
        ? SNAKE_LAYOUT_PEEK
        : SNAKE_LAYOUT,
    ).catch(() => {});
  }, [resting, dragging, peeking]);

  const coiled = (
    <View style={styles.coil} pointerEvents="box-none">
      <SnakeBody dragY={dragY} />
      {dragging ? <DurationReadout minutes={minutes} /> : null}
    </View>
  );

  /**
   * Peek and idle share ONE gesture host that is never unmounted.
   *
   * They used to be separate early-returns, so waking from peek swapped the
   * render branch mid-gesture and destroyed the very view holding the
   * responder. React Native then fired onPanResponderTerminate and cancelled
   * the pull: the snake came out, but no session ever started.
   *
   * The gesture also lives on the host rather than the tail segments now. At
   * this size the whole snake is barely a thumb wide, so restricting the grab
   * to the tail bought nothing and made the target needlessly fussy.
   */
  if (!resting) {
    return (
      <View
        style={peeking ? styles.peekRoot : styles.root}
        pointerEvents="box-none">
        <View
          {...pan.panHandlers}
          style={peeking ? styles.peekGrab : styles.coilGrab}>
          {peeking ? (
            <>
              <View style={styles.peekBody} />
              <View style={styles.peekTip} />
            </>
          ) : (
            coiled
          )}
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
      <View style={styles.activeCoil}>{coiled}</View>

      <TouchableOpacity
        style={[styles.pill, lockedOut && styles.pillLocked]}
        onPress={() => !lockedOut && Focus.stopSession()}>
        <Text style={styles.pillText}>{label}</Text>
        {lockedOut ? <Text style={styles.pillSub}>locked</Text> : null}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.plusPill}
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

  peekRoot: {flex: 1, alignItems: 'center'},
  /** Gesture host in the coil state; sized to the coil so it catches the body. */
  coilGrab: {width: COIL_BOX, height: 150, alignItems: 'center'},
  /** Generous hit area; the visible part is deliberately tiny. */
  peekGrab: {
    width: 64,
    height: 34,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  // Reads as a body disappearing up behind the bezel, tapering to a tip.
  peekBody: {
    width: 22,
    height: 15,
    borderBottomLeftRadius: 11,
    borderBottomRightRadius: 11,
    backgroundColor: '#22c55e',
    borderWidth: 1.5,
    borderTopWidth: 0,
    borderColor: '#14532d',
  },
  peekTip: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#4ade80',
    borderWidth: 1,
    borderColor: '#14532d',
    marginTop: 1,
  },
  activeRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 4,
  },
  /**
   * Must be the coil's REAL box (COIL_BOX x 100), not the size it appears at
   * after scaling. A smaller wrapper does not crop the coil -- it overflows it,
   * and the overlay window then clips the snake's lower body off.
   *
   * `transform: scale` does not shrink the layout box, so the negative side
   * margins claw back the empty space the scale leaves, keeping the row tight.
   */
  activeCoil: {
    width: COIL_BOX,
    height: 100,
    transform: [{scale: 0.5}],
    marginLeft: -26,
    marginRight: -26,
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
