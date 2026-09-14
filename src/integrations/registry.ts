import {Focus} from '../native';
import {CanvasIntegration} from './canvas';
import {ProductivityIntegration} from './types';

/**
 * Adding an integration = write the object, add it to this array. Nothing else
 * in the app needs to change.
 */
const INTEGRATIONS: ProductivityIntegration[] = [CanvasIntegration];

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

/** Tell native which packages are worth reporting for widget purposes. */
export function syncTriggerPackages(): Promise<boolean> {
  return Focus.setWidgetTriggers(
    INTEGRATIONS.flatMap(i => i.triggerPackages),
  );
}
