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
/* State                                                               */
/* ------------------------------------------------------------------ */

export type GamificationState = {
  totalPoints: number;
  activeSkin: string;
  /** Fingerprints of sessions already credited, for restart-safe dedup. */
  creditedSessionIds: string[];
};

/** Cap the dedup list so it can never grow without bound. */
const MAX_CREDITED_IDS = 50;

let state: GamificationState = {
  totalPoints: 0,
  activeSkin: DEFAULT_SKIN_ID,
  creditedSessionIds: [],
};

const listeners = new Set<() => void>();

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
  const creditedSessionIds = [...state.creditedSessionIds, sessionId].slice(
    -MAX_CREDITED_IDS,
  );
  commit({
    totalPoints: state.totalPoints + points,
    creditedSessionIds,
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

  return {totalPoints, activeSkin, creditedSessionIds};
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

export type UseGamification = GamificationState & {
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
    skins: SKINS,
    activeSkinObj,
    activeSkinColor: activeSkinObj.color,
    isSkinUnlocked: (id: string) => isSkinUnlocked(id, snap.totalPoints),
    setActiveSkin,
  };
}
