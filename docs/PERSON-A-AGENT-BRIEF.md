# Agent Brief — Person 1 (Person A): Interaction & Timer

You are implementing the slice owned by **Person 1**, referred to throughout this
repository as **Person A**. Both names mean the same person: the code comments and
the README say "Person A", the team says "Person 1".

The project is Tether, an Android focus app. The repository already contains a
working skeleton — your job is to finish and polish one vertical slice of it, not
to build the app from scratch.

Read this entire document before writing code.

---

## 1. Mission

Tether blocks distracting apps during a focus session. The session is started by
**dragging a "snake" down from the top of the screen** — a floating handle that
sits on top of every other app. Drag distance sets the timer length.

**That drag is the demo.** It is the only thing judges will remember. Your slice
owns it end to end: the gesture, the visual, the countdown, and the notification.

The other two slices belong to **Person 2 (Person B)** — blocking — and
**Person 3 (Person C)** — integrations. Their code already exists and works. You
must not modify it.

---

## 2. Non-negotiable constraints

Violating any of these breaks the whole app, often silently.

| # | Constraint | Why |
|---|---|---|
| C1 | **Never set `newArchEnabled=true`** in `android/gradle.properties` | The overlay system uses `ReactRootView`, which does not exist in bridgeless mode. Every overlay silently renders nothing — no error, no crash, blank screen. |
| C2 | **Never clone into a path containing a space** | Gradle and the NDK fail in confusing ways. Use `~/code/tether` or `C:\dev\tether`. |
| C3 | **Never add a native dependency without checking its Kotlin version** | This project pins React Native 0.75.4 / Kotlin 1.9.24. Modern libraries using KSP will fail with `org.jetbrains.kotlin.buildtools.api.SourcesChanges`. AsyncStorage was already removed for this reason. |
| C4 | **Never put a blocking decision behind the JS bridge** | Person B reads `FocusSessionStore` directly from Kotlin. If you move session state into JS, blocking breaks. |
| C5 | **Never commit `android/local.properties`** | Machine-specific SDK path. It is gitignored. |
| C6 | **Do not add a navigation or state-management library** | 13-hour hackathon. The app has three screens and a tab bar. |

---

## 3. Repository orientation

### Files you OWN (edit freely)

```
src/overlays/SnakeOverlay.tsx                         the drag gesture + visual
src/state/useFocusSession.ts                          session hook + formatting
android/app/src/main/java/com/tether/core/TetherService.kt        foreground service + countdown
android/app/src/main/java/com/tether/core/FocusSessionStore.kt    the shared contract
android/app/src/main/java/com/tether/modules/FocusModule.kt       JS bridge
```

### Files you may READ but MUST NOT EDIT

```
android/.../overlay/OverlayManager.kt        shared overlay host (A + C depend on it)
android/.../blocking/*                       Person B
android/.../modules/BlockingModule.kt        Person B
android/.../modules/StorageModule.kt         shared
android/.../core/Prefs.kt                    shared (you MAY add a key — see Task 5)
src/overlays/BlockOverlay.tsx                Person B
src/overlays/WidgetOverlay.tsx               Person C
src/screens/BlocklistScreen.tsx              Person B
src/screens/IntegrationsScreen.tsx           Person C
src/integrations/*                           Person C
src/state/widgetTrigger.ts                   Person C
```

### Files that are SHARED — coordinate before editing

```
src/native/index.ts        the typed contract. Adding is fine; changing an existing
                           signature breaks B and C.
index.js                   AppRegistry registrations.
App.tsx                    tab shell.
src/screens/HomeScreen.tsx contains the dev-simulate panel everyone uses.
```

---

## 4. The contract you must honour

Other people's code depends on these exact shapes. **Adding fields is safe.
Renaming or removing is not.**

### 4.1 Kotlin — `FocusSessionStore` (singleton, whole process)

