import {useEffect, useState} from 'react';
import {SessionEvent, TetherEvents} from '../native';
import {Focus} from '../native';
import {Storage} from './storage';

/**
 * GAMIFICATION STORE
 *
 * A tiny module-level store (no Redux/Zustand/Context) so that BOTH the main
 * app AND the separate overlay React roots can read the same state -- overlays
 * do not share React context with App.tsx, but they share this JS module.
 *
 * Responsibilities:
 *  - award 1 point per completed focus minute;
 *  - never double-credit the same session;
 *  - unlock/select snake skins by points;
 *  - persist everything through Tether's existing SharedPreferences-backed
 *    Storage (NOT AsyncStorage / MMKV / a new native module).
 */

/* ------------------------------------------------------------------ */
/* Skins                                                               */
/* ------------------------------------------------------------------ */

export type Skin = {
  id: string;
  name: string;
  color: string;
  requiredPoints: number;
};

/** Thresholds are fixed by product spec: do not change them. */
export const SKINS: Skin[] = [
  // Green matches the snake's existing green (#22c55e) so the default skin
  // leaves the overlay looking exactly as it did before gamification.
  {id: 'green', name: 'Green', color: '#22c55e', requiredPoints: 0},
  {id: 'blue', name: 'Blue', color: '#2196F3', requiredPoints: 30},
  {id: 'gold', name: 'Gold', color: '#FFC107', requiredPoints: 120},
];

export const DEFAULT_SKIN_ID = 'green';

export function skinById(id: string): Skin | undefined {
  return SKINS.find(s => s.id === id);
}

/* ------------------------------------------------------------------ */
/* Levels                                                              */
/* ------------------------------------------------------------------ */

/**
 * Flat curve, on purpose.
 *
 * A ramping curve is more elegant, but flat is instantly legible: one finished
 * 25-minute session is always exactly one level. That readability matters more
 * than elegance when someone is watching a two-minute demo, and it fills the
 * dead stretch between skin unlocks where nothing else visibly moves.
 *
 * Levels are DERIVED from totalPoints, never stored -- so there is no extra
 * persisted state, nothing to migrate, and the level can never disagree with
 * the point total.
 */
export const XP_PER_LEVEL = 25;

export type LevelInfo = {
  level: number;
  /** XP earned inside the current level. */
  xpIntoLevel: number;
  /** XP needed to span one level. */
  xpForLevel: number;
  /** XP still to earn before levelling up. */
  xpToNext: number;
  /** 0..1, for the progress bar. */
  progress: number;
};

export function levelForPoints(points: number): number {
  return Math.floor(Math.max(0, points) / XP_PER_LEVEL) + 1;
}

