/** PERSON C owns this folder. */

export type TodoItem = {
  id: string;
  title: string;
  /** e.g. "Due Fri 5pm" or a course name */
  subtitle?: string;
  url?: string;
};

/** Add new payload shapes here as a union member, not as new props on a blob. */
export type WidgetPayload =
  | {type: 'todoList'; items: TodoItem[]}
  | {type: 'text'; body: string};

export interface ProductivityIntegration {
  id: string;
  displayName: string;

  /** Android package names that should pop this widget when opened. */
  triggerPackages: string[];

  /** False when the user has not supplied credentials yet. */
  isConfigured(): Promise<boolean>;

  fetchWidgetData(): Promise<WidgetPayload>;
}
