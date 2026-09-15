# Agent Brief — Person 2 (Person B): Blocking Engine

You are implementing the slice owned by **Person 2**, referred to throughout this
repository as **Person B**. Both names mean the same person: the code comments and
the README say "Person B", the team says "Person 2".

The project is Medusa, an Android focus app. The repository already contains a
working skeleton — your job is to finish and harden one vertical slice of it, not
to build the app from scratch.

Read this entire document before writing code.

---

## STATUS — as of the latest commit

Tasks 1–5 are **implemented**. Verify them on a device, then continue from Task 6.

| Task | State | Notes |
|---|---|---|
| 1 — vanishing wall | **Done** | Strategy A: `performGlobalAction(GLOBAL_ACTION_HOME)` removed. The wall now persists until dismissed or the session ends. |
| 2 — re-block reliably | **Done** | Dedup now exempts blocked packages: `if (pkg == lastPackage && !blocked) return`. |
| 3 — live countdown | **Done** | `BlockOverlay` renders `formatRemaining(session.remainingMs)` and self-dismisses 2s after the session ends. |
| 4 — dead service warning | **Done** | Red banner on the Blocked tab, re-checked on `AppState` → `active`. |
| 5 — usable blocklist | **Done except icons** | Search, selected-first sorting, count, Clear all. Icons deliberately skipped — cosmetic, and encoding 200 PNGs blocks the UI thread. |
| 6 — hardening | **Partly done** | Battery-optimisation button added to the Focus tab. Cold-start verification still needs a device **and** Person 1's Task 5 (session persistence). |

### One deliberate deviation from Task 1 as written

The task said to add the **launcher** to `IGNORED`. **Do not do this.** Going Home is
how the user legitimately leaves a blocked app, and that launcher event is what
dismisses the wall. Ignoring it would leave the wall stuck over the home screen.

The keyboard (current IME) is ignored instead — resolved at `onServiceConnected`
via `Settings.Secure.DEFAULT_INPUT_METHOD`. That was the real source of handler
churn. The reasoning is in a comment on `IGNORED`; do not "fix" it back.

### Still to do

- Run Task 0 on a physical device and confirm Tasks 1–4 behave as described.
- Task 6 cold-start check, once Person 1's session persistence lands.
- Optionally, app icons (Task 5) if there is spare time at the end.


---

## 1. Mission

Medusa blocks distracting apps during a focus session. **You own the blocking.**

When a focus session is active and the user opens Instagram, your code must detect
it within milliseconds and put a full-screen "blocked" wall in front of them.

Your slice is the *credibility* of the product. The snake (Person 1) is the demo
hook, but if a judge opens Instagram and it just works, the demo is dead.

The other two slices belong to **Person 1 (Person A)** — the snake and timer — and
**Person 3 (Person C)** — integrations. Their code already exists and works. You
must not modify it.

---

## 2. Non-negotiable constraints

Violating any of these breaks the whole app, often silently.

| # | Constraint | Why |
|---|---|---|
| C1 | **Never set `newArchEnabled=true`** in `android/gradle.properties` | The overlay system uses `ReactRootView`, which does not exist in bridgeless mode. Every overlay silently renders nothing — no error, no crash, blank screen. |
| C2 | **Never clone into a path containing a space** | Gradle and the NDK fail in confusing ways. Use `~/code/tether` or `C:\dev\tether`. |
| C3 | **Never add a native dependency without checking its Kotlin version** | This project pins React Native 0.75.4 / Kotlin 1.9.24. Libraries using KSP fail with `org.jetbrains.kotlin.buildtools.api.SourcesChanges`. AsyncStorage was already removed for this reason. |
| C4 | **Never route a blocking decision through JS** | `onAccessibilityEvent` must decide in Kotlin by reading `FocusSessionStore` directly. The bridge adds latency and the JS thread may be asleep. This is the single most important design rule in your slice. |
| C5 | **Never request `QUERY_ALL_PACKAGES`** | The existing `<queries>` manifest block is sufficient and avoids a Play Store policy declaration. |
| C6 | **Never call `setServiceInfo` to widen event types beyond what you need** | More event types means your handler runs on every UI change in every app. It will cause visible lag. |
| C7 | **Do not add a navigation or state-management library** | 13-hour hackathon. |

