import React, {useCallback, useEffect, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {Overlay, Reminder, RemindersApi} from '../native';

const LOCK_OPTIONS = [15, 25, 45, 60];
const PRESETS: {label: string; ms: number}[] = [
  {label: '+1 min', ms: 60_000},
  {label: '+5 min', ms: 5 * 60_000},
  {label: '+15 min', ms: 15 * 60_000},
  {label: '+1 hour', ms: 60 * 60_000},
];

/**
 * Add a task with a due date/time. When it falls due, Tether goes into a total
 * lockout: every blocked app is closed on sight for `lockMinutes`.
 *
 * Deliberately hand-rolled date/time steppers rather than a picker library --
 * @react-native-community/datetimepicker is a native module, and adding one on
 * RN 0.75 risks the Kotlin/KSP build break documented in the briefs.
 */
export default function ReminderOverlay() {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState<Date>(() => new Date(Date.now() + 5 * 60_000));
  const [lockMinutes, setLockMinutes] = useState(25);
  const [items, setItems] = useState<Reminder[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await RemindersApi.list());
    } catch {
      /* native not ready */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function shift(ms: number) {
    setDue(new Date(due.getTime() + ms));
  }

  function setFromNow(ms: number) {
    setDue(new Date(Date.now() + ms));
  }

  async function save() {
    const text = title.trim();
    if (!text) {
      setError('Give the task a name.');
      return;
    }
    if (due.getTime() <= Date.now()) {
      setError('That time is already past.');
      return;
    }
    await RemindersApi.add({
      title: text,
      dueAtMs: due.getTime(),
      lockMinutes,
    });
    setTitle('');
    setError(null);
    await refresh();
  }

  const close = () => Overlay.hide('ReminderOverlay');

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.h1}>New task</Text>
          <TouchableOpacity onPress={close} hitSlop={HIT}>
            <Text style={styles.close}>✕</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.caption}>
          When this falls due, Medusa locks you out: every blocked app closes on
          sight.
        </Text>

        <TextInput
          style={styles.input}
          value={title}
          onChangeText={t => {
            setTitle(t);
            setError(null);
          }}
          placeholder="e.g. Finish the lab report"
          placeholderTextColor="#4b5563"
          autoCorrect={false}
        />

        <Text style={styles.label}>Due</Text>
        <Text style={styles.dueText}>{formatDue(due)}</Text>

        <View style={styles.row}>
          {PRESETS.map(p => (
            <TouchableOpacity
              key={p.label}
              style={styles.chip}
              onPress={() => setFromNow(p.ms)}>
              <Text style={styles.chipText}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.stepperRow}>
          <Stepper
            label="Day"
            onDown={() => shift(-86_400_000)}
            onUp={() => shift(86_400_000)}
          />
          <Stepper
            label="Hour"
            onDown={() => shift(-3_600_000)}
            onUp={() => shift(3_600_000)}
          />
          <Stepper
            label="Min"
            onDown={() => shift(-60_000)}
            onUp={() => shift(60_000)}
          />
        </View>

        <Text style={styles.label}>Lock for</Text>
        <View style={styles.row}>
          {LOCK_OPTIONS.map(m => (
            <TouchableOpacity
              key={m}
              style={[styles.chip, lockMinutes === m && styles.chipOn]}
              onPress={() => setLockMinutes(m)}>
              <Text
                style={[
                  styles.chipText,
                  lockMinutes === m && styles.chipTextOn,
                ]}>
                {m} min
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.save} onPress={save}>
          <Text style={styles.saveText}>Add task</Text>
        </TouchableOpacity>

        {items.length > 0 ? (
          <>
            <Text style={styles.label}>Scheduled</Text>
            {items.map(item => (
              <View key={item.id} style={styles.item}>
                <View style={styles.itemText}>
                  <Text style={styles.itemTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.itemSub}>
                    {formatDue(new Date(item.dueAtMs))} · locks {item.lockMinutes}
                    m{item.fired ? ' · fired' : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={async () => {
                    await RemindersApi.remove(item.id);
                    refresh();
                  }}
                  hitSlop={HIT}>
                  <Text style={styles.close}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Stepper({
  label,
  onDown,
  onUp,
}: {
  label: string;
  onDown: () => void;
  onUp: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperButtons}>
        <TouchableOpacity style={styles.stepBtn} onPress={onDown}>
          <Text style={styles.stepBtnText}>−</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.stepBtn} onPress={onUp}>
          <Text style={styles.stepBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function formatDue(date: Date): string {
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (sameDay) {
    return `Today ${time}`;
  }
  return `${date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })} ${time}`;
}

const HIT = {top: 10, bottom: 10, left: 10, right: 10};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: 'rgba(3,7,18,0.97)'},
  scroll: {padding: 24, paddingTop: 56, paddingBottom: 60},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  h1: {color: '#fff', fontSize: 26, fontWeight: '800'},
  close: {color: '#9ca3af', fontSize: 18, paddingHorizontal: 4},
  caption: {color: '#6b7280', fontSize: 12, lineHeight: 17, marginTop: 6},
  label: {
    color: '#4ade80',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 22,
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 10,
    color: '#e5e7eb',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginTop: 18,
  },
  dueText: {color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 10},
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  chip: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 16,
  },
  chipOn: {backgroundColor: '#14532d', borderColor: '#16a34a'},
  chipText: {color: '#9ca3af', fontSize: 12, fontWeight: '600'},
  chipTextOn: {color: '#86efac'},
  stepperRow: {flexDirection: 'row', gap: 10, marginTop: 12},
  stepper: {flex: 1},
  stepperLabel: {color: '#6b7280', fontSize: 10, marginBottom: 4},
  stepperButtons: {flexDirection: 'row', gap: 6},
  stepBtn: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  stepBtnText: {color: '#e5e7eb', fontSize: 17, fontWeight: '700'},
  error: {color: '#f87171', fontSize: 12, marginTop: 14},
  save: {
    backgroundColor: '#16a34a',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 22,
  },
  saveText: {color: '#fff', fontSize: 16, fontWeight: '700'},
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0b1220',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  itemText: {flex: 1},
  itemTitle: {color: '#e5e7eb', fontSize: 14, fontWeight: '600'},
  itemSub: {color: '#6b7280', fontSize: 11, marginTop: 2},
});
