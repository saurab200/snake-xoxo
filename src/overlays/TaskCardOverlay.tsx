import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {Overlay} from '../native';
import {
  TaskSection,
  formatDueStamp,
  groupByDue,
  loadAllTasks,
} from '../integrations/tasks';
import {TodoItem} from '../integrations/types';
import {
  completeTask,
  releaseWithheldXp,
  useGamification,
  withholdXp,
} from '../state/gamificationStore';
import {startNativeRun, useNativeProgress} from '../state/nativeClock';
import {
  FLY_FRACTION,
  XP_FLIGHT_HIDE_GRACE_MS,
  XP_FLIGHT_LAYOUT,
  XP_FLIGHT_MS,
} from './XpFlightOverlay';

/**
 * A panel on the RIGHT EDGE, not a bottom sheet.
 *
 * It used to be a full-width sheet 640dp tall, which buried the screen it was
 * meant to sit beside. Anchored to the right it stays out of the way of both
 * the snake (top) and the launcher's dock (bottom), and it is short enough to
 * leave most of the screen -- and most touches -- alone.
 */
export const TASK_CARD_LAYOUT = {
  width: 286,
  height: 430,
  x: 8,
  gravity: 'right' as const,
  touchThrough: true,
  focusable: false,
};

/**
 * Minimised: a handle on the right edge.
 *
 * Deliberately not "hidden". Closing the panel loses the one affordance that
 * brings it back, so the minimise button shrinks the same window to a tab that
 * still shows how much is outstanding.
 */
export const TASK_CARD_LAYOUT_MIN = {
  width: 54,
  height: 54,
  x: 8,
  gravity: 'right' as const,
  touchThrough: true,
  focusable: false,
};


/**
 * The tick that is currently being celebrated.
 *
 * The XP is banked the instant the control is pressed, so without this the row
 * would vanish on the same frame and there would be nothing to animate. The row
 * is held until ROW_EXIT_T of the run and cleared from a native event, because
 * the JS timer that would normally do it never fires while Tether is
 * backgrounded.
 */
type Flight = {taskId: string; runId: number};

/**
 * Fraction of the run the ticked row takes to empty out.
 *
 * The row leaves when its own exit is finished rather than when the flourish is,
 * so the list closes up behind it instead of holding an empty section header for
 * the rest of the run.
 *
 * Tied to real milliseconds, not to the flourish: when the run grew from 1.2s to
 * 3s this was 0.45, which quietly turned a ~540ms exit into a ~1.35s one and
 * left the row sitting there long after the tick. ~540ms of a 3s run is 0.18.
 */
const ROW_EXIT_T = 0.18;

type Props = {
  /**
   * Bumped by whoever opens the card. Overlay.show() on an ALREADY VISIBLE
   * overlay only pushes props -- it does not remount -- so without a changing
   * value here reopening the card showed whatever it loaded the first time.
   */
  nonce?: number;
};

