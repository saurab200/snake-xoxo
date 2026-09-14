import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import {Focus, Overlay} from '../native';
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
  height: 80,
  gravity: 'top' as const,
  touchThrough: true,
  focusable: false,
};

function minutesFor(dragDp: number): number {
  const raw = Math.abs(dragDp) * MINUTES_PER_DP;
  const snapped = Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, snapped));
}

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

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !session.isActive,
        onMoveShouldSetPanResponder: () => !session.isActive,

        onPanResponderGrant: () => {
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
  useEffect(() => {
    if (dragging) {
      return; // the drag layout owns the window while a pull is in progress
    }
    Overlay.setLayout(
      'SnakeOverlay',
      resting ? SNAKE_LAYOUT_ACTIVE : SNAKE_LAYOUT,
    ).catch(() => {});
  }, [resting, dragging]);

  const coiled = (
    <View style={styles.coil} pointerEvents="box-none">
      {SEGMENT_DATA.map((seg, i) => {
        // The tail starts moving first, so outer segments lead the uncoil.
        const startAt = ((SEGMENTS - 1 - i) / SEGMENTS) * 90;
        // The whole tail region is draggable, not a single 7dp dot -- both
        // because that is a usable touch target and because "grab the tail" is
        // what the gesture is supposed to feel like.
        const isTail = i >= SEGMENTS - 7;
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
            {...(isTail ? pan.panHandlers : {})}
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

      {/* duration readout, anchored to the head so it stays legible */}
      {dragging ? (
        <View style={styles.readout}>
          <Text style={styles.readoutValue}>{minutes}</Text>
          <Text style={styles.readoutUnit}>min</Text>
        </View>
      ) : null}
    </View>
  );

  // --- resting, no session -------------------------------------------------
  if (!session.isActive && !session.isLockedOut) {
    return (
      <View style={styles.root} pointerEvents="box-none">
        {coiled}
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

  activeRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 4,
  },
  activeCoil: {width: 52, height: 50, transform: [{scale: 0.48}]},
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
