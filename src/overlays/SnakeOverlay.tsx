import React, {useMemo, useRef, useState} from 'react';
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
const MINUTES_PER_DP = 0.4; // 340dp of drag ~= 120 min
const MIN_MINUTES = 5;
const MAX_MINUTES = 120;
const SNAP_MINUTES = 5;
const MAX_DRAG_DP = 340;
const COMMIT_THRESHOLD_DP = 20;
const SEGMENTS = 10;
const HANDLE_SIZE = 34;

/**
 * Idle: a small pill. The window swallows every touch inside its bounds, so at
 * rest it must be no bigger than the handle -- otherwise it punches a dead zone
 * into whatever app is underneath.
 */
export const SNAKE_LAYOUT = {
  width: 96,
  height: 56,
  gravity: 'top' as const,
  touchThrough: true,
  focusable: false,
};

/** Grown on drag start so a full-length pull is not clipped by the window. */
export const SNAKE_LAYOUT_DRAGGING = {
  width: 220,
  height: 440,
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
 * The demo hook: drag the handle down, the snake stretches, release to start a
 * focus session whose length is proportional to how far you pulled.
 */
export default function SnakeOverlay() {
  const session = useFocusSession();

  // Animated.Value, NOT state. Driving this from setState re-rendered the whole
  // tree 60x/second and visibly stuttered during the one moment that matters.
  const dragY = useRef(new Animated.Value(0)).current;

  const dragRef = useRef(0);
  const lastMinutes = useRef(0);
  const grown = useRef(false);

  // The only thing that legitimately needs React state: the label text, which
  // cannot be driven by the native driver. Updated ~10x per drag, not 60x/s.
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
          reset();

          if (distance < COMMIT_THRESHOLD_DP) {
            return; // a tap, not a pull
          }
          Vibration.vibrate(30); // commit
          const blocklist = await Storage.getBlocklist();
          await Focus.startSession(minutesFor(distance), blocklist);
        },

        onPanResponderTerminate: reset,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.isActive],
  );

  function reset() {
    dragRef.current = 0;
    lastMinutes.current = 0;
    setMinutes(0);
    setDragging(false);

    Animated.spring(dragY, {
      toValue: 0,
      useNativeDriver: true,
      tension: 90,
      friction: 9,
    }).start(() => {
      grown.current = false;
      Overlay.setLayout('SnakeOverlay', SNAKE_LAYOUT).catch(() => {});
    });
  }

  if (session.isActive) {
    return (
      <View style={styles.root} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.activePill}
          onPress={() => Focus.stopSession()}>
          <Text style={styles.activeText}>
            {formatRemaining(session.remainingMs)}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* body: a tapered trail following the handle, all on the native driver */}
      {dragging &&
        Array.from({length: SEGMENTS}).map((_, i) => {
          const t = (i + 1) / (SEGMENTS + 1);
          const size = HANDLE_SIZE - t * 20;
          return (
            <Animated.View
              key={i}
              pointerEvents="none"
              style={[
                styles.segment,
                {
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  opacity: 1 - t * 0.6,
                  transform: [
                    {
                      translateY: dragY.interpolate({
                        inputRange: [0, MAX_DRAG_DP],
                        outputRange: [0, MAX_DRAG_DP * t],
                      }),
                    },
                  ],
                },
              ]}
            />
          );
        })}

      <Animated.View
        {...pan.panHandlers}
        style={[styles.handle, {transform: [{translateY: dragY}]}]}>
        <Text style={styles.handleText}>{dragging ? `${minutes}` : '↓'}</Text>
        {dragging ? <Text style={styles.handleUnit}>min</Text> : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, alignItems: 'center'},
  handle: {
    position: 'absolute',
    top: 6,
    width: 72,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    backgroundColor: '#1f6feb',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 3,
    elevation: 6,
  },
  handleText: {color: '#fff', fontWeight: '800', fontSize: 17},
  handleUnit: {color: '#cfe0ff', fontWeight: '600', fontSize: 11},
  segment: {position: 'absolute', top: 6, backgroundColor: '#1f6feb'},
  activePill: {
    position: 'absolute',
    top: 6,
    paddingHorizontal: 16,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    backgroundColor: '#1f6feb',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  activeText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
});
