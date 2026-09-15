import {useEffect, useState} from 'react';
import {Clock, TetherEvents} from '../native';

/**
 * THE ONLY WAY AN OVERLAY ANIMATES.
 *
 * `Animated` and `setTimeout`/`requestAnimationFrame` are all dead while Tether
 * is backgrounded, which is the only state an overlay is ever seen in. Renders
 * driven by native events are not -- so a run is started natively, JS subscribes
 * to its frames, and every frame is an ordinary re-render painting a final
 * state. Nothing is ever mid-tween, so nothing can freeze mid-tween.
 *
 * Two React roots in different windows can subscribe to the same run id, which
 * is what lets the task panel and the XP flight animate in step despite being
 * separate windows.
 */

let nextRunId = 1;

/**
 * Start an animation run and return its id. The id is what every subscriber
 * keys on, so hand it to each window that has to paint this animation.
 */
export function startNativeRun(durationMs: number): number {
  const id = nextRunId++;
  Clock.start(id, durationMs).catch(() => {
    /* native not linked: the caller's UI simply never advances past t=0 */
  });
  return id;
}

export type NativeProgress = {
  /** 0..1, or null until the first frame of this run arrives. */
  t: number | null;
  /** True once the run's final frame has landed (or there is no run). */
  done: boolean;
};

/**
 * Subscribe to one run's frames.
 *
 * Pass null when nothing is running. Frames for other run ids are ignored, so a
 * superseded animation cannot drive a component that has moved on.
 */
export function useNativeProgress(runId: number | null): NativeProgress {
  const [frame, setFrame] = useState<{
    runId: number;
    t: number;
    done: boolean;
  } | null>(null);

  useEffect(() => {
    if (runId === null) {
      return;
    }
    const sub = TetherEvents.onClock(e => {
      if (e.id !== runId) {
        return;
      }
      setFrame({runId: e.id, t: e.t, done: e.done});
    });
    return () => sub.remove();
  }, [runId]);

  /**
   * Derived from the run id rather than reset in an effect, which matters: a
   * caller that starts a run and clears itself on `done` would otherwise read
   * the PREVIOUS run's `done: true` on the first render of the new one and tear
   * its own animation down before a single frame arrived.
   */
  if (runId === null) {
    return {t: null, done: true};
  }
  if (frame === null || frame.runId !== runId) {
    return {t: null, done: false};
  }
  return {t: frame.t, done: frame.done};
}
