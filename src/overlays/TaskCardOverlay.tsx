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

export const TASK_CARD_LAYOUT = {
  width: -1, // MATCH_PARENT
  height: 640,
  gravity: 'bottom' as const,
  touchThrough: true,
  focusable: false,
};

type Tab = 'announcements' | 'todo' | 'done';

/**
 * The task panel that appears once a focus session starts.
 *
 * Answers the question the session raises -- "you are focusing now, on what?"
 *
 * NOTE ON THE TABS: only the middle one is wired. The other two are in the
 * design and are rendered, but tapping them does nothing yet. Canvas exposes
 * announcements and graded work, so both are a connector method away; they are
 * deliberately inert rather than faked with placeholder data.
 */
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
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<Tab>('todo');
  const [loading, setLoading] = useState(false);

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
  }, [load, nonce]);

  const close = () => Overlay.hide('TaskCardOverlay');

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

  const total = sections?.reduce((n, s) => n + s.items.length, 0) ?? 0;

  return (
    <View style={styles.sheet}>
      <View style={styles.grabber} />

      {/* --- tab bar ------------------------------------------------- */}
      <View style={styles.tabBar}>
        <TabButton
          glyph="⚑"
          badge={0}
          active={tab === 'announcements'}
          onPress={() => {}}
        />
        <TabButton
          glyph="✎"
          badge={0}
          active={tab === 'todo'}
          onPress={() => setTab('todo')}
        />
        <TabButton glyph="✓" badge={0} active={tab === 'done'} onPress={() => {}} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollInner}
        showsVerticalScrollIndicator={false}>
        {sections === null || (loading && total === 0) ? (
          <View style={styles.centered}>
            <ActivityIndicator color="#8f8f8f" />
          </View>
        ) : total === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>Nothing due</Text>
            <Text style={styles.emptyBody}>
              Connect an app on the Apps tab, or add a task below.
            </Text>
          </View>
        ) : (
          sections.map(section => (
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
                      done={Boolean(done[item.id])}
                      onToggle={() =>
                        setDone(prev => ({...prev, [item.id]: !prev[item.id]}))
                      }
                    />
                  ))}
            </View>
          ))
        )}

        <TouchableOpacity style={styles.addTask} onPress={openAddTask}>
          <Text style={styles.addTaskText}>+ Add Task</Text>
        </TouchableOpacity>

        <View style={styles.footerRow}>
          <TouchableOpacity onPress={() => load(true)} hitSlop={HIT}>
            <Text style={styles.footerAction}>Refresh</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={close} hitSlop={HIT}>
            <Text style={styles.footerAction}>Hide</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function TabButton({
  glyph,
  badge,
  active,
  onPress,
}: {
  glyph: string;
  badge: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.tab, active ? styles.tabActive : styles.tabInactive]}
      activeOpacity={0.8}
      onPress={onPress}>
      <Text style={[styles.tabGlyph, active && styles.tabGlyphActive]}>
        {glyph}
      </Text>
      {badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
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
          numberOfLines={1}>
          {item.title}
        </Text>

        <View style={styles.taskMeta}>
          {stamp ? (
            <Text style={styles.taskDue}>
              <Text style={styles.taskDueLabel}>Due </Text>
              {stamp}
            </Text>
          ) : (
            <Text style={styles.taskDue}>No due date</Text>
          )}
          {item.points !== undefined ? (
            <Text style={styles.taskPoints}>{item.points}pts</Text>
          ) : null}
        </View>
      </View>

      <TouchableOpacity onPress={onToggle} hitSlop={HIT}>
        <View style={[styles.circle, done && styles.circleDone]}>
          {done ? <Text style={styles.circleTick}>✓</Text> : null}
        </View>
      </TouchableOpacity>
    </View>
  );
}

const HIT = {top: 10, bottom: 10, left: 10, right: 10};

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: '#0c0c0c',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  grabber: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3a3a3a',
    marginBottom: 14,
  },

  tabBar: {flexDirection: 'row', gap: 6, marginBottom: 20},
  tab: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabInactive: {backgroundColor: '#8f8f8f'},
  tabActive: {backgroundColor: '#1c1c1c'},
  tabGlyph: {fontSize: 20, color: '#1c1c1c'},
  tabGlyphActive: {color: '#f2f2f2'},
  badge: {
    position: 'absolute',
    top: 4,
    left: 12,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: '#3b5bdb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {color: '#fff', fontSize: 11, fontWeight: '700'},

  scroll: {flex: 1},
  scrollInner: {paddingBottom: 28},
  centered: {alignItems: 'center', paddingVertical: 60},
  emptyTitle: {color: '#e8e8e8', fontSize: 17, fontWeight: '700'},
  emptyBody: {
    color: '#7a7a7a',
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 10,
  },
  sectionLabel: {
    color: '#9a9a9a',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  chevron: {color: '#9a9a9a', fontSize: 16},

  task: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#131313',
    borderWidth: 1,
    borderColor: '#4a3c3c',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  taskText: {flex: 1, paddingRight: 10},
  taskContext: {color: '#9a9a9a', fontSize: 13},
  taskTitle: {
    color: '#ffffff',
    fontSize: 19,
    fontWeight: '700',
    marginTop: 2,
  },
  taskTitleDone: {color: '#6a6a6a', textDecorationLine: 'line-through'},
  taskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  taskDue: {color: '#9a9a9a', fontSize: 13},
  taskDueLabel: {color: '#e0e0e0', fontWeight: '700'},
  taskPoints: {color: '#9a9a9a', fontSize: 13},
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#7a7a7a',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  circleDone: {backgroundColor: '#3b5bdb', borderColor: '#3b5bdb'},
  circleTick: {color: '#fff', fontSize: 13, fontWeight: '800'},

  addTask: {
    backgroundColor: '#8f8f8f',
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: 14,
  },
  addTaskText: {color: '#ffffff', fontSize: 16, fontWeight: '700'},
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 26,
    marginTop: 16,
  },
  footerAction: {color: '#6a6a6a', fontSize: 13, fontWeight: '600'},
});
