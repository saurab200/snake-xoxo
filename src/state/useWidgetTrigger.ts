import {useEffect} from 'react';
import {Overlay, TetherEvents} from '../native';
import {integrationForPackage} from '../integrations/registry';
import {WIDGET_LAYOUT} from '../overlays/WidgetOverlay';

/**
 * THE B -> C SEAM.
 *
 * Person B emits every foreground app change. Person C decides which ones matter.
 * Mount this once, from App.tsx.
 */
export function useWidgetTrigger() {
  useEffect(() => {
    const sub = TetherEvents.onForegroundApp(async ({packageName, blocked}) => {
      if (blocked) {
        return; // the block overlay owns the screen right now
      }

      const integration = integrationForPackage(packageName);
      if (!integration) {
        await Overlay.hide('WidgetOverlay');
        return;
      }

      if (!(await integration.isConfigured())) {
        return;
      }

      await Overlay.show('WidgetOverlay', WIDGET_LAYOUT, {
        integrationId: integration.id,
      });
    });

    return () => sub.remove();
  }, []);
}
