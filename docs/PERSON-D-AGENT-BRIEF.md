# PERSON D - Gamification Agent Brief

## 1. Context and Objective
You are building the **Gamification Slice (Rewards & Leaderboard)** for Medusa, a React Native + Kotlin Android app. 

Medusa lets users drag a snake down to set a focus timer, blocking distracting apps. Your job is to make focusing rewarding. When a user completes a focus session, they earn points (1 point per minute). These points unlock "Snake Skins" (colors). You will also build a Leaderboard screen to compare scores.

**CRITICAL HACKATHON CONSTRAINTS:**
* **No heavy backend SDKs:** Do not install the Firebase or Supabase JS SDKs. If you need network calls, use standard `fetch()` to a REST endpoint.
* **Offline/Demo Resilience:** The leaderboard MUST have a fallback mock state. If the network fails on stage, it should silently render fake local data. Do not show error popups.
* **Do not touch the Kotlin blocking engine:** You operate entirely in React Native.

## 2. The Shared Contract
You will consume the existing `tether:session` events emitted by Person A's timer module. 
Assume this type exists in `src/native/index.ts`:

```ts
type FocusState = {
  isActive: boolean;
  durationMinutes: number;
  endAtMs: number;
  remainingMs: number;
  remainingMinutes: number;
  completedSuccessfully?: boolean; // You will check this to award points
};
```

## 3. File Ownership
You own these new files. Create them:
* `src/state/gamificationStore.ts` (Local persistence for points and unlocked skins using React Native's standard tools or the existing native `SharedPreferences` module).
* `src/screens/LeaderboardScreen.tsx` (The UI for the leaderboard).
* `src/components/RewardBadge.tsx` (UI for unlocking a snake skin).

You will minimally touch:
* `src/native/index.ts` (To listen to session end events).
* `src/overlays/SnakeOverlay.tsx` (To pass the unlocked color to the snake).

## 4. Tasks (Execute in order)

**Task 1: The Points Engine**
Create `src/state/gamificationStore.ts`.
* Implement a simple store (Zustand, or just a custom hook + event emitter) that tracks `totalPoints` (number) and `activeSkin` (string, hex code).
* Listen to the `tether:session` event. When a session ends and `completedSuccessfully` is true, add `durationMinutes` to `totalPoints`.
* Save this locally using the existing `SharedPreferences` module mentioned in the project docs.

**Task 2: Snake Skins (Rewards)**
* Define a threshold: e.g., 0 pts = Green, 30 pts = Blue, 120 pts = Golden.
* Modify `src/overlays/SnakeOverlay.tsx` to read `activeSkin` from your store and apply it to the snake's rendering logic. 

**Task 3: The Leaderboard Screen**
Create `src/screens/LeaderboardScreen.tsx`.
* Build a simple, stylized flat list showing Rank, Username, and Points.
* **The Data Fetcher:** Write a `fetchLeaderboard()` function using standard `fetch()`. 
* **The Mock Fallback:** If the fetch fails, times out after 2000ms, or returns an error, immediately catch it and return a hardcoded list of 5 fake users (e.g., "1. DemoUser - 450pts", "2. HackathonJudge - 420pts"). **Never show a loading spinner for more than 2 seconds.**

**Task 4: Hook up Navigation**
* Add a button or tab in the main app UI to navigate to the `LeaderboardScreen`.

## 5. Verification Commands
To test the gamification logic without waiting for real timers, use the "Dev · simulate" section in the app, or manually trigger the event in JS:

```ts
// Run this in a test harness to simulate a 30-minute successful session
DeviceEventEmitter.emit('tether:session', { 
  isActive: false, 
  durationMinutes: 30, 
  completedSuccessfully: true 
});
```

## 6. Failure Modes to Avoid

| Risk | Consequence | Mitigation |
|---|---|---|
| Network timeout | App freezes on stage while fetching leaderboard | Hardcode a 2-second timeout on the `fetch`. Fallback to mock data immediately. |
| State reset | User earns points, restarts app, points gone | Ensure `totalPoints` is flushed to the native `SharedPreferences` module synchronously. |
| Event spam | Points multiply endlessly | Debounce the `tether:session` completion listener or check timestamp IDs so a session is only credited once. |
