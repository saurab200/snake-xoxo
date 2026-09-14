import {ProductivityIntegration, WidgetPayload} from './types';

/**
 * A second integration, to prove the plugin architecture is real.
 *
 * Adding this required exactly one new file plus one line in registry.ts --
 * no change to WidgetOverlay, the interface, or anything else. If a future
 * integration needs more than that, fix the abstraction rather than the caller.
 *
 * Deliberately has no auth and no network, so it always renders on stage.
 */
export const StreakIntegration: ProductivityIntegration = {
  id: 'streak',
  displayName: 'Focus stats',

  // Chrome, as a stand-in for "a study site". Change to whatever you demo with.
  triggerPackages: ['com.android.chrome'],

  async isConfigured() {
    return true;
  },

  async fetchWidgetData(): Promise<WidgetPayload> {
    return {
      type: 'todoList',
      items: [
        {id: 'streak', title: 'Focus streak', subtitle: '3 days'},
        {id: 'today', title: 'Focused today', subtitle: '1h 15m'},
        {id: 'blocked', title: 'Distractions blocked', subtitle: '7 attempts'},
      ],
    };
  },
};
