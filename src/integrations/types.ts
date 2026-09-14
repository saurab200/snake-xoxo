/** PERSON 3 (Person C) owns this folder. */

export type TodoItem = {
  id: string;
  /** Assignment or task name. */
  title: string;
  /** Course or project it belongs to, shown above the title. */
  context?: string;
  /** Wall-clock ms. Undefined means no due date. */
  dueAtMs?: number;
  points?: number;
  url?: string;
  /** 'tether' items are the user's own reminders, not pulled from a service. */
  source?: 'integration' | 'tether';
  done?: boolean;
};

/** Add new payload shapes here as a union member, not as new props on a blob. */
export type WidgetPayload =
  | {type: 'todoList'; items: TodoItem[]}
  | {type: 'text'; body: string};

export interface ProductivityIntegration {
  id: string;
  displayName: string;

  /** Android package names that should surface this integration. */
  triggerPackages: string[];

  /** False when the user has not supplied credentials yet. */
  isConfigured(): Promise<boolean>;

  fetchWidgetData(): Promise<WidgetPayload>;
}

/**
 * A connector the user can pick from the Integrations catalogue.
 *
 * Note what this is NOT: a way to add an arbitrary service at runtime. Every
 * connector needs its API, auth and task-shape written in advance, so the
 * catalogue lists what has been built. `available: false` rows are visible on
 * purpose -- they show where the plugin interface is going.
 */
export type ConnectorMeta = {
  id: string;
  displayName: string;
  blurb: string;
  available: boolean;
};