export function levelInfoFor(points: number): LevelInfo {
  const safe = Math.max(0, points);
  const xpIntoLevel = safe % XP_PER_LEVEL;
  return {
    level: levelForPoints(safe),
    xpIntoLevel,
    xpForLevel: XP_PER_LEVEL,
    xpToNext: XP_PER_LEVEL - xpIntoLevel,
    progress: xpIntoLevel / XP_PER_LEVEL,
  };
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export type GamificationState = {
  totalPoints: number;
  activeSkin: string;
  /** Fingerprints of sessions already credited, for restart-safe dedup. */
  creditedSessionIds: string[];
  /**
   * Ids of tasks the user has ticked off.
   *
   * Does double duty: it is why a ticked task stays gone when the panel is
   * reopened, AND the dedup record that stops the same task being credited
   * twice. Tasks are re-fetched from Canvas on every load, so without this a
   * refresh would resurrect everything the user had just cleared.
   */
  completedTaskIds: string[];
};

/** Cap the dedup list so it can never grow without bound. */
const MAX_CREDITED_IDS = 50;

/** XP for ticking off one task. Flat, for the same reason levels are flat. */
export const XP_PER_TASK = 10;

/** Cap the completed-task list the same way the session list is capped. */
const MAX_COMPLETED_TASKS = 200;

let state: GamificationState = {
  totalPoints: 0,
  activeSkin: DEFAULT_SKIN_ID,
  creditedSessionIds: [],
  completedTaskIds: [],
};

const listeners = new Set<() => void>();

/**
 * Fired ONCE per credited session, after the points have landed.
 *
 * Separate from the plain state subscription because celebrating is a discrete
 * event, not a state value: a re-render must never re-trigger it. The store
 * stays free of UI concerns -- src/state/rewardTrigger.ts listens and shows the
 * overlay, the same split widgetTrigger.ts uses for Person B -> Person C.
 */
export type AwardEvent = {
  pointsAwarded: number;
  totalPoints: number;
  previousLevel: number;
  level: number;
  leveledUp: boolean;
  /** Skins whose threshold this award crossed. Usually empty. */
  unlockedSkins: Skin[];
};

const awardListeners = new Set<(e: AwardEvent) => void>();

export function subscribeAward(listener: (e: AwardEvent) => void): () => void {
  awardListeners.add(listener);
  return () => {
    awardListeners.delete(listener);
  };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export function getGamificationState(): GamificationState {
  return state;
}

export function isSkinUnlocked(id: string, points: number = state.totalPoints): boolean {
  const skin = skinById(id);
  return !!skin && points >= skin.requiredPoints;
}

export function getActiveSkin(): Skin {
  return skinById(state.activeSkin) ?? SKINS[0];
}

/** Convenience for the overlay: the color the snake should render with. */
export function getActiveSkinColor(): string {
  return getActiveSkin().color;
}

/* ------------------------------------------------------------------ */
/* Subscriptions                                                       */
/* ------------------------------------------------------------------ */

export function subscribeGamification(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  listeners.forEach(l => {
    try {
      l();
    } catch {
      /* a bad listener must never break the others */
    }
  });
}

/** Replace state with a new object (so React identity checks re-render), notify, persist. */
function commit(next: Partial<GamificationState>): void {
  state = {...state, ...next};
  emit();
  persist(); // fire and forget; persist() swallows its own errors
}

async function persist(): Promise<void> {
  try {
    await Storage.setGamification(JSON.stringify(state));
  } catch {
    /* persistence best-effort; state still lives in memory this session */
  }
}

/* ------------------------------------------------------------------ */
/* Skin selection                                                      */
/* ------------------------------------------------------------------ */

/**
 * Activate a skin. Returns false and changes nothing if the skin is locked or
 * unknown -- the caller can never force a locked skin active.
 */
export function setActiveSkin(id: string): boolean {
  if (!isSkinUnlocked(id)) {
    return false;
  }
  if (state.activeSkin !== id) {
    commit({activeSkin: id});
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Points awarding                                                     */
/* ------------------------------------------------------------------ */

function awardPoints(sessionId: string, points: number): void {
  if (points <= 0) {
    return;
  }
  if (state.creditedSessionIds.includes(sessionId)) {
    return; // already credited this exact session -- no duplicate points
  }

  const before = state.totalPoints;
  const after = before + points;

  const creditedSessionIds = [...state.creditedSessionIds, sessionId].slice(
    -MAX_CREDITED_IDS,
  );
  commit({totalPoints: after, creditedSessionIds});

  const event: AwardEvent = {
    pointsAwarded: points,
    totalPoints: after,
    previousLevel: levelForPoints(before),
    level: levelForPoints(after),
    leveledUp: levelForPoints(after) > levelForPoints(before),
    // Thresholds crossed by this award, so the overlay can call them out.
    unlockedSkins: SKINS.filter(
      s => s.requiredPoints > before && s.requiredPoints <= after,
    ),
  };

  awardListeners.forEach(l => {
    try {
      l(event);
    } catch {
      /* a failing celebration must never cost the user their points */
    }
  });
}

/* ------------------------------------------------------------------ */
/* Task completion -> points                                           */
/* ------------------------------------------------------------------ */

export function isTaskCompleted(taskId: string): boolean {
  return state.completedTaskIds.includes(taskId);
}

/**
 * Credit a ticked task and remember that it is done.
 *
 * Returns the XP actually awarded -- 0 if this task was already credited, so
 * the caller can skip the "+XP" flourish rather than lie about it.
 *
 * Deliberately does NOT fire an AwardEvent. That channel means "a focus session
 * completed" and drives the celebration card; a tick is a small, frequent act
 * and popping a full-screen card for each one would be unbearable. The XP bar
 * watches plain state, so it still moves.
 */
export function completeTask(taskId: string): number {
  if (!taskId || isTaskCompleted(taskId)) {
    return 0;
  }
  const completedTaskIds = [...state.completedTaskIds, taskId].slice(
    -MAX_COMPLETED_TASKS,
  );
  commit({
    totalPoints: state.totalPoints + XP_PER_TASK,
    completedTaskIds,
  });
  return XP_PER_TASK;
}

/** Untick: gives the XP back, so the tick cannot be farmed by toggling. */
export function uncompleteTask(taskId: string): void {
  if (!isTaskCompleted(taskId)) {
    return;
  }
  commit({
    totalPoints: Math.max(0, state.totalPoints - XP_PER_TASK),
    completedTaskIds: state.completedTaskIds.filter(id => id !== taskId),
  });
}

/* ------------------------------------------------------------------ */
/* Session -> points bridge                                            */
/* ------------------------------------------------------------------ */

/**
 * The last active session we saw, captured from the isActive:true event, so we
 * can reconstruct its duration/deadline when the native end event arrives with
 * zeros (the native session-end payload carries no duration or completion flag).
 */
let activeSession: {durationMinutes: number; endAtMs: number} | null = null;
/** Last remaining time seen on a tick; lets us infer natural completion. */
let lastRemainingMs = 0;
/** Below this, the last tick effectively hit the end of the timer. */
const COMPLETION_REMAINING_THRESHOLD_MS = 2000;

function handleSessionEvent(e: SessionEvent): void {
  if (e.isActive) {
    // Session started (or updated): remember its real duration + deadline.
    activeSession = {durationMinutes: e.durationMinutes, endAtMs: e.endAtMs};
    lastRemainingMs = e.remainingMs;
    return;
  }

  // isActive === false: the session ended -- completed or cancelled.
  const finished = activeSession;
  activeSession = null;

  // 1) Completion: prefer an explicit flag (dev simulation / future native);
  //    otherwise infer from whether the last tick had essentially run out.
  const completed =
    typeof e.completedSuccessfully === 'boolean'
      ? e.completedSuccessfully
      : lastRemainingMs > 0 &&
        lastRemainingMs <= COMPLETION_REMAINING_THRESHOLD_MS;

  // Consume the tick memo: a stray second end event must not re-read it as a
  // completion. (The session-id check below is the real guard; this is belt.)
  lastRemainingMs = 0;

  if (!completed) {
    return; // cancelled/interrupted sessions earn nothing
  }

  // 2) Duration + deadline: the end event is zeroed, so fall back to the
  //    captured start values when needed.
  const durationMinutes =
    e.durationMinutes > 0 ? e.durationMinutes : finished?.durationMinutes ?? 0;
  const endAtMs = e.endAtMs > 0 ? e.endAtMs : finished?.endAtMs ?? 0;

  if (durationMinutes <= 0) {
    return; // nothing meaningful to credit
  }

  // 3) Stable fingerprint so the same session cannot be credited twice.
  const sessionId = `${endAtMs}:${durationMinutes}`;
  awardPoints(sessionId, durationMinutes);
}

/* ------------------------------------------------------------------ */
/* Hydration + initialization                                          */
/* ------------------------------------------------------------------ */

function sanitize(raw: unknown): GamificationState {
  const obj = (raw ?? {}) as Partial<GamificationState>;

  const totalPoints =
    typeof obj.totalPoints === 'number' &&
    isFinite(obj.totalPoints) &&
    obj.totalPoints >= 0
      ? Math.floor(obj.totalPoints)
      : 0;

  const creditedSessionIds = Array.isArray(obj.creditedSessionIds)
    ? obj.creditedSessionIds.filter(id => typeof id === 'string').slice(-MAX_CREDITED_IDS)
    : [];

  // Fall back to Green if the stored skin is unknown or no longer unlocked.
  let activeSkin =
    typeof obj.activeSkin === 'string' ? obj.activeSkin : DEFAULT_SKIN_ID;
  if (!isSkinUnlocked(activeSkin, totalPoints)) {
    activeSkin = DEFAULT_SKIN_ID;
  }

  const completedTaskIds = Array.isArray(obj.completedTaskIds)
    ? obj.completedTaskIds
        .filter(id => typeof id === 'string')
        .slice(-MAX_COMPLETED_TASKS)
    : [];

  return {totalPoints, activeSkin, creditedSessionIds, completedTaskIds};
}

let initialized = false;

/**
 * Idempotent. Safe to call from module scope (index.js) and from components.
 * Registers the session listener exactly once and hydrates persisted state.
 */
export function initializeGamification(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  // Hydrate persisted state, then prime the active-session snapshot.
  (async () => {
    try {
      const raw = await Storage.getGamification();
      if (raw) {
        state = sanitize(JSON.parse(raw));
        emit();
      }
    } catch {
      /* keep defaults on any parse/storage error */
    }

    // If a session is already running when JS (re)loads, capture it so we can
    // still credit it on completion.
    try {
      const s = await Focus.getState();
      if (s.isActive) {
        activeSession = {durationMinutes: s.durationMinutes, endAtMs: s.endAtMs};
        lastRemainingMs = s.remainingMs;
      }
    } catch {
      /* native not ready; the session event will populate this later */
    }
  })();

  // Track remaining time so we can infer natural completion for real sessions.
  TetherEvents.onTick(e => {
    lastRemainingMs = e.remainingMs;
  });

  // The one and only session listener. Never removed -- lives for the JS context.
  TetherEvents.onSessionChanged(handleSessionEvent);
}

/* ------------------------------------------------------------------ */
/* React hook                                                          */
/* ------------------------------------------------------------------ */

export type UseGamification = GamificationState &
  LevelInfo & {
    skins: Skin[];
    activeSkinObj: Skin;
    activeSkinColor: string;
    isSkinUnlocked: (id: string) => boolean;
    setActiveSkin: (id: string) => boolean;
  };

export function useGamification(): UseGamification {
  const [snap, setSnap] = useState<GamificationState>(getGamificationState());

  useEffect(() => {
    // Belt and braces: index.js already did this at module scope, and the call
    // is idempotent, so no listener is ever registered twice.
    initializeGamification();
    // Re-sync immediately in case state changed between render and subscribe.
    setSnap(getGamificationState());
    return subscribeGamification(() => setSnap(getGamificationState()));
  }, []);

  const activeSkinObj = skinById(snap.activeSkin) ?? SKINS[0];

  return {
    ...snap,
    ...levelInfoFor(snap.totalPoints),
    skins: SKINS,
    activeSkinObj,
    activeSkinColor: activeSkinObj.color,
    isSkinUnlocked: (id: string) => isSkinUnlocked(id, snap.totalPoints),
    setActiveSkin,
  };
}