---

## 3. Repository orientation

### Files you OWN (edit freely)

```
android/app/src/main/java/com/tether/blocking/TetherAccessibilityService.kt   detection
android/app/src/main/java/com/tether/blocking/AppList.kt                      installed apps
android/app/src/main/java/com/tether/modules/BlockingModule.kt                JS bridge
src/overlays/BlockOverlay.tsx                                                 the block wall
src/screens/BlocklistScreen.tsx                                               app picker
android/app/src/main/res/xml/accessibility_service_config.xml                 service config
```

### Files you may READ but MUST NOT EDIT

```
android/.../core/FocusSessionStore.kt        Person 1 owns. You READ it.
android/.../core/TetherService.kt            Person 1
android/.../modules/FocusModule.kt           Person 1
android/.../overlay/OverlayManager.kt        shared overlay host
android/.../core/Prefs.kt                    shared (you MAY add a key)
src/overlays/SnakeOverlay.tsx                Person 1
src/overlays/WidgetOverlay.tsx               Person 3
src/screens/IntegrationsScreen.tsx           Person 3
src/integrations/*                           Person 3
src/state/widgetTrigger.ts                   Person 3
src/state/useFocusSession.ts                 Person 1
```

### Files that are SHARED — coordinate before editing

```
src/native/index.ts        the typed contract. Adding is fine; changing an existing
                           signature breaks 1 and 3.
index.js                   AppRegistry registrations + startWidgetTrigger().
App.tsx                    tab shell.
src/screens/HomeScreen.tsx contains the dev-simulate panel everyone uses.
AndroidManifest.xml        you own the <service> and <queries> blocks only.
```

---

## 4. The contract you must honour

### 4.1 What you CONSUME — `FocusSessionStore` (Kotlin, read-only for you)

```kotlin
object FocusSessionStore {
    val isActive: Boolean
    val endAtMs: Long
    val durationMinutes: Int
    var blocklist: Set<String>       // you may write this via FocusModule.setBlocklist
    var widgetTriggers: Set<String>  // Person 3's concern

    fun remainingMinutes(): Int
    fun isBlocked(pkg: String): Boolean   // <- YOUR primary call
}
```

It is a plain Kotlin `object`, therefore a singleton across the **entire app
process including your AccessibilityService**. That is why `isBlocked(pkg)` is a
sub-millisecond in-memory check with no bridge hop. Do not undermine this.

### 4.2 What you PRODUCE — the `tether:foregroundApp` event

Person 3 depends on this exact shape. Do not rename or remove fields.

```kotlin
RNBridge.emit(this, TetherEvents.FOREGROUND_APP, Arguments.createMap().apply {
    putString("packageName", pkg)
    putBoolean("blocked", blocked)
})
```

Received in JS as:

```ts
TetherEvents.onForegroundApp(({packageName, blocked}) => { ... })
```

**You must emit this for every foreground change, blocked or not.** Person 3's
widget logic breaks if you only emit on blocked apps.

### 4.3 Your JS bridge — `src/native/index.ts`

```ts
Blocking.isAccessibilityEnabled(): Promise<boolean>
Blocking.openAccessibilitySettings(): Promise<boolean>
Blocking.getInstalledApps(): Promise<{packageName: string; label: string}[]>
Blocking.getSuggestedBlocklist(): Promise<string[]>

Focus.setBlocklist(list: string[]): Promise<boolean>   // Person 1's module, yours to call
```

### 4.4 Overlay API (shared)

```ts
Overlay.show(name, options?, props?): Promise<boolean>   // show() on a visible overlay updates props
Overlay.hide(name): Promise<boolean>
```

Your overlay is registered as `'BlockOverlay'` in `index.js`.

---

## 5. How overlays actually work (read before touching BlockOverlay)

