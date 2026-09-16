import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {Overlay} from '../native';
import {useGamification} from '../state/gamificationStore';
import {XP_BAR_HEIGHT} from './XpBarOverlay';

/**
 * A small disc pinned to the top-right corner, hanging off the XP bar.
 *
 * Same slot the kill switch used to occupy: tucked under the bar rather than
 * under the status bar proper, because anything above that line is drawn but
 * cannot be grabbed -- TYPE_STATUS_BAR sits above application overlays and
 * swallows touches for the shade pull-down.
 *
 * touchThrough keeps the rest of the corner live; only the 36dp box itself
 * takes touches. Note there is deliberately NO `touchable: false` here -- that
 * flag makes a window invisible to touch, which is right for the decorative
 * full-screen XP flight and exactly wrong for a button.
 */
export const ADD_TASK_LAYOUT = {
  width: 36,
  height: 36,
  x: 10,
  y: XP_BAR_HEIGHT + 6,
  gravity: 'topRight' as const,
  touchThrough: true,
  focusable: false,
};

/**
 * "Add a task", available from anywhere, always.
 *
 * This is its own window rather than another pill in the snake because the
 * snake's + only ever existed inside the active row -- the layout that renders
 * DURING a focus session. Adding a task therefore meant first pulling the snake
 * down and triggering a lockout, which is backwards: the task is the reason you
 * start a session, not something you think of once you are already trapped in
 * one. Split out, the button lives on the bezel for the same reason the tail
 * does, and the snake goes back to being purely the session control.
 *
 * Deliberately quiet. It is on screen permanently, over whatever the user is
 * actually doing, so it reads as a bezel affordance -- dark disc, skin-coloured
 * rim -- rather than as a floating action button competing with the app below.
 */
export default function AddTaskOverlay() {
  const {activeSkinColor} = useGamification();

  /**
   * Full-screen and focusable, unlike this window: the dialog has a text field,
   * so it needs key input, and it must swallow touches instead of letting them
   * fall through to the app behind it.
   */
  function openAddTask() {
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
    );
  }

  return (
    <View style={styles.root} pointerEvents="box-none">
      <TouchableOpacity
        style={[styles.button, {borderColor: activeSkinColor}]}
        onPress={openAddTask}
        accessibilityRole="button"
        accessibilityLabel="Add a task">
        <Text style={[styles.glyph, {color: activeSkinColor}]}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  /** box-none: the window is bigger than the disc, and the margin must pass
   *  touches through to whatever is underneath. */
  root: {flex: 1, alignItems: 'flex-end', justifyContent: 'center'},
  button: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(15,23,42,0.86)',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  /** The glyph's own bearing centres it low in the disc; lift it back up. */
  glyph: {fontSize: 19, fontWeight: '700', marginTop: -2},
});
