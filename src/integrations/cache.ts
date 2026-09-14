import {ProductivityIntegration, WidgetPayload} from './types';

/**
 * Stale-while-revalidate cache for widget data.
 *
 * Without this, every foreground app switch refetches. Switching between Canvas
 * and another app a few times is enough to get rate-limited mid-demo.
 *
 * Module-level on purpose: it must outlive any React tree, including overlay
 * roots that mount and unmount as windows appear.
 */

type Entry = {at: number; payload: WidgetPayload};

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, Entry>();

export function cachedPayload(id: string): WidgetPayload | null {
  return cache.get(id)?.payload ?? null;
}

export function isFresh(id: string): boolean {
  const entry = cache.get(id);
  return Boolean(entry && Date.now() - entry.at < TTL_MS);
}

export function invalidate(id: string): void {
  cache.delete(id);
}

/**
 * Returns cached data when fresh, otherwise fetches. Pass force to bypass the
 * cache entirely (the Refresh button).
 */
export async function loadWidgetData(
  integration: ProductivityIntegration,
  options: {force?: boolean} = {},
): Promise<WidgetPayload> {
  const {force = false} = options;

  if (!force && isFresh(integration.id)) {
    return cache.get(integration.id)!.payload;
  }

  const payload = await integration.fetchWidgetData();
  cache.set(integration.id, {at: Date.now(), payload});
  return payload;
}