`OverlayManager.kt` creates a `ReactRootView`, mounts a React component into it by
name, and adds it to `WindowManager` as a `TYPE_APPLICATION_OVERLAY` window. So
`Overlay.show('BlockOverlay', …)` renders `src/overlays/BlockOverlay.tsx` **on top
of Instagram**.

Consequences for your slice:

1. **Your overlay is full-screen and focusable.** It is created with
   `width/height = MATCH_PARENT`, `focusable = true`, `touchThrough = false`, so it
   captures all touches and can consume the back button.
2. **The window has no Activity.** Do not use `Modal`, `Alert`, or `Linking` calls
   needing an Activity. They crash or silently no-op.
3. **`Overlay.show()` on an already-visible overlay updates props without
   remounting.** Use this to refresh the countdown rather than hide-then-show,
   which causes a visible flicker.
4. **Overlays cannot cover certain system surfaces** — the notification shade,
   recents, and Settings. This is an OS guarantee you cannot defeat, and you should
   not try. Demo over a normal app.

---

## 6. Current state — what already works

Do not rebuild these. Verify, then fix.

- `TetherAccessibilityService` receives `TYPE_WINDOW_STATE_CHANGED`, extracts the
  package name, checks `FocusSessionStore.isBlocked(pkg)`, and shows `BlockOverlay`.
- `Prefs.hydrate()` restores the persisted blocklist in `onServiceConnected`, so
  blocking works on a cold start before JS has run.
- `AppList.installed()` returns launchable apps; `SUGGESTED_BLOCKLIST` has eight
  common time sinks.
- `BlocklistScreen` lists apps, pre-selects installed suggestions on first run, and
  persists through `Storage.setBlocklist` + `Focus.setBlocklist`.
- `BlockOverlay` shows the app label, remaining time, and two buttons.

### Known bugs and weaknesses you must fix

| ID | Problem | Severity |
|---|---|---|
| **W1** | **The block overlay disappears immediately.** `onBlockedAppOpened` shows the overlay, then calls `performGlobalAction(GLOBAL_ACTION_HOME)`. Going home fires a new `TYPE_WINDOW_STATE_CHANGED` for the **launcher**, which is not in `IGNORED` and not blocked — so the `else` branch runs `OverlayManager.hide("BlockOverlay")`. The wall flashes and vanishes. | **Demo-breaking** |
| W2 | `IGNORED` contains only `com.tether`, `com.android.systemui`, `android`. The launcher, keyboard, and OEM system apps all pass through and churn the handler. | High |
| W3 | `lastPackage` dedup means re-entering the same blocked app without an intervening app switch produces no event, so the wall never reappears. | High |
| W4 | `BlocklistScreen` renders every installed app with no search. On a real phone that is 150–250 rows and unusable under demo pressure. | Medium |
| W5 | Nothing detects the accessibility service being silently killed. Android disables it after a reinstall or force-stop and the app gives no warning. | High |
| W6 | The block overlay's countdown is static — it shows `remainingMinutes` from the props at mount and never ticks. | Medium |
| W7 | No app icons in the blocklist, making it slow to scan visually. | Low |

---

## 7. Tasks

Do these **in order**. Each is independently shippable — commit after each. Do not
start Task N+1 until Task N's acceptance criteria pass on a physical device.

---

### Task 0 — Baseline verification

```bash
npm install
npm run setup
npm start              # terminal 1 — leave running
npm run android        # terminal 2
```

On the device:
1. Focus tab → grant **both** permissions (system Settings screens, not dialogs).
2. Blocked tab → confirm the installed-app list appears and some apps are ticked.
3. Focus tab → **Start 25 min**.
4. Press Home, open a blocked app (Instagram, or tick Chrome for testing).
5. Observe what happens.

**Expected at baseline:** the block wall appears and then immediately vanishes.
That is W1, and it is your first task. If the wall never appears at all, the
accessibility service is not running — check with:

```bash
adb shell settings get secure enabled_accessibility_services
```

It must contain `com.tether/com.tether.blocking.TetherAccessibilityService`.

**Do not proceed until you can reproduce W1.**

