import {Storage} from '../state/storage';
import {ProductivityIntegration, TodoItem, WidgetPayload} from './types';

/**
 * Canvas LMS via a personal access token.
 * Generate one at: <canvas-host>/profile/settings -> "+ New Access Token".
 *
 * Skipping OAuth on purpose -- it needs a registered developer key from the
 * institution's Canvas admin, which is not happening during a hackathon.
 */
export const CanvasIntegration: ProductivityIntegration = {
  id: 'canvas',
  displayName: 'Canvas',

  triggerPackages: ['com.instructure.candroid', 'com.instructure.student'],

  async isConfigured() {
    const [token, host] = await Promise.all([
      Storage.getCanvasToken(),
      Storage.getCanvasHost(),
    ]);
    return Boolean(token && host);
  },

  async fetchWidgetData(): Promise<WidgetPayload> {
    const [token, host] = await Promise.all([
      Storage.getCanvasToken(),
      Storage.getCanvasHost(),
    ]);

    if (!token || !host) {
      return {type: 'text', body: 'Add your Canvas host + token in Settings.'};
    }

    const base = host.replace(/\/+$/, '');
    const res = await fetch(`${base}/api/v1/users/self/todo`, {
      headers: {Authorization: `Bearer ${token}`},
    });

    if (!res.ok) {
      throw new Error(`Canvas returned ${res.status}`);
    }

    const raw = (await res.json()) as CanvasTodo[];
    return {type: 'todoList', items: raw.map(toTodoItem)};
  },
};

/* ---- Canvas response shape (only the bits we use) ---- */
type CanvasTodo = {
  assignment?: {
    id: number;
    name: string;
    due_at: string | null;
    html_url?: string;
  };
  context_name?: string;
  html_url?: string;
};

function toTodoItem(todo: CanvasTodo, index: number): TodoItem {
  const assignment = todo.assignment;
  return {
    id: String(assignment?.id ?? index),
    title: assignment?.name ?? 'Untitled',
    subtitle: [todo.context_name, formatDue(assignment?.due_at)]
      .filter(Boolean)
      .join(' · '),
    url: assignment?.html_url ?? todo.html_url,
  };
}

function formatDue(dueAt?: string | null): string | undefined {
  if (!dueAt) {
    return undefined;
  }
  const date = new Date(dueAt);
  return `Due ${date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })}`;
}