```kotlin
object FocusSessionStore {
    val isActive: Boolean            // private set
    val endAtMs: Long                // private set, wall clock ms, 0 when inactive
    val durationMinutes: Int         // private set
    var blocklist: Set<String>       // public set
    var widgetTriggers: Set<String>  // public set

    fun start(minutes: Int, blocked: Set<String>)
    fun stop()
    fun remainingMs(): Long
    fun remainingMinutes(): Int
    fun isBlocked(pkg: String): Boolean    // Person B calls this every app switch
}
```

This is a plain Kotlin `object`, so it is a singleton across the entire app
process **including the AccessibilityService**. That is the whole design: Person B
can check `isBlocked(pkg)` in under a millisecond without touching JS.

### 4.2 TypeScript — `src/native/index.ts`

```ts
type FocusState = {
  isActive: boolean;
  durationMinutes: number;
  endAtMs: number;
  remainingMs: number;
  remainingMinutes: number;
};

Focus.arm(): Promise<boolean>                    // start the foreground service
Focus.disarm(): Promise<boolean>
Focus.startSession(minutes: number, blocklist: string[]): Promise<FocusState>
Focus.stopSession(): Promise<FocusState>
Focus.getState(): Promise<FocusState>
Focus.setBlocklist(list: string[]): Promise<boolean>
Focus.setWidgetTriggers(pkgs: string[]): Promise<boolean>

Overlay.show(name: string, options?: OverlayOptions, props?: object): Promise<boolean>
Overlay.setLayout(name: string, options: OverlayOptions): Promise<boolean>  // resize, no remount
Overlay.update(name: string, props: object): Promise<boolean>
Overlay.hide(name: string): Promise<boolean>
Overlay.hideAll(): Promise<boolean>

type OverlayOptions = {
  width?: number;   // dp, or Overlay.MATCH_PARENT (-1) / Overlay.WRAP_CONTENT (-2)
  height?: number;
  x?: number; y?: number;
  gravity?: 'top'|'bottom'|'center'|'topLeft'|'topRight'|'bottomLeft'|'bottomRight';
  focusable?: boolean;     // false => window never takes key input
  touchThrough?: boolean;  // true => taps outside the window reach the app below
};
```

### 4.3 Events (emitted from Kotlin, received in JS)

| Event | Payload | Emitted by | Consumed by |
|---|---|---|---|
| `tether:tick` | `{remainingMs, remainingMinutes}` | **You** (`TetherService`, 1/s) | Any countdown UI |
| `tether:session` | full `FocusState` | **You** (`FocusModule`, `TetherService`) | Everyone |
| `tether:foregroundApp` | `{packageName, blocked}` | Person B | Person C |

Subscribe via `TetherEvents.onTick(fn)` / `onSessionChanged(fn)` from
`src/native/index.ts`. They return a subscription — **always `.remove()` in the
cleanup of your `useEffect`**, or you will leak listeners each time an overlay
remounts.

---

## 5. How overlays actually work (read before touching SnakeOverlay)

`OverlayManager.kt` creates a `ReactRootView`, mounts a React component into it by
name, and adds it to `WindowManager` as a `TYPE_APPLICATION_OVERLAY` window.

So `Overlay.show('SnakeOverlay', …)` renders `src/overlays/SnakeOverlay.tsx` **on
top of Instagram**. You write React; Kotlin only supplies the window.

Consequences you must respect:

1. **Every overlay is registered in `index.js`.** `SnakeOverlay` is already there.
   A name typo means a blank window with no error.
2. **Overlays run in the same JS context as the main app.** Hooks, state and event
   subscriptions all work normally. `useFocusSession()` works inside the overlay.
3. **The window has no Activity.** Do not use `Modal`, `Alert`, or anything needing
   an Activity context. They will crash or no-op.
4. **The window swallows touches inside its bounds** even where your React tree is
   transparent. A 220×420dp window blocks a 220×420dp region of whatever app is
   underneath. Keep it as small as the interaction allows, and use
   `Overlay.setLayout()` to grow it only while dragging.
