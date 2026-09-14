import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {Focus, Overlay, RemindersApi} from '../native';

/** Idle: a small cross pinned to the top-right corner. */
export const KILL_LAYOUT = {
  width: 44,
  height: 44,
  x: 10,
  y: 14,
  gravity: 'topRight' as const,
  touchThrough: true,
  focusable: false,
};

/**
 * Armed: widened to fit the confirmation, and dropped below the top line so it
 * does not land on top of the snake's timer and + pills.
 */
export const KILL_LAYOUT_CONFIRM = {
  width: 200,
  height: 44,
  x: 10,
  y: 104,
  gravity: 'topRight' as const,
  touchThrough: true,
  focusable: false,
};

const AUTO_COLLAPSE_MS = 4000;

/**
 * The panic button: stops everything, from anywhere, at any time.
 *
 * Deliberately two taps rather than one. It can cancel a lockout, so a single
 * stray touch on a button that lives permanently under the status bar would be
 * far too easy to hit by accident. Tap once to arm, once to confirm; it
 * disarms itself after a few seconds.
 */
export default function KillSwitchOverlay() {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, []);

  function arm() {
    setConfirming(true);
    Overlay.setLayout('KillSwitchOverlay', KILL_LAYOUT_CONFIRM).catch(() => {});

    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(disarm, AUTO_COLLAPSE_MS);
  }

  function disarm() {
    setConfirming(false);
    Overlay.setLayout('KillSwitchOverlay', KILL_LAYOUT).catch(() => {});
  }

  /**
   * Order matters: clear the state first so nothing can re-trigger, then take
   * the windows down, then stop the service last -- stopping it tears down the
   * JS context that is running this very handler.
   */
  async function stopEverything() {
    try {
      await Focus.stopSession();
    } catch {}
    try {
      await RemindersApi.stopLockout();
    } catch {}
    try {
      await Overlay.hideAll();
    } catch {}
    try {
      await Focus.disarm();
    } catch {}
  }

  if (!confirming) {
    return (
      <View style={styles.root} pointerEvents="box-none">
        <TouchableOpacity style={styles.cross} onPress={arm}>
          <Text style={styles.crossText}>✕</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.rootRow} pointerEvents="box-none">
      <TouchableOpacity style={styles.cancel} onPress={disarm}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.confirm} onPress={stopEverything}>
        <Text style={styles.confirmText}>Stop everything</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, alignItems: 'flex-end'},
  rootRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  cross: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(15,23,42,0.86)',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  crossText: {color: '#e2e8f0', fontSize: 15, fontWeight: '700'},
  cancel: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(15,23,42,0.86)',
    borderWidth: 1,
    borderColor: '#334155',
  },
  cancelText: {color: '#94a3b8', fontSize: 12, fontWeight: '600'},
  confirm: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#b91c1c',
    elevation: 6,
  },
  confirmText: {color: '#fff', fontSize: 12, fontWeight: '800'},
});
