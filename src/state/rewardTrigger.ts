import {Overlay, Permissions} from '../native';
import {REWARD_LAYOUT} from '../overlays/RewardOverlay';
import {AwardEvent, subscribeAward} from './gamificationStore';

/**
 * Turns a credited session into the celebration overlay.
 *
 * Kept OUT of gamificationStore for the same reason widgetTrigger is kept out
 * of the blocking engine: the store owns state, this owns presentation. The
 * store fires one award event per credited session; if that event ever stops
 * being unique, this file shows a duplicate popup but cannot corrupt anyone's
 * points.
 *
 * Runs at module scope from index.js -- Android destroys MainActivity whenever
 * the user leaves Tether, and a session almost always completes while they are
 * in another app. An effect mounted from a component would have been torn down
 * long before the payoff.
 */

let started = false;

async function celebrate(event: AwardEvent): Promise<void> {
  try {
    // A floating window is impossible without this, and show() would only log
    // a warning. Checking first keeps the failure quiet and intentional.
    const {overlay} = await Permissions.getStatus();
    if (!overlay) {
      return;
    }

    await Overlay.show('RewardOverlay', REWARD_LAYOUT, {
      // The window may already be up from a previous award, in which case React
      // is not remounted -- this is what tells the component to replay.
      nonce: Date.now(),
      pointsAwarded: event.pointsAwarded,
      unlockedSkin: event.unlockedSkins[0]?.name,
    });
  } catch {
    /* never let a missing celebration surface as an error to the user */
  }
}

export function startRewardTrigger(): void {
  if (started) {
    return;
  }
  started = true;

  // Deliberately never unsubscribed -- this lives for the life of the JS context.
  subscribeAward(event => {
    celebrate(event);
  });
}