5. **`Overlay.show()` on an already-visible overlay just updates props** — it does
   not remount. Use `Overlay.setLayout()` to resize without losing React state.

---

## 6. Current state — what already works

Do not rebuild these. Verify them, then improve.

- `TetherService` runs as a foreground service with a persistent notification and
  ticks every 1000ms, emitting `tether:tick` and auto-ending at zero.
- `FocusModule` exposes the full `Focus.*` API listed above.
- `SnakeOverlay.tsx` has a working `PanResponder` drag with a linear
  distance→minutes mapping and a tapered trail of dots.
- `HomeScreen` has a **Dev · simulate** panel: *Start 1 min*, *Start 25 min*,
  *Stop*, *Show snake*, *Hide all overlays*.

### Known weaknesses you are expected to fix

| ID | Problem | Impact |
|---|---|---|
| W1 | `onPanResponderMove` calls `setState` on every frame | Full React re-render at 60fps. Visible jank — the worst thing possible in the one moment judges watch. |
| W2 | No haptic feedback | Drag feels dead. No confirmation the gesture registered. |
| W3 | Duration is unrounded (`37m`, `63m`) | Looks arbitrary rather than designed. |
| W4 | Session state is in-memory only | Force-stop or an OOM kill loses the session silently. |
| W5 | Notification has no action button | Ending a session requires finding the app. |
| W6 | Overlay window is a fixed 220×420dp | Blocks a large region of the app underneath even when idle. |

---

## 7. Tasks

Do these **in order**. Each task is independently shippable — commit after each.
Do not start Task N+1 until Task N's acceptance criteria pass on a real device.

---

### Task 0 — Baseline verification

**Goal:** prove the environment works before changing anything.

```bash
npm install
npm run setup          # writes android/local.properties
npm start              # terminal 1 — leave running
npm run android        # terminal 2
```

On the device:
1. Grant both permissions on the **Focus** tab (they open system Settings screens;
   they are not runtime dialogs).
2. Tap **Show snake**. A blue pill appears at the top of the screen.
3. Press Home. The pill stays visible over the launcher.
4. Tap **Start 1 min**. The notification shows a countdown. After 60s it ends.

**Acceptance:** all four steps pass. If step 2 fails, re-check the "Draw over other
apps" permission. If step 3 fails, the foreground service is not running — check
`adb shell dumpsys activity services com.tether`.

**Do not proceed until this passes.** Everything else assumes it does.

---

### Task 1 — Fix drag performance (W1)

**Goal:** 60fps drag with zero dropped frames.

**File:** `src/overlays/SnakeOverlay.tsx`

**Problem:** the current implementation stores drag distance in React state:

```tsx
onPanResponderMove: (_, gesture) => {
  const next = Math.max(0, Math.min(MAX_DRAG_DP, gesture.dy));
  dragRef.current = next;
  setDrag(next);        // <-- re-renders the whole tree, 60x/second
},
```

**Implementation:**

1. Replace the `drag` state with an `Animated.Value`:
   ```tsx
   const dragY = useRef(new Animated.Value(0)).current;
   ```
2. In `onPanResponderMove`, call `dragY.setValue(clamped)` instead of `setDrag`.
   Keep `dragRef.current = clamped` — you need the raw number on release.
3. Drive the handle and every trail segment with `transform: [{translateY}]` on
   `Animated.View`. Derive each segment's offset with `dragY.interpolate(...)`.
   **Animate `transform` and `opacity` only** — never `top`, `height`, or `width`;
   those trigger layout and cannot run on the native driver.
4. Set `useNativeDriver: true` on every `Animated` call.
5. The minute label **cannot** use the native driver (text content is not an
   animatable property). Keep it in React state but throttle updates: only
   `setState` when the rounded minute value actually changes.
   ```tsx
   const lastMinutes = useRef(0);
   // inside onPanResponderMove:
   const m = minutesFor(clamped);
   if (m !== lastMinutes.current) { lastMinutes.current = m; setMinutes(m); }
   ```
   This drops re-renders from ~60/s to ~10 over a full drag.