---

### Task 1 — Fix the vanishing block wall (W1, W2)

**Goal:** the wall stays up until the user acts on it.

**File:** `android/.../blocking/TetherAccessibilityService.kt`

**Root cause:** the hide-on-unblocked branch is unconditional, and going home
generates an unblocked foreground event.

**Implementation — pick ONE of these two strategies. Do not do both.**

**Strategy A (recommended): keep the wall, drop the home action.**

1. Delete the `performGlobalAction(GLOBAL_ACTION_HOME)` call. The full-screen
   focusable overlay already prevents interaction with the app underneath.
2. Only hide the wall when the user dismisses it, or the session ends. Remove the
   `else { OverlayManager.hide(...) }` branch from `onAccessibilityEvent`.
3. Add an explicit hide path in `BlockingModule` so `BlockOverlay.tsx` can dismiss
   itself — it already calls `Overlay.hide('BlockOverlay')`, which works.

**Strategy B: keep the home action, guard the hide.**

1. Track the package that triggered the wall in a field, e.g. `blockedPackage`.
2. Only hide when the newly foregrounded package is *neither* the blocked package
   *nor* the launcher.
3. Resolve the launcher package once at `onServiceConnected`:
   ```kotlin
   private fun launcherPackage(): String? =
       packageManager.resolveActivity(
           Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME),
           PackageManager.MATCH_DEFAULT_ONLY,
       )?.activityInfo?.packageName
   ```

**Also fix W2 regardless of strategy.** Expand `IGNORED` to include the resolved
launcher package and the active input method. Resolve them at `onServiceConnected`
and store in a `Set<String>` field — do not hardcode vendor package names, they
differ per device and yours will not match the demo phone.

**Acceptance:**
- Open a blocked app during a session → the wall appears and **stays**.
- Tapping "Back to focus" dismisses it.
- Switching to a non-blocked app does not leave a stray wall behind.
- Opening the blocked app again brings the wall back (see Task 2 if it does not).

---

### Task 2 — Re-block reliably (W3)

**Goal:** the wall reappears every time the user returns to a blocked app.

**File:** `TetherAccessibilityService.kt`

**Problem:** `if (pkg == lastPackage) return` suppresses repeat events. If the user
dismisses the wall and Instagram is still foreground, no further event fires.

**Implementation:**
1. Keep the dedup — without it you will handle dozens of redundant events per
   second — but **exempt blocked packages**:
   ```kotlin
   val blocked = FocusSessionStore.isBlocked(pkg)
   if (pkg == lastPackage && !blocked) return
   lastPackage = pkg
   ```
2. Guard against re-showing a wall that is already visible. `OverlayManager` exposes
   `isShowing(name)`; calling `show()` on a visible overlay only updates props, so
   this is safe — but avoid calling it in a tight loop.
3. When a session **ends**, hide the wall. `TetherService.endSession()` already
   calls `OverlayManager.hide(this, "BlockOverlay")` — verify it still does after
   Person 1's changes, and do not duplicate it.

**Acceptance:**
- Dismiss the wall, stay in the blocked app, switch away and back → wall returns.
- A non-blocked app switched to repeatedly does not spam the handler. Verify with
  `adb logcat` that you are not logging hundreds of events per second.

---

### Task 3 — Live countdown on the wall (W6)

**Goal:** the wall shows a ticking `M:SS`, not a frozen number.

**File:** `src/overlays/BlockOverlay.tsx`

The component already calls `useFocusSession()`, which subscribes to `tether:tick`.
Verify it is actually rendering `session.remainingMs` through `formatRemaining()`
rather than the static `remainingMinutes` prop passed at mount.

1. Use the hook's live value as the source of truth; treat the prop as a first-paint
   fallback only.
2. When the session ends while the wall is visible, show a clear "Session complete"
   state and auto-dismiss after ~2 seconds.
3. Make the app label prominent — this is the one screen that explains *why* the
   phone stopped working.

**Acceptance:**
- The countdown visibly ticks every second while the wall is up.
- At session end the wall dismisses itself without user action.

