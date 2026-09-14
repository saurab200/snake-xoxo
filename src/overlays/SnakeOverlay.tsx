import React, {useMemo, useRef, useState} from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {Focus} from '../native';
import {Storage} from '../state/storage';
import {formatRemaining, useFocusSession} from '../state/useFocusSession';

/* ---- tuning knobs: this is the feel of the whole product ---- */
const MINUTES_PER_DP = 0.4; // 300dp of drag ~= 120 min
const MIN_MINUTES = 5;
const MAX_MINUTES = 120;
const MAX_DRAG_DP = 340;
const SEGMENTS = 10;

export const SNAKE_LAYOUT = {
  width: 220,
  height: 420,
  gravity: 'top' as const,
  touchThrough: true,
  focusable: false,
};

function minutesFor(dragDp: number): number {
  const raw = Math.round(Math.abs(dragDp) * MINUTES_PER_DP);
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, raw));
}

/**
 * PERSON A owns this file.
 *
 * The demo hook: drag the handle down, the snake stretches, release to start a
 * focus session whose length is proportional to how far you pulled.
 */
export default function SnakeOverlay() {
  const session = useFocusSession();
  const [drag, setDrag] = useState(0);
  const dragRef = useRef(0);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !session.isActive,
        onMoveShouldSetPanResponder: () => !session.isActive,

        onPanResponderMove: (_, gesture) => {
          const next = Math.max(0, Math.min(MAX_DRAG_DP, gesture.dy));
          dragRef.current = next;
          setDrag(next);
        },

        onPanResponderRelease: async () => {
          const distance = dragRef.current;
          dragRef.current = 0;
          setDrag(0);

          if (distance < 20) {
            return; // treat as a stray tap
          }
          const blocklist = await Storage.getBlocklist();
          await Focus.startSession(minutesFor(distance), blocklist);
        },

        onPanResponderTerminate: () => {
          dragRef.current = 0;
          setDrag(0);
        },
      }),
    [session.isActive],
  );

  if (session.isActive) {
    return (
      <View style={styles.root} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.activePill}
          onPress={() => Focus.stopSession()}>
          <Text style={styles.activeText}>
            {formatRemaining(session.remainingMs)}
          </Text>
          <Text style={styles.activeHint}>tap to end</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const minutes = minutesFor(drag);
  const dragging = drag > 0;

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* body: a tapered trail of segments following the handle */}
      {dragging &&
        Array.from({length: SEGMENTS}).map((_, i) => {
          const t = (i + 1) / (SEGMENTS + 1);
          const size = 26 - t * 14;
          return (
            <View
              key={i}
              pointerEvents="none"
              style={[
                styles.segment,
                {
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  top: drag * t + (28 - size) / 2,
                  opacity: 1 - t * 0.55,
                },
              ]}
            />
          );
        })}

      {/* handle */}
      <Animated.View
        {...pan.panHandlers}
        style={[styles.handle, {top: drag}]}>
        <Text style={styles.handleText}>{dragging ? `${minutes}m` : '↓'}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, alignItems: 'center'},
  handle: {
    position: 'absolute',
    width: 64,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1f6feb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleText: {color: '#fff', fontWeight: '700', fontSize: 13},
  segment: {position: 'absolute', backgroundColor: '#1f6feb'},
  activePill: {
    position: 'absolute',
    top: 0,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: '#1f6feb',
    alignItems: 'center',
  },
  activeText: {color: '#fff', fontWeight: '700', fontSize: 13},
  activeHint: {color: '#cfe0ff', fontSize: 9},
});
