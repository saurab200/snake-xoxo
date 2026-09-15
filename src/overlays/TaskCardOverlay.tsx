import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  GestureResponderEvent,
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
  XP_PER_TASK,
  completeTask,
  uncompleteTask,
  useGamification,
} from '../state/gamificationStore';
import {startNativeRun, useNativeProgress} from '../state/nativeClock';
import {
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

type Tab = 'todo' | 'done';

/**
 * The tick that is currently being celebrated.
 *
 * The XP lands in the store the instant the control is pressed, so without this
 * the row would vanish on the same frame and there would be nothing to animate.
 * The row is held in the list for the length of the run and cleared by the run's
 * final frame -- a native event, because the JS timer that would normally do it
 * never fires while Tether is backgrounded.
 */
type Flight = {taskId: string; runId: number};

/**
 * Fraction of the run the ticked row takes to empty out.
 *
 * The row leaves when its own exit is finished rather than when the flourish is,
 * so the list closes up behind it instead of holding an empty section header for
 * the rest of the second.
 */
const ROW_EXIT_T = 0.45;

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
  const [tab, setTab] = useState<Tab>('todo');
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

  useEffect(() => {
    if (flight && flightDone) {
      setFlight(null);
    }
  }, [flight, flightDone]);

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
   * `where` is the tick control's position in THIS window's coordinates, taken
   * from the touch itself. The flight overlay converts it: the panel is a
   * right-anchored window of a known size, so its origin on screen is exact.
   *
   * Nothing here is timed in JS. The flourish runs on a native clock and the
   * overlay carrying it is removed by a native `hideAfter`, so a JS thread that
   * never wakes again costs an animation, not a window stuck over the screen.
   */
  const toggle = (item: TodoItem, where: {x: number; y: number}) => {
    if (isDone(item.id)) {
      uncompleteTask(item.id);
      return;
    }

    // 0 means it was already credited -- skip the flourish rather than claim
    // points that were not paid.
    const awarded = completeTask(item.id);
    if (awarded <= 0) {
      return;
    }

    const runId = startNativeRun(XP_FLIGHT_MS);
    setFlight({taskId: item.id, runId});

    Overlay.show('XpFlightOverlay', XP_FLIGHT_LAYOUT, {
      runId,
      fromX: where.x,
      fromY: where.y,
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

  // Outstanding vs cleared, from the same fetched list. The row being ticked
  // stays where it was until it has finished animating away.
  const visible: TaskSection[] = (sections ?? [])
    .map(s => ({
      ...s,
      items: s.items.filter(i =>
        tab === 'done'
          ? isDone(i.id) && i.id !== clearingId
          : !isDone(i.id) || i.id === clearingId,
      ),
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
        <View style={styles.tabBar}>
          <TabButton
            label="To do"
            count={outstanding}
            active={tab === 'todo'}
            onPress={() => setTab('todo')}
          />
          <TabButton
            label="Done"
            count={completedTaskIds.length}
            active={tab === 'done'}
            onPress={() => setTab('done')}
          />
        </View>

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
            <Text style={styles.emptyTitle}>
              {tab === 'done' ? 'Nothing ticked yet' : 'All clear'}
            </Text>
            <Text style={styles.emptyBody}>
              {tab === 'done'
                ? `Each task you tick is worth ${XP_PER_TASK} XP.`
                : 'Connect an app on the Apps tab, or add a task.'}
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
                      onToggle={where => toggle(item, where)}
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

function TabButton({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.tab, active && styles.tabActive]}
      activeOpacity={0.8}
      onPress={onPress}>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
        {label}
        {count > 0 ? ` ${count}` : ''}
      </Text>
    </TouchableOpacity>
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
  onToggle: (where: {x: number; y: number}) => void;
}) {
  const stamp = formatDueStamp(item.dueAtMs);

  // Captured on touch-down: the flight has to start from the exact pixel the
  // finger left, and onPress alone does not carry a position.
  const [where, setWhere] = useState({x: 0, y: 0});
  const takePosition = (e: GestureResponderEvent) =>
    setWhere({x: e.nativeEvent.pageX, y: e.nativeEvent.pageY});

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
        onPressIn={takePosition}
        onPress={() => onToggle(where)}>
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

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  tabBar: {flexDirection: 'row', gap: 6, flex: 1},
  tab: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 11,
    backgroundColor: 'rgba(15,23,42,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
  },
  tabActive: {backgroundColor: '#1d4ed8', borderColor: '#1d4ed8'},
  tabLabel: {color: '#94a3b8', fontSize: 11, fontWeight: '700'},
  tabLabelActive: {color: '#ffffff'},

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
