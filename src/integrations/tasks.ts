import {RemindersApi} from '../native';
import {loadWidgetData} from './cache';
import {listIntegrations} from './registry';
import {TodoItem} from './types';

/**
 * Everything the user has to do, from every source, in one list.
 *
 * Integration tasks and the user's own Tether reminders end up side by side --
 * a reminder is just a TodoItem with source 'tether', so the card does not have
 * to care where an item came from.
 */
export async function loadAllTasks(force = false): Promise<TodoItem[]> {
  const fromIntegrations = await Promise.all(
    listIntegrations().map(async integration => {
      try {
        if (!(await integration.isConfigured())) {
          return [];
        }
        const payload = await loadWidgetData(integration, {force});
        return payload.type === 'todoList' ? payload.items : [];
      } catch {
        return []; // one broken connector must not empty the whole card
      }
    }),
  );

  let reminders: TodoItem[] = [];
  try {
    reminders = (await RemindersApi.list())
      .filter(r => !r.fired)
      .map(r => ({
        id: `tether:${r.id}`,
        title: r.title,
        context: `Locks apps for ${r.lockMinutes} min`,
        dueAtMs: r.dueAtMs,
        source: 'tether' as const,
      }));
  } catch {
    /* native not ready */
  }

  return [...fromIntegrations.flat(), ...reminders].sort(
    (a, b) => (a.dueAtMs ?? Infinity) - (b.dueAtMs ?? Infinity),
  );
}

export type TaskSection = {
  label: string;
  items: TodoItem[];
};

const DAY_MS = 86_400_000;

/**
 * Groups by how soon something is due, matching the card's headings:
 * OVERDUE / DUE TODAY / DUE TOMORROW / DUE IN N DAYS / DUE LATER.
 */
export function groupByDue(items: TodoItem[]): TaskSection[] {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();

  const sections = new Map<string, TodoItem[]>();
  const order: string[] = [];

  const push = (label: string, item: TodoItem) => {
    if (!sections.has(label)) {
      sections.set(label, []);
      order.push(label);
    }
    sections.get(label)!.push(item);
  };

  for (const item of items) {
    if (item.dueAtMs === undefined) {
      push('NO DUE DATE', item);
      continue;
    }
    const days = Math.floor((item.dueAtMs - startOfToday) / DAY_MS);

    if (item.dueAtMs < Date.now()) {
      push('OVERDUE', item);
    } else if (days <= 0) {
      push('DUE TODAY', item);
    } else if (days === 1) {
      push('DUE TOMORROW', item);
    } else if (days <= 6) {
      push(`DUE IN ${days} DAYS`, item);
    } else {
      push('DUE LATER', item);
    }
  }

  // Keep the urgent headings first regardless of insertion order.
  const rank = (label: string) =>
    label === 'OVERDUE'
      ? 0
      : label === 'DUE TODAY'
      ? 1
      : label === 'DUE TOMORROW'
      ? 2
      : label.startsWith('DUE IN')
      ? 3 + Number(label.split(' ')[2] ?? 0)
      : label === 'DUE LATER'
      ? 50
      : 60;

  return order
    .sort((a, b) => rank(a) - rank(b))
    .map(label => ({label, items: sections.get(label)!}));
}

/** "09/16 at 12:20pm", as in the design. */
export function formatDueStamp(dueAtMs?: number): string | null {
  if (dueAtMs === undefined) {
    return null;
  }
  const d = new Date(dueAtMs);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const time = d
    .toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'})
    .replace(/\s/g, '')
    .toLowerCase();
  return `${mm}/${dd} at ${time}`;
}