export default function TaskCardOverlay({nonce}: Props) {
  const [sections, setSections] = useState<TaskSection[] | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [flight, setFlight] = useState<Flight | null>(null);

  // Completed ids live in the shared store, so a tick survives a reload of the
  // task list -- and a refresh from Canvas cannot resurrect what was cleared.
  const {completedTaskIds} = useGamification();

  /**
   * The same run the XP flight overlay is painting, one window over. Both roots
   * subscribe to one native clock, so the row emptying and the point arriving at
   * the bar are the same animation rather than two that happen to be similar.
   */
  const {t: flightT, done: flightDone} = useNativeProgress(
    flight?.runId ?? null,
  );

  // The token reaches the bar at FLY_FRACTION, not at the end of the run -- the
  // rest is the impact ring and the words. Releasing on arrival is what makes
  // the bar grow as the point touches it instead of half a second later.
  const landed = flight !== null && (flightT ?? 0) >= FLY_FRACTION;

  useEffect(() => {
    if (landed) {
      releaseWithheldXp();
    }
  }, [landed]);

  useEffect(() => {
    if (flight && flightDone) {
      setFlight(null);
    }
  }, [flight, flightDone]);

  /**
   * Never leave XP stranded in the air.
   *
   * The run is native, but the release is driven from this component -- so if
   * the panel is torn down mid-flight (minimised, session ended, overlay hidden)
   * nothing would ever land it and the bar would under-report until the next
   * reload. The points themselves were always safe; only the display was held.
   */
  useEffect(() => releaseWithheldXp, []);

  const load = useCallback(async (force: boolean) => {
    setLoading(true);
    try {
      setSections(groupByDue(await loadAllTasks(force)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);

    /**
     * Reopening always arrives expanded.
     *
     * Overlay.show() on a VISIBLE overlay only pushes props -- it does not
     * resize the window -- so asking for the panel while it was minimised would
     * otherwise just reload a 54dp handle and look like nothing happened.
     */
    setMinimized(false);
    Overlay.setLayout('TaskCardOverlay', TASK_CARD_LAYOUT).catch(() => {});
  }, [load, nonce]);

  function minimize() {
    setMinimized(true);
    Overlay.setLayout('TaskCardOverlay', TASK_CARD_LAYOUT_MIN).catch(() => {});
  }

  function expand() {
    setMinimized(false);
    Overlay.setLayout('TaskCardOverlay', TASK_CARD_LAYOUT).catch(() => {});
  }

  const openAddTask = () =>
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

  const isDone = (id: string) => completedTaskIds.includes(id);

  /**
   * Ticking a task pays out XP and sends it to the bar at the top of the screen.
   *
   * The flourish no longer needs to know where the row was: the token is born
   * in the middle of the screen, so there is no touch position to plumb through.
   *
   * Nothing here is timed in JS. The flourish runs on a native clock and the
   * overlay carrying it is removed by a native `hideAfter`, so a JS thread that
   * never wakes again costs an animation, not a window stuck over the screen.
   */
  const toggle = (item: TodoItem) => {
    // No un-ticking: a cleared task leaves the list and there is no longer a
    // screen that shows it again, so the only direction is done. completeTask()
    // is still the guard against double payment.
    //
    // 0 means it was already credited -- skip the flourish rather than claim
    // points that were not paid.
    const awarded = completeTask(item.id);
    if (awarded <= 0) {
      return;
    }

    // Bank the points but keep them off the bar until the token gets there,
    // so the flight is what delivers the XP rather than a victory lap after it.
    withholdXp(awarded);

    const runId = startNativeRun(XP_FLIGHT_MS);
    setFlight({taskId: item.id, runId});

    Overlay.show('XpFlightOverlay', XP_FLIGHT_LAYOUT, {
      runId,
      amount: awarded,
    }).catch(() => {});
    Overlay.hideAfter(
      'XpFlightOverlay',
      XP_FLIGHT_MS + XP_FLIGHT_HIDE_GRACE_MS,
    ).catch(() => {});
  };

  /** The row still playing its exit, if any. Null once it has emptied out. */
  const clearingId =
    flight && (flightT ?? 0) < ROW_EXIT_T ? flight.taskId : null;

  // Only what is still outstanding. A ticked task is gone for good: the payout
  // already told the story -- the flourish, the XP, the row emptying out -- and
  // a list of things you have finished with is one more place to look for
  // nothing. The row being ticked stays put until it has animated away.
  const visible: TaskSection[] = (sections ?? [])
    .map(s => ({
      ...s,
      items: s.items.filter(i => !isDone(i.id) || i.id === clearingId),
    }))
    .filter(s => s.items.length > 0);

  const total = visible.reduce((n, s) => n + s.items.length, 0);

  const outstanding =
    sections?.reduce(
      (n, s) => n + s.items.filter(i => !isDone(i.id)).length,
      0,
    ) ?? 0;

  /* --- minimised: just a handle ------------------------------------- */

  if (minimized) {
    return (
      <View style={styles.root} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.handle}
          activeOpacity={0.85}
          onPress={expand}>
          <Text style={styles.handleGlyph}>‹</Text>
          {outstanding > 0 ? (
            <Text style={styles.handleCount}>{outstanding}</Text>
          ) : null}
        </TouchableOpacity>
      </View>
    );
  }

  /* --- expanded ------------------------------------------------------ */

  return (
    <View style={styles.root} pointerEvents="box-none">
      <View style={styles.header}>
        <Text style={styles.title}>
          To do{outstanding > 0 ? ` ${outstanding}` : ''}
        </Text>

        <TouchableOpacity style={styles.minimize} onPress={minimize} hitSlop={HIT}>
          <Text style={styles.minimizeGlyph}>›</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollInner}
        showsVerticalScrollIndicator={false}>
        {sections === null || (loading && total === 0) ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#94a3b8" />
          </View>
        ) : total === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>All clear</Text>
            <Text style={styles.emptyBody}>
              Connect an app on the Apps tab, or add a task.
            </Text>
          </View>
        ) : (
          visible.map(section => (
            <View key={section.label}>
              <TouchableOpacity
                style={styles.sectionHeader}
                activeOpacity={0.7}
                onPress={() =>
                  setCollapsed(prev => ({
                    ...prev,
                    [section.label]: !prev[section.label],
                  }))
                }>
                <Text style={styles.sectionLabel}>{section.label}</Text>
                <Text style={styles.chevron}>
                  {collapsed[section.label] ? '›' : '⌄'}
                </Text>
              </TouchableOpacity>

              {collapsed[section.label]
                ? null
                : section.items.map(item => (
                    <TaskRow
                      key={item.id}
                      item={item}
                      done={isDone(item.id)}
                      clearing={item.id === clearingId ? flightT ?? 0 : null}
                      onToggle={() => toggle(item)}
                    />
                  ))}
            </View>
          ))
        )}

        <TouchableOpacity style={styles.addTask} onPress={openAddTask}>
          <Text style={styles.addTaskText}>+ Add task</Text>
        </TouchableOpacity>

        <View style={styles.footerRow}>
          <TouchableOpacity onPress={() => load(true)} hitSlop={HIT}>
            <Text style={styles.footerAction}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}


