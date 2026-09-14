import {Storage} from '../state/storage';
import {ProductivityIntegration, TodoItem, WidgetPayload} from './types';

/**
 * Canvas LMS via a personal access token.
 * Generate one at: <canvas-host>/profile/settings -> "+ New Access Token".
 *
 * Skipping OAuth on purpose -- it needs a registered developer key from the
 * institution's Canvas admin, which is not happening during a hackathon.
 *
 * SECURITY: never log the token. It grants full API access to the user's account.
 * Every error path below is written to avoid echoing it.
 */

const TIMEOUT_MS = 8000;
const MAX_ITEMS = 25;

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
      return {type: 'text', body: 'Add your Canvas host and token in Settings.'};
    }

    const base = host.trim().replace(/\/+$/, '');
    const raw = await getJson(`${base}/api/v1/users/self/todo`, token);

    return {
      type: 'todoList',
      items: (raw as CanvasTodo[]).slice(0, MAX_ITEMS).map(toTodoItem),
    };
  },
};

/**
 * fetch with a hard timeout. Without this a captive-portal or flaky venue WiFi
 * leaves the promise pending forever and the widget spins indefinitely.
 */
async function getJson(url: string, token: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {Authorization: `Bearer ${token}`},
      signal: controller.signal,
    });
  } catch (e) {
    const name = (e as {name?: string})?.name;
    if (name === 'AbortError') {
      throw new Error('Canvas timed out. Check your connection.');
    }
    throw new Error('Could not reach Canvas.');
  } finally {
    clearTimeout(timer);
  }

  // Map to something the user can act on. Never include the token or the raw body.
  if (res.status === 401 || res.status === 403) {
    throw new Error('Token rejected. Generate a new one in Canvas settings.');
  }
  if (res.status === 404) {
    throw new Error('Canvas host not found. Check the URL in Settings.');
  }
  if (!res.ok) {
    throw new Error(`Canvas error (${res.status}).`);
  }

  try {
    return await res.json();
  } catch {
    throw new Error('Canvas returned an unexpected response.');
  }
}

/* ---- Canvas response shape (only the bits we use) ---- */
type CanvasTodo = {
  assignment?: {
    id: number;
    name: string;
    due_at: string | null;
    points_possible?: number;
    html_url?: string;
  };
  context_name?: string;
  html_url?: string;
};

function toTodoItem(todo: CanvasTodo, index: number): TodoItem {
  const assignment = todo.assignment;
  const due = assignment?.due_at ? Date.parse(assignment.due_at) : undefined;
  return {
    id: String(assignment?.id ?? index),
    title: assignment?.name ?? 'Untitled',
    context: todo.context_name,
    dueAtMs: Number.isNaN(due) ? undefined : due,
    points: assignment?.points_possible,
    url: assignment?.html_url ?? todo.html_url,
    source: 'integration',
  };
}