6. On release, spring the handle back:
   ```tsx
   Animated.spring(dragY, {toValue: 0, useNativeDriver: true, tension: 90, friction: 9}).start();
   ```

**Acceptance:**
- Drag is visibly smooth with no stutter.
- `adb shell dumpsys gfxinfo com.tether` shows no janky-frame spike during a drag.
- Releasing springs the handle back rather than snapping.
- The minute label still updates while dragging.

---

### Task 2 — Make the gesture feel deliberate (W2, W3)

**Goal:** the drag should feel like it has detents, and confirm itself physically.

**File:** `src/overlays/SnakeOverlay.tsx`

1. **Snap the duration to 5-minute increments.** Change `minutesFor`:
   ```tsx
   const SNAP_MINUTES = 5;
   function minutesFor(dragDp: number): number {
     const raw = Math.abs(dragDp) * MINUTES_PER_DP;
     const snapped = Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES;
     return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, snapped));
   }
   ```
2. **Vibrate on each detent.** Use React Native's built-in `Vibration` — do **not**
   add a haptics library (C3).
   ```tsx
   import {Vibration} from 'react-native';
   // when the snapped minute value changes during a drag:
   Vibration.vibrate(10);
   ```
3. **Vibrate differently on commit.** On a successful release, `Vibration.vibrate(30)`.
4. **Ignore stray taps.** The existing `if (distance < 20) return;` guard is correct —
   keep it. A tap must never start a session.
5. **Show the target duration prominently** while dragging — it is currently 13px
   text inside a 64×28dp pill. Make it legible at arm's length.

**Acceptance:**
- Dragging produces only multiples of 5 between 5 and 120.
- A short buzz fires each time the number changes, not on every frame.
- Tapping the handle without dragging does nothing.
- Releasing below the 20dp threshold does not start a session.

---

### Task 3 — Shrink the idle window (W6)

**Goal:** stop blocking a 220×420dp region of other apps when nothing is happening.

**Files:** `src/overlays/SnakeOverlay.tsx`, and the `Overlay.show('SnakeOverlay')`
call in `src/screens/HomeScreen.tsx`.

1. Export two layouts from `SnakeOverlay.tsx`:
   ```tsx
   export const SNAKE_LAYOUT_IDLE = {width: 96, height: 56, gravity: 'top' as const,
                                      touchThrough: true, focusable: false};
   export const SNAKE_LAYOUT_DRAGGING = {width: 220, height: 420, gravity: 'top' as const,
                                          touchThrough: true, focusable: false};
   ```
2. Show the overlay with the idle layout.
3. In `onPanResponderGrant`, call `Overlay.setLayout('SnakeOverlay', SNAKE_LAYOUT_DRAGGING)`.
4. In `onPanResponderRelease` **and** `onPanResponderTerminate`, set it back to idle
   after the spring-back animation completes.

`setLayout` calls `WindowManager.updateViewLayout`, which does **not** remount
React — your `Animated.Value` and component state survive.

**Acceptance:**
- Idle: only a small pill at top-center intercepts touches. Tapping 200dp below it
  reaches the app underneath.
- The window grows the instant a drag starts, so a full-length drag is not clipped.
- It returns to small after release, including when the drag is cancelled.

---

### Task 4 — Notification stop action (W5)

**Goal:** end a session from the notification shade.

**File:** `android/app/src/main/java/com/tether/core/TetherService.kt`

1. Add a `PendingIntent` targeting `TetherService` with action `ACTION_STOP`:
   ```kotlin
   private fun stopAction(): Notification.Action {
       val intent = Intent(this, TetherService::class.java).setAction(ACTION_STOP)
       val pending = PendingIntent.getService(
           this, 1, intent,
           PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
       )
       return Notification.Action.Builder(null, "End session", pending).build()
   }
   ```
   Note `getService`, not `getActivity`. `FLAG_IMMUTABLE` is mandatory on API 31+.