---

### Task 4 — Detect a dead accessibility service (W5)

**Goal:** never demo with blocking silently disabled.

**Files:** `src/screens/BlocklistScreen.tsx`, `src/screens/HomeScreen.tsx` (shared —
coordinate), `BlockingModule.kt`

**Why this matters:** Android disables the accessibility service after a reinstall
or a force-stop, with no notification. Every `npm run android` reinstalls. This is
the **number one cause of failed live demos** for this category of app.

1. `Blocking.isAccessibilityEnabled()` already exists. Poll it when the app returns
   to the foreground:
   ```tsx
   AppState.addEventListener('change', s => { if (s === 'active') recheck(); });
   ```
2. If a session is active but the service is **not** enabled, show a loud persistent
   banner — this state means blocking is silently doing nothing.
3. Tapping the banner calls `Blocking.openAccessibilitySettings()`.

**Acceptance:**
```bash
adb shell settings put secure enabled_accessibility_services ""
```
- Reopen the app → the warning appears within a second.
- Re-enabling the service clears it without an app restart.

---

### Task 5 — Make the blocklist usable (W4, W7)

**Goal:** find and tick an app in under five seconds.

**File:** `src/screens/BlocklistScreen.tsx`

1. Add a `TextInput` search filtering on `label` (case-insensitive). No new
   dependency — filter the array you already have.
2. Sort selected apps to the top so the current blocklist is visible at a glance.
3. Show a count and a "Clear all" action.
4. **Optional, only if Tasks 0–4 are done:** add icons. This requires a new
   `BlockingModule` method returning base64 PNGs:
   ```kotlin
   val drawable = pm.getApplicationIcon(pkg)
   // draw to a Bitmap, compress to PNG, Base64.encodeToString(bytes, Base64.NO_WRAP)
   ```
   Return `data:image/png;base64,…` strings. Do this for the visible rows only —
   encoding 200 icons at once will block the UI thread. If you are short on time,
   **skip this**; it is cosmetic.

**Acceptance:**
- Typing "ins" narrows to Instagram immediately.
- Ticking persists across an app restart (`Prefs` + `Focus.setBlocklist`).
- Changing the list mid-session takes effect on the next app switch, with no
  restart.

---

### Task 6 — Harden against demo conditions

1. **Battery optimisation.** Add a button that opens
   `Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`. Do **not** use
   `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` — it is a Play-policy-restricted
   intent. Opening the general settings screen is safe.
2. **Verify blocking survives a cold start.** `Prefs.hydrate()` should restore the
   blocklist before any JS runs.
   ```bash
   adb shell am force-stop com.tether
   # then open a blocked app directly, without opening Medusa first
   ```
   The wall must still appear if a session is active (this depends on Person 1's
   Task 5 session persistence — coordinate).
3. **Confirm you never block yourself.** `com.tether` is in `IGNORED`. Never remove
   it, or the wall will trigger on your own app and create an unrecoverable loop
   that requires uninstalling via adb.

---

## 8. Build, run, verify

```bash
npm start                    # Metro. Leave running.
npm run android              # build + install + launch

# JS-only change? Reload Metro (shake device, or press R twice).
# KOTLIN CHANGE? FULL REBUILD REQUIRED:
npm run android
```

**The single biggest time-waster on this project:** editing Kotlin, reloading
Metro, and wondering why nothing changed. Native code requires `npm run android`.

### Commands you will need constantly

```bash
# Is the accessibility service actually enabled?
adb shell settings get secure enabled_accessibility_services

# Disable it, to test Task 4
adb shell settings put secure enabled_accessibility_services ""

# What package is in the foreground right now? (sanity-check your detection)
adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'

# Your logs
adb logcat -s TetherAccessibility:V OverlayManager:V ReactNativeJS:V ReactNative:E

# Find a package name to add to the blocklist
adb shell pm list packages | grep -i instagram

# Typecheck + Kotlin compile before every commit
npx tsc --noEmit
cd android && ./gradlew :app:compileDebugKotlin
```