/**
 * A row, and the tick box in its corner.
 *
 * The box used to be a 20dp outline hugging the right edge, which nobody found.
 * It is now a labelled target in the row's top-right corner, with a ghosted ✓
 * already in it so it reads as something to press rather than as a bullet.
 *
 * `clearing` is the run progress 0..1 while this row is being ticked off, or
 * null. Every value it takes is painted as a finished frame -- there is no tween
 * anywhere in here, because a tween would freeze. See HANDOFF.md section 10.
 */
function TaskRow({
  item,
  done,
  clearing,
  onToggle,
}: {
  item: TodoItem;
  done: boolean;
  clearing: number | null;
  onToggle: () => void;
}) {
  const stamp = formatDueStamp(item.dueAtMs);

  const c = clearing ?? 0;
  const ticked = done || clearing !== null;

  // The row empties out sideways while its point flies off it, and the box
  // swells once as it goes -- a single beat, over by the time the XP lands.
  const exit = Math.min(c / ROW_EXIT_T, 1);
  const rowStyle =
    clearing === null
      ? null
      : {opacity: 1 - exit, transform: [{translateX: 30 * exit}]};
  const boxScale =
    clearing === null ? 1 : 1 + 0.45 * Math.sin(Math.PI * Math.min(c / 0.3, 1));

  return (
    <View style={[styles.task, rowStyle]}>
      <View style={styles.taskText}>
        {item.context ? (
          <Text style={styles.taskContext} numberOfLines={1}>
            {item.context}
          </Text>
        ) : null}

        <Text
          style={[styles.taskTitle, ticked && styles.taskTitleDone]}
          numberOfLines={2}>
          {item.title}
        </Text>

        <Text style={styles.taskDue} numberOfLines={1}>
          {stamp ? `Due ${stamp}` : 'No due date'}
        </Text>
      </View>

      {/* EVERY row gets a box. The stat rows (streak, minutes today,
          distractions blocked) are claimable too -- each has a stable id, so
          completedTaskIds lets it be claimed exactly once, and unticking
          refunds, which makes toggling worth nothing. */}
      <TouchableOpacity
        style={styles.tickTarget}
        activeOpacity={0.7}
        hitSlop={HIT}
        onPress={onToggle}>
        <View
          style={[
            styles.tickBox,
            ticked && styles.tickBoxDone,
            {transform: [{scale: boxScale}]},
          ]}>
          <Text style={[styles.tickGlyph, ticked && styles.tickGlyphDone]}>
            ✓
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const HIT = {top: 10, bottom: 10, left: 10, right: 10};

const styles = StyleSheet.create({
  /**
   * No panel background at all.
   *
   * Each card carries its own translucent fill, so the wallpaper shows between
   * the rows and the panel reads as floating cards rather than a slab bolted to
   * the side of the screen.
   */
  root: {flex: 1},

  title: {
    flex: 1,
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },

  minimize: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(15,23,42,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  minimizeGlyph: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '800',
    marginTop: -2,
  },

  /** The minimised tab: same window, 54dp square. */
  handle: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(15,23,42,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 1,
  },
  handleGlyph: {color: '#e2e8f0', fontSize: 17, fontWeight: '800'},
  handleCount: {color: '#60a5fa', fontSize: 12, fontWeight: '800'},

  scroll: {flex: 1},
  scrollInner: {paddingBottom: 10},
  centered: {alignItems: 'center', paddingVertical: 34},
  emptyTitle: {color: '#e2e8f0', fontSize: 14, fontWeight: '700'},
  emptyBody: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 12,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    marginBottom: 6,
  },
  sectionLabel: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.9,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowRadius: 2,
  },
  chevron: {color: '#94a3b8', fontSize: 13},

  task: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(12,17,28,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.22)',
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 7,
  },
  /** Clears the corner target, which is absolutely placed over this row. */
  taskText: {flex: 1, paddingRight: 40},
  taskContext: {color: '#94a3b8', fontSize: 10},
  taskTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 1,
  },
  taskTitleDone: {color: '#64748b', textDecorationLine: 'line-through'},
  taskDue: {color: '#94a3b8', fontSize: 10, marginTop: 2},

  /**
   * THE TICK-OFF CORNER.
   *
   * In the corner rather than beside the text, and 32dp rather than 20dp,
   * because the old control was not read as a control at all. The target is
   * larger again than the box it draws, and hitSlop widens it once more.
   */
  tickTarget: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickBox: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(34,197,94,0.55)',
    backgroundColor: 'rgba(34,197,94,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickBoxDone: {backgroundColor: '#22c55e', borderColor: '#22c55e'},
  /** Ghosted until it is earned, so the empty box still says "press me". */
  tickGlyph: {
    color: 'rgba(134,239,172,0.5)',
    fontSize: 15,
    fontWeight: '800',
    marginTop: -1,
  },
  tickGlyphDone: {color: '#ffffff'},

  addTask: {
    backgroundColor: 'rgba(15,23,42,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
    borderRadius: 11,
    paddingVertical: 9,
    alignItems: 'center',
    marginTop: 8,
  },
  addTaskText: {color: '#e2e8f0', fontSize: 12, fontWeight: '700'},
  footerRow: {flexDirection: 'row', justifyContent: 'center', marginTop: 8},
  footerAction: {color: '#64748b', fontSize: 11, fontWeight: '600'},
});