2. Add the action in `buildNotification()` only while `FocusSessionStore.isActive`.
3. Show remaining time as `M:SS` rather than whole minutes so it visibly counts down.

**Acceptance:**
- During a session the notification shows a live `M:SS` countdown and an
  "End session" button.
- Tapping it ends the session, hides the block overlay, and emits `tether:session`.
- No action button when idle.

---

### Task 5 — Survive process death (W4)

**Goal:** a session that is running must not vanish if Android kills the process.

**Files:** `TetherService.kt`, `FocusSessionStore.kt`, and `Prefs.kt` (adding a key
is allowed).

**Why this matters:** `FocusSessionStore` is in-memory. Force-stop, an OOM kill, or
a crash loses `endAtMs` silently — the timer is simply gone. `TetherService` already
returns `START_STICKY`, so Android restarts the service, but it restarts with empty
state.

1. Add to `Prefs.kt`:
   ```kotlin
   const val KEY_SESSION_END_AT = "session.endAt"
   const val KEY_SESSION_DURATION = "session.duration"
   ```
2. On `FocusSessionStore.start()`, persist `endAtMs` and `durationMinutes`.
   On `stop()`, clear them. `FocusSessionStore` has no `Context`, so do the writes
   from `FocusModule` and `TetherService` — **do not** add a Context field to the
   singleton; it will leak.
3. Extend `Prefs.hydrate(context)` to restore an unexpired session:
   ```kotlin
   val endAt = getString(context, KEY_SESSION_END_AT)?.toLongOrNull() ?: 0L
   if (endAt > System.currentTimeMillis()) {
       val minutes = ((endAt - System.currentTimeMillis()) / 60_000L).toInt() + 1
       FocusSessionStore.start(minutes, getStringSet(context, KEY_BLOCKLIST))
   }
   ```
   `hydrate` is already called from both `TetherService.onStartCommand` and
   `TetherAccessibilityService.onServiceConnected`, so restore happens on whichever
   comes back first.
4. Discard expired sessions — never restore one whose `endAtMs` is in the past.

**Acceptance:**
```bash
# start a 25-minute session, then:
adb shell am force-stop com.tether
# reopen the app
```
- The session is still active with roughly the correct time remaining.
- A session that expired while the process was dead does **not** come back.
- Blocking still works after the restore (Person B reads the same restored store).

---

### Task 6 — Session-end feedback

**Goal:** the user must know the session ended without looking at the screen.

**Files:** `TetherService.kt`, `src/overlays/SnakeOverlay.tsx`

1. In `TetherService.endSession()`, vibrate: get `VIBRATOR_SERVICE` and fire a
   short pattern. Add `<uses-permission android:name="android.permission.VIBRATE" />`
   to `AndroidManifest.xml` — it is a normal permission, granted at install with no
   prompt.
2. Post a one-shot completion notification (a **different** channel with
   `IMPORTANCE_DEFAULT`, so it makes a sound — the ongoing channel is
   `IMPORTANCE_LOW` and deliberately silent).
3. In `SnakeOverlay`, briefly show a "Done" state before returning to idle.

**Acceptance:** at session end the phone buzzes, a notification appears, and the
snake returns to its idle pill.

---

## 8. Build, run, verify

```bash
npm start                    # Metro. Leave running in its own terminal.
npm run android              # build + install + launch

# JS-only change? Just reload:
adb shell input text "RR"    # or shake the device

# Kotlin change? FULL REBUILD REQUIRED — Metro reload will NOT pick it up:
npm run android
```

**The single most common time-waster on this project:** editing Kotlin, reloading
Metro, and wondering why nothing changed. Native code requires `npm run android`.

### Useful commands

