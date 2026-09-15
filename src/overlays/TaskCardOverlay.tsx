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
  XP_PER_TASK,
  completeTask,
  uncompleteTask,
  useGamification,
} from '../state/gamificationStore';

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

  // Completed ids live in the shared store, so a tick survives a reload of the
  // task list -- and a refresh from Canvas cannot resurrect what was cleared.
  const {completedTaskIds} = useGamification();

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
   * Ticking a task removes it from the list and pays out XP.
   *
   * The reward is the row disappearing and the bar at the top of the screen
   * moving; there is no transient "+10 XP" toast, because a toast needs a timer
   * to dismiss it and JS timers do not run while Tether is backgrounded -- it
   * would hang there permanently. See HANDOFF.md section 10.
   */
  const toggle = (item: TodoItem) => {
    if (item.readOnly) {
      return;
    }
    if (isDone(item.id)) {
      uncompleteTask(item.id);
    } else {
      completeTask(item.id);
    }
  };

  // Outstanding vs cleared, from the same fetched list.
  const visible: TaskSection[] = (sections ?? [])
    .map(s => ({
      ...s,
      items: s.items.filter(i =>
        tab === 'done' ? isDone(i.id) : i.readOnly || !isDone(i.id),
      ),
    }))
    .filter(s => s.items.length > 0);

  const total = visible.reduce((n, s) => n + s.items.length, 0);

  /** Read-only rows are figures, not work, so they are not "outstanding". */
  const outstanding =
    sections?.reduce(
      (n, s) => n + s.items.filter(i => !i.readOnly && !isDone(i.id)).length,
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

function TaskRow({
  item,
  done,
  onToggle,
}: {
  item: TodoItem;
  done: boolean;
  onToggle: () => void;
}) {
  const stamp = formatDueStamp(item.dueAtMs);
  return (
    <View style={styles.task}>
      <View style={styles.taskText}>
        {item.context ? (
          <Text style={styles.taskContext} numberOfLines={1}>
            {item.context}
          </Text>
        ) : null}

        <Text
          style={[styles.taskTitle, done && styles.taskTitleDone]}
          numberOfLines={2}>
          {item.title}
        </Text>

        <Text style={styles.taskDue} numberOfLines={1}>
          {stamp ? `Due ${stamp}` : 'No due date'}
        </Text>
      </View>

      {item.readOnly ? null : (
        <TouchableOpacity onPress={onToggle} hitSlop={HIT}>
          <View style={[styles.circle, done && styles.circleDone]}>
            {done ? <Text style={styles.circleTick}>✓</Text> : null}
          </View>
        </TouchableOpacity>
      )}
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
  taskText: {flex: 1, paddingRight: 8},
  taskContext: {color: '#94a3b8', fontSize: 10},
  taskTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 1,
  },
  taskTitleDone: {color: '#64748b', textDecorationLine: 'line-through'},
  taskDue: {color: '#94a3b8', fontSize: 10, marginTop: 2},

  circle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#94a3b8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleDone: {backgroundColor: '#22c55e', borderColor: '#22c55e'},
  circleTick: {color: '#fff', fontSize: 12, fontWeight: '800'},

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
