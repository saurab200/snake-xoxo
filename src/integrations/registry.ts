import {Focus} from '../native';
import {CanvasIntegration} from './canvas';
import {StreakIntegration} from './streak';
import {ConnectorMeta, ProductivityIntegration} from './types';

/**
 * The catalogue behind the "+" on the Integrations screen.
 *
 * Unavailable rows are shown deliberately rather than hidden: they make the
 * plugin interface visible, and each one is a single new file away from being
 * real (see streak.ts for how little a connector needs).
 */
export const CONNECTORS: ConnectorMeta[] = [
  {
    id: 'canvas',
    displayName: 'Canvas',
    blurb: 'Assignments and due dates from your LMS',
    available: true,
  },
  {
    id: 'streak',
    displayName: 'Focus stats',
    blurb: 'Your own streak and blocked-distraction count',
    available: true,
  },
  {
    id: 'classroom',
    displayName: 'Google Classroom',
    blurb: 'Coursework and deadlines',
    available: false,
  },
  {
    id: 'notion',
    displayName: 'Notion',
    blurb: 'Database rows with a due-date property',
    available: false,
  },
  {
    id: 'todoist',
    displayName: 'Todoist',
    blurb: 'Tasks from your inbox and projects',
    available: false,
  },
];

export function listConnectors(): ConnectorMeta[] {
  return CONNECTORS;
}

/**
 * Adding an integration = write the object, add it to this array. Nothing else
 * in the app needs to change.
 */
const INTEGRATIONS: ProductivityIntegration[] = [
  CanvasIntegration,
  StreakIntegration,
];

export function listIntegrations(): ProductivityIntegration[] {
  return INTEGRATIONS;
}

export function getIntegration(id: string): ProductivityIntegration | undefined {
  return INTEGRATIONS.find(i => i.id === id);
}

export function integrationForPackage(
  pkg: string,
): ProductivityIntegration | undefined {
  return INTEGRATIONS.find(i => i.triggerPackages.includes(pkg));
}

/**
 * Mirrors the trigger packages into native.
 *
 * NOTE: nothing in Kotlin reads FocusSessionStore.widgetTriggers yet -- the
 * widget decision is made in JS (see src/state/widgetTrigger.ts). This is
 * forward-compatible plumbing for moving that decision into the accessibility
 * service later, which would let the widget appear without waking JS. It is
 * intentionally kept, not dead code left by accident.
 */
export function syncTriggerPackages(): Promise<boolean> {
  return Focus.setWidgetTriggers(INTEGRATIONS.flatMap(i => i.triggerPackages));
}
