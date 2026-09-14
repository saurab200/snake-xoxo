import {Focus, Overlay, TetherEvents} from '../native';
import {integrationForPackage, syncTriggerPackages} from '../integrations/registry';
import {TASK_CARD_LAYOUT} from '../overlays/TaskCardOverlay';
import {WIDGET_LAYOUT} from '../overlays/WidgetOverlay';

/**
 * Long enough for the snake to finish its coil-and-crawl before the task card
 * slides in, so the two animations do not fight for attention.
 */
const CARD_DELAY_MS = 3800;

/**
 * THE PERSON 2 -> PERSON 3 SEAM.
 *
 * Person 2 emits every foreground app change. Person 3 decides which ones matter.
 *
 * WHY THIS IS NOT A HOOK ANY MORE:
 * this used to live in a useEffect mounted from App.tsx. App.tsx renders inside
 * MainActivity's React root, and Android routinely destroys that activity once the
 * user leaves the app -- which unmounted App, ran the effect cleanup, and removed
 * the listener. The widget then never appeared over other apps, which is the entire
 * point of the feature.
 *
 * Module scope outlives every activity. The foreground service (Person 1) keeps the
 * process alive, so the JS context -- and therefore this listener -- persists.
 *
 * THE RULE: show a widget when a trigger package opens AND a focus session is
 * active. Focus tools surface during focus; outside a session Tether stays out of
 * the way.
 */

let started = false;

export function startWidgetTrigger(): void {
  if (started) {
    return;
  }
  started = true;

  // Fix for the trigger list only being synced when the user saved settings.
  syncTriggerPackages().catch(() => {
    /* native not ready yet; harmless, it is re-synced on save */
  });

  // Deliberately never removed -- this lives for the life of the JS context.
  TetherEvents.onForegroundApp(async ({packageName, blocked}) => {
    try {
      if (blocked) {
        return; // the block wall owns the screen right now
      }

      const integration = integrationForPackage(packageName);
      if (!integration) {
        await Overlay.hide('WidgetOverlay');
        return;
      }

      const {isActive} = await Focus.getState();
      if (!isActive) {
        return;
      }

      if (!(await integration.isConfigured())) {
        return;
      }

      await Overlay.show('WidgetOverlay', WIDGET_LAYOUT, {
        integrationId: integration.id,
      });
    } catch {
      /* never let a widget error take down the listener */
    }
  });

  /**
   * Starting a session raises the obvious question -- focus on WHAT? -- so the
   * task card answers it, once the snake has finished crawling home.
   */
  let cardTimer: ReturnType<typeof setTimeout> | null = null;

  TetherEvents.onSessionChanged(state => {
    if (cardTimer) {
      clearTimeout(cardTimer);
      cardTimer = null;
    }

    if (state.isActive) {
      cardTimer = setTimeout(() => {
        Overlay.show('TaskCardOverlay', TASK_CARD_LAYOUT, {
          nonce: Date.now(),
        }).catch(() => {});
      }, CARD_DELAY_MS);
      return;
    }

    Overlay.hide('WidgetOverlay').catch(() => {});
    Overlay.hide('TaskCardOverlay').catch(() => {});
  });
}