```bash
# Logs — ReactNativeJS is where console.log goes
adb logcat -s ReactNativeJS:V TetherService:V OverlayManager:V ReactNative:E

# Is the foreground service alive?
adb shell dumpsys activity services com.tether

# Simulate process death (Task 5)
adb shell am force-stop com.tether

# Frame timing during a drag (Task 1)
adb shell dumpsys gfxinfo com.tether

# Typecheck — run before every commit
npx tsc --noEmit

# Kotlin compiles without a full install
cd android && ./gradlew :app:compileDebugKotlin
```

---

## 9. Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Overlay shows a blank/invisible window | Component not registered in `index.js`, or name typo in `Overlay.show()` | Names must match exactly |
| Overlay never appears at all | `SYSTEM_ALERT_WINDOW` not granted | Focus tab → "Draw over other apps" |
| All overlays render nothing after a config change | `newArchEnabled=true` | Set it back to `false` (C1) |
| Kotlin edits have no effect | Metro reload does not rebuild native | `npm run android` |
| Overlay vanishes when leaving the app | Foreground service not running | Call `Focus.arm()` before `Overlay.show()` |
| Service dies after a few minutes | Battery optimisation | Settings → Apps → Tether → Battery → Unrestricted |
| `bad interpreter: /bin/sh^M` | CRLF line endings from a Windows commit | `.gitattributes` forces LF; `git rm --cached -r . && git reset --hard` |
| Build fails with `SourcesChanges` | A dependency needs a newer Kotlin | Remove it (C3) |
| Drag stutters | `setState` per frame | Task 1 |
| Touches do not reach the app below | Overlay window too large | Task 3 |
| `PendingIntent` crash on Android 12+ | Missing mutability flag | Add `FLAG_IMMUTABLE` |

---

## 10. Definition of done

- [ ] Task 0 baseline passes on a physical device
- [ ] Drag runs at 60fps with no dropped frames (Task 1)
- [ ] Duration snaps to 5-minute steps with haptic detents (Task 2)
- [ ] Idle overlay does not block the app underneath (Task 3)
- [ ] Notification shows `M:SS` and has a working "End session" action (Task 4)
- [ ] Session survives `am force-stop` (Task 5)
- [ ] Session end buzzes and notifies (Task 6)
- [ ] `npx tsc --noEmit` exits 0
- [ ] `cd android && ./gradlew :app:compileDebugKotlin` succeeds
- [ ] No files outside the "own" list in §3 were modified
- [ ] The contract in §4 is unchanged (fields added only, none renamed or removed)

---

## 11. Anti-goals

Do not do these, even if they seem like improvements:

- Do not add animation libraries (Reanimated, Moti, Skia). `Animated` with
  `useNativeDriver` is sufficient and adds no native build risk. Reanimated in
  particular requires a Babel plugin and a matching native version — a real risk of
  losing hours to a broken build.
- Do not add a gesture library. `PanResponder` is built in and works.
- Do not refactor the overlay system. `OverlayManager.kt` is shared with Person C.
- Do not move session state into JS or Redux. See C4.
- Do not write tests. There is no test infrastructure and no time.
- Do not redesign the other two screens. They belong to B and C.
- Do not "clean up" the **Dev · simulate** panel in `HomeScreen.tsx`. B and C rely
  on it until final integration.
- Do not bump the React Native version.

---

## 12. Integration protocol

Integrate with B and C in the **last 2–3 hours**, not continuously.

Before integration, verify your slice alone:
1. Show the snake, drag it, confirm a session starts with the right duration.
2. Confirm the notification counts down and the session auto-ends.
3. Confirm `Focus.getState()` returns correct values throughout.

At integration, the end-to-end path is:
**drag the snake → session starts → open Instagram → block overlay appears →
open Canvas → todo widget appears.**

If something breaks there, the failure is almost always a permission that got
revoked — Android disables the accessibility service after a reinstall. Re-check
the toggle first, before debugging code.
