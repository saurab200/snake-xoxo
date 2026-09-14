import {Focus} from '../native';
import {CanvasIntegration} from './canvas';
import {StreakIntegration} from './streak';
import {ProductivityIntegration} from './types';

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