---

## 9. Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Wall appears then instantly vanishes | W1 — the home action fires an unblocked event | Task 1 |
| Wall never appears | Accessibility service disabled | Check `settings get secure enabled_accessibility_services` |
| Wall never appears, service IS enabled | `FocusSessionStore.isActive` is false | Start a session first |
| Wall never appears, session IS active | Package not in the blocklist | `adb shell pm list packages \| grep -i <app>` and verify the exact name |
| Wall appears over your own app | `com.tether` removed from `IGNORED` | Put it back; uninstall via `adb uninstall com.tether` to recover |
| Handler fires constantly, device lags | Event types widened (C6), or launcher not ignored | Task 1 W2 |
| Overlay renders blank | Component not registered in `index.js`, or name typo | Names must match exactly |
| All overlays blank after a config change | `newArchEnabled=true` | Set back to `false` (C1) |
| Installed-app list is empty | `<queries>` block removed from the manifest | Restore it — Android 11+ hides packages without it |
| Kotlin edits have no effect | Metro does not rebuild native | `npm run android` |
| Service dies after minutes | Battery optimisation | Task 6 |
| Build fails with `SourcesChanges` | A dependency needs newer Kotlin | Remove it (C3) |

---

## 10. Definition of done

- [ ] Task 0 baseline reproduced on a physical device
- [ ] Block wall stays up until dismissed or session end (Task 1)
- [ ] Re-entering a blocked app re-shows the wall (Task 2)
- [ ] Wall shows a live ticking countdown and self-dismisses at session end (Task 3)
- [ ] A disabled accessibility service produces a visible warning (Task 4)
- [ ] Blocklist is searchable and persists (Task 5)
- [ ] Blocking works after `am force-stop` (Task 6)
- [ ] `tether:foregroundApp` still fires for **every** foreground change, blocked or
      not — Person 3 depends on this
- [ ] `npx tsc --noEmit` exits 0
- [ ] `cd android && ./gradlew :app:compileDebugKotlin` succeeds
- [ ] No files outside the "own" list in §3 were modified

---

## 11. Anti-goals

- Do not attempt to block the notification shade, recents, or Settings. The OS
  prevents overlays there. Trying to defeat it wastes hours and can get an app
  flagged as malware.
- Do not use `UsageStatsManager` polling as a *replacement* for the accessibility
  service. It has a multi-second delay and is far too slow for this UX.
- Do not add `QUERY_ALL_PACKAGES` (C5).
- Do not kill or force-stop other apps. It requires privileges you do not have, and
  the attempt looks hostile.
- Do not make the wall impossible to dismiss. Keep an escape hatch — a judge who
  cannot exit your demo app will remember it for the wrong reason.
- Do not write tests. No infrastructure, no time.
- Do not refactor `OverlayManager.kt` — shared with Persons 1 and 3.
- Do not remove the **Dev · simulate** panel in `HomeScreen.tsx` until final
  integration.

---

## 12. Integration protocol

Integrate with Persons 1 and 3 in the **last 2–3 hours**, not continuously.

Until then, use the **Dev · simulate** panel so you are never blocked:
- **Start 1 min** / **Start 25 min** gives you a real active session without needing
  Person 1's snake to work.
- **Show block overlay** renders your wall with fake props so you can style it with
  no session at all.

Verify your slice alone before integrating:
1. Start a session from the dev panel.
2. Open a blocked app → wall appears and stays.
3. Dismiss, re-enter → wall returns.
4. Let the session expire → wall self-dismisses.
5. Confirm `tether:foregroundApp` fires for non-blocked apps too:
   ```bash
   adb logcat -s ReactNativeJS:V
   ```
   Add a temporary `console.log` in `src/state/widgetTrigger.ts` if needed —
   **remove it before committing**, that file belongs to Person 3.

The full end-to-end path at integration is:
**drag the snake → session starts → open Instagram → your wall appears → open
Canvas → Person 3's widget appears.**

If something breaks there, check the accessibility toggle **first**. It is disabled
by every reinstall and it is almost always the cause.
