# Agent Brief — Person 3 (Person C): Integrations

You are implementing the slice owned by **Person 3**, referred to throughout this
repository as **Person C**. Both names mean the same person: the code comments and
the README say "Person C", the team says "Person 3".

The project is Tether, an Android focus app. The repository already contains a
working skeleton — your job is to finish and harden one vertical slice of it, not
to build the app from scratch.

Read this entire document before writing code.

---

## 1. Mission

Tether blocks distracting apps during a focus session. **You own the other half of
that bargain:** surfacing the productivity tools the user *should* be looking at.

Concretely: a small floating card in the corner of the screen showing the user's
Canvas LMS todo list. It appears over other apps, not just inside Tether.

Your slice is what turns the product from "an app blocker" into "a focus system".
It is also the most extensible part — the plugin interface is designed so a second
integration (Notion, Todoist, Google Classroom) is a single new file.

The other two slices belong to **Person 1 (Person A)** — the snake and timer — and
**Person 2 (Person B)** — blocking. Their code already exists and works. You must
not modify it.

---

## 2. Non-negotiable constraints

| # | Constraint | Why |
|---|---|---|
| C1 | **Never set `newArchEnabled=true`** in `android/gradle.properties` | The overlay system uses `ReactRootView`, which does not exist in bridgeless mode. Every overlay silently renders nothing — no error, no crash, blank screen. |
| C2 | **Never clone into a path containing a space** | Gradle and the NDK fail in confusing ways. Use `~/code/tether` or `C:\dev\tether`. |
| C3 | **Never add a native dependency without checking its Kotlin version** | This project pins React Native 0.75.4 / Kotlin 1.9.24. Libraries using KSP fail with `org.jetbrains.kotlin.buildtools.api.SourcesChanges`. AsyncStorage was already removed for this reason. **Pure-JS dependencies are fine** — you are the only person who can safely add packages. |
| C4 | **No OAuth. Personal access token only.** | Canvas OAuth requires a developer key issued by the institution's Canvas admin. That is not happening during a hackathon. |
| C5 | **No backend server.** | Everything on-device. The token goes straight from the app to the Canvas API. |
| C6 | **Never log the access token** | It grants full API access to the user's account. Not in `console.log`, not in an error message, not in a crash report. |
| C7 | **Do not add a navigation or state-management library** | 13-hour hackathon. |

---

## 3. Repository orientation

### Files you OWN (edit freely)

```
src/integrations/types.ts              the plugin interface
src/integrations/registry.ts           registration + lookup
src/integrations/canvas.ts             Canvas API client
src/overlays/WidgetOverlay.tsx         the floating card
src/screens/IntegrationsScreen.tsx     host + token entry
src/state/useWidgetTrigger.ts          the Person 2 -> Person 3 seam
```

### Files you may READ but MUST NOT EDIT

```
android/.../blocking/*                       Person 2
android/.../core/FocusSessionStore.kt        Person 1
android/.../core/TetherService.kt            Person 1
android/.../modules/FocusModule.kt           Person 1
android/.../modules/BlockingModule.kt        Person 2
android/.../overlay/OverlayManager.kt        shared overlay host
src/overlays/SnakeOverlay.tsx                Person 1
src/overlays/BlockOverlay.tsx                Person 2
src/screens/BlocklistScreen.tsx              Person 2
src/state/useFocusSession.ts                 Person 1
```

### Files that are SHARED — coordinate before editing

```
src/native/index.ts        the typed contract. Adding is fine; changing an existing
                           signature breaks 1 and 2.
index.js                   AppRegistry registrations.
App.tsx                    tab shell — mounts useWidgetTrigger().
src/screens/HomeScreen.tsx contains the dev-simulate panel everyone uses.
```

---

## 4. The contract you must honour

### 4.1 What you CONSUME — `tether:foregroundApp` from Person 2

```ts
TetherEvents.onForegroundApp(({packageName, blocked}: {
  packageName: string;
  blocked: boolean;
}) => { ... })
```

Fires on **every** foreground app change, blocked or not. Returns a subscription —
**always `.remove()` in your `useEffect` cleanup** or you leak a listener on every
remount.

### 4.2 What you may READ — session state

```ts
Focus.getState(): Promise<FocusState>
TetherEvents.onTick(fn)            // {remainingMs, remainingMinutes}
TetherEvents.onSessionChanged(fn)  // full FocusState
useFocusSession()                  // React hook wrapping both
```

### 4.3 Your plugin interface — `src/integrations/types.ts`

```ts
export type TodoItem = {
  id: string;
  title: string;
  subtitle?: string;
  url?: string;
};

export type WidgetPayload =
  | {type: 'todoList'; items: TodoItem[]}
  | {type: 'text'; body: string};

export interface ProductivityIntegration {
  id: string;
  displayName: string;
  triggerPackages: string[];          // Android packages that surface this widget
  isConfigured(): Promise<boolean>;
  fetchWidgetData(): Promise<WidgetPayload>;
}
```

**Extend `WidgetPayload` as a union member, never by adding loose props.**
`WidgetOverlay` switches on `payload.type`; a new shape means a new arm.

### 4.4 Overlay + storage APIs (shared)

```ts
Overlay.show(name, options?, props?): Promise<boolean>  // show() on a visible overlay updates props
Overlay.setLayout(name, options): Promise<boolean>      // resize without remounting
Overlay.update(name, props): Promise<boolean>
Overlay.hide(name): Promise<boolean>

Storage.getCanvasHost() / setCanvasHost(host)
Storage.getCanvasToken() / setCanvasToken(token)
```

Your overlay is registered as `'WidgetOverlay'` in `index.js`.

---

## 5. How overlays actually work (read before touching WidgetOverlay)

`OverlayManager.kt` creates a `ReactRootView`, mounts a React component into it by
name, and adds it to `WindowManager` as a `TYPE_APPLICATION_OVERLAY` window. So
`Overlay.show('WidgetOverlay', …)` renders `src/overlays/WidgetOverlay.tsx` **on top
of the Canvas app**.

Consequences for your slice:

1. **The window swallows touches inside its bounds**, even where your React tree is
   transparent. Your card is 260×300dp at `topRight` — that is a real dead zone over
   whatever app is underneath. Keep it small and dismissible.
2. **The window has no Activity.** `Modal` and `Alert` will crash or no-op.
   `Linking.openURL` also needs care — see Task 5.
3. **`Overlay.show()` on a visible overlay updates props without remounting.** Use
   this to refresh data rather than hide-then-show, which flickers.
4. **`fetch` works normally inside an overlay** — same JS context, same network
   stack.

---

## 6. Current state — what already works

- `ProductivityIntegration` interface, `registry.ts` with lookup by id and by
  trigger package.
- `CanvasIntegration` calls `GET /api/v1/users/self/todo` with a Bearer token and
  maps the response to `TodoItem[]`.
- `WidgetOverlay` renders `todoList` and `text` payloads, with loading and error
  states, and a close button.
- `IntegrationsScreen` persists host + token and has a **Test widget** button.
- `useWidgetTrigger` listens for foreground events and shows the widget when a
  registered trigger package opens.

### Known bugs and weaknesses you must fix

| ID | Problem | Severity |
|---|---|---|
| **W1** | **The trigger listener lives in `App.tsx`.** If Android destroys `MainActivity` (which it does routinely once the user leaves the app), `App` unmounts, `useWidgetTrigger`'s `useEffect` cleanup runs, and the listener is gone. The widget then never appears over other apps — which is the *entire point* of the feature. | **Feature-breaking** |
| W2 | `fetchWidgetData` has no timeout. On a captive-portal or flaky venue WiFi the promise hangs forever and the widget shows a spinner permanently. | High |
| W3 | No caching. Every foreground event refetches, so switching apps repeatedly hammers the Canvas API and can get rate-limited mid-demo. | High |
| W4 | `FocusSessionStore.widgetTriggers` is populated by `syncTriggerPackages()` but **never read by native**. Dead code that implies a capability that does not exist. | Medium |
| W5 | The widget appears whenever Canvas opens, even with no session active. Arguably wrong: the pitch is that focus tools surface *during focus*. | Medium |
| W6 | No refresh or retry. A transient failure leaves a dead card until the user closes and reopens it. | Medium |
| W7 | The token is stored in plaintext `SharedPreferences`. Acceptable for a hackathon, but must not be logged (C6) and should be masked in the UI. | Low |
| W8 | `syncTriggerPackages()` is only called on save in `IntegrationsScreen`. On a fresh start it never runs. | Low |

---

## 7. Tasks

Do these **in order**. Each is independently shippable — commit after each.

---

### Task 0 — Baseline verification

```bash
npm install
npm run setup
npm start              # terminal 1
npm run android        # terminal 2
```

1. Get a Canvas token: Canvas → Account → Settings → **+ New Access Token**. Copy it
   immediately; it is shown only once.
2. Apps tab → enter host (`https://your-school.instructure.com`) and token → **Save**.
3. Tap **Test widget**. The card should appear with your real todos.

**If the card shows an error**, check in this order:
- Host has `https://` and no trailing path.
- Token pasted with no leading/trailing whitespace.
- `adb logcat -s ReactNativeJS:V` for the HTTP status. `401` = bad token,
  `404` = wrong host.

**Do not proceed until real Canvas data renders.** Everything else is styling on top
of a working fetch.

> **No Canvas account?** Add a temporary second integration returning a static
> `todoList` payload and develop against that. Keep `CanvasIntegration` as the
> shipped one. Delete the fake before final integration.

---

### Task 1 — Make the trigger survive activity destruction (W1)

**Goal:** the widget appears over other apps even after `MainActivity` is destroyed.

**Files:** `src/state/useWidgetTrigger.ts`, `index.js` (shared — coordinate)

**Root cause:** `useWidgetTrigger()` is mounted from `App.tsx`, which lives in the
main activity's React root. Leaving the app can destroy that activity, unmounting
`App` and removing the listener. The overlay roots are separate and stay mounted,
but nothing is listening any more.

**Implementation — Strategy A (recommended, pure JS):**

1. Move the subscription out of React entirely into a module-level singleton that
   is initialised once when the JS bundle loads:
   ```ts
   // src/state/widgetTrigger.ts
   let started = false;
   export function startWidgetTrigger() {
     if (started) return;
     started = true;
     TetherEvents.onForegroundApp(async ({packageName, blocked}) => { ... });
     // deliberately never removed -- lives for the life of the JS context
   }
   ```
2. Call `startWidgetTrigger()` from `index.js`, at module scope, **before**
   `AppRegistry.registerComponent`. The JS context outlives every activity, so the
   listener outlives them too.
3. Keep `useWidgetTrigger` as a thin no-op wrapper or delete its usage from
   `App.tsx` — but **tell Person 1 and 2** if you touch `App.tsx` or `index.js`.

The foreground service (Person 1) keeps the process alive, so the JS context
persists. That is what makes this work.

**Acceptance:**
```bash
adb shell am kill com.tether   # does NOT work -- foreground service restarts it
```
Instead test properly:
1. Open Tether, then press Home.
2. Open Recents and swipe Tether away (destroys the activity, keeps the service).
3. Open the Canvas app.
4. **The widget must still appear.** With the bug present it will not.

---

### Task 2 — Network timeout and error recovery (W2, W6)

**Goal:** never show an infinite spinner.

**File:** `src/integrations/canvas.ts`, `src/overlays/WidgetOverlay.tsx`

1. Add a timeout using `AbortController` — built in, no dependency:
   ```ts
   const controller = new AbortController();
   const timer = setTimeout(() => controller.abort(), 8000);
   try {
     const res = await fetch(url, {headers, signal: controller.signal});
     ...
   } finally {
     clearTimeout(timer);
   }
   ```
2. Map failures to messages a human can act on. Do **not** surface raw exceptions,
   and never include the token (C6):
   - `401` / `403` → "Token rejected. Generate a new one in Canvas settings."
   - `404` → "Canvas host not found. Check the URL in Settings."
   - `AbortError` → "Canvas timed out. Check your connection."
   - anything else → "Could not reach Canvas."
3. Add a **Retry** button to the error state in `WidgetOverlay`.
4. Add a small **Refresh** control to the success state.

**Acceptance:**
- Enable airplane mode, open the widget → a clear error within ~8s, plus Retry.
- Retry works after re-enabling the network, with no reopen needed.
- Corrupt the token → the message names the token, not a stack trace.
- `adb logcat | grep -i <first 6 chars of your token>` returns **nothing**.

---

### Task 3 — Cache results (W3)

**Goal:** switching apps must not refetch every time.

**File:** `src/integrations/canvas.ts` or a small `src/integrations/cache.ts`

1. Module-level cache keyed by integration id:
   ```ts
   type Entry = {at: number; payload: WidgetPayload};
   const cache = new Map<string, Entry>();
   const TTL_MS = 5 * 60 * 1000;
   ```
2. Serve cached data immediately if fresh; otherwise fetch.
3. Stale-while-revalidate is better if time allows: render stale data at once, fetch
   in the background, update via `Overlay.update('WidgetOverlay', …)`.
4. Bypass the cache on explicit Refresh (Task 2).

**Acceptance:**
- Switch away from Canvas and back five times → exactly one network request.
  Verify by counting requests in `adb logcat -s ReactNativeJS:V` with a temporary
  log at the fetch site (remove it before committing).
- Refresh always hits the network.

---

### Task 4 — Decide and enforce when the widget shows (W5, W4, W8)

**Goal:** a defensible rule, implemented consistently.

**Files:** `src/state/widgetTrigger.ts` (from Task 1), `registry.ts`

1. **Pick one rule and write it in a comment at the top of the trigger file.**
   Recommended: *show when a trigger package opens **and** a session is active.*
   That matches the product pitch — focus tools during focus. Check
   `(await Focus.getState()).isActive`.
2. Hide the widget when the session ends: subscribe to `onSessionChanged` and call
   `Overlay.hide('WidgetOverlay')` when `isActive` goes false.
3. Fix W8 — call `syncTriggerPackages()` at startup, not only on save.
4. Resolve W4: `FocusSessionStore.widgetTriggers` is written but never read by
   native. Either leave `syncTriggerPackages()` as forward-compatible plumbing and
   **add a comment saying so**, or stop calling it. Do not leave it looking like it
   does something it does not.

**Acceptance:**
- No session → open Canvas → no widget (if you chose the recommended rule).
- Active session → open Canvas → widget appears.
- Session ends while the widget is open → it disappears.
- The rule is documented in a comment.

---

### Task 5 — Widget polish

1. **Make it draggable** with `PanResponder` + `Overlay.setLayout()` so it can be
   moved off content it covers. `setLayout` does not remount, so state survives.
   If short on time, instead make it **collapse to a small pill** on tap.
2. **Tapping a todo opens it in Canvas.** `Linking.openURL(item.url)` from an
   overlay has no Activity context — if it fails, add a `BlockingModule`-style
   native opener, or **drop this feature**. It is not worth an hour.
3. **Empty state**: "Nothing due. Go focus." already exists — make sure it renders
   when `items.length === 0` and is visually distinct from the error state.
4. **Cap the list** to ~6 items. It is a glanceable card, not an inbox.

**Acceptance:**
- The widget does not permanently cover content the user needs.
- Empty, loading, error and populated states are all visually distinct.

---

### Task 6 — Prove extensibility

**Goal:** demonstrate the plugin architecture is real, not aspirational.

1. Add a second integration in a new file — something with no auth, so it always
   works on stage. A static "Study streak" or a hardcoded class schedule is fine.
2. Register it in `registry.ts`. **That must be the only change outside the new
   file.** If you need to touch `WidgetOverlay` or the interface, the abstraction is
   wrong — fix the abstraction.
3. Give it a different `triggerPackages` entry so both can be demoed.

**Acceptance:** adding the integration required exactly one new file plus one line
in `registry.ts`. This is a strong thing to say out loud during the demo.

---

## 8. Build, run, verify

```bash
npm start                    # Metro. Leave running.
npm run android              # build + install + launch
```

**Your slice is almost entirely JavaScript**, so Metro reload (shake, or press R
twice) is usually enough. You only need a full `npm run android` if you touch
Kotlin — which for your tasks you should not need to at all.

```bash
# Logs -- your primary tool
adb logcat -s ReactNativeJS:V OverlayManager:V ReactNative:E

# Confirm the Canvas app's real package name
adb shell pm list packages | grep -i instructure

# Test the Canvas API outside the app first -- isolates network from app bugs
curl -H "Authorization: Bearer <TOKEN>" https://<host>/api/v1/users/self/todo

# Typecheck before every commit
npx tsc --noEmit
```

> Run that `curl` **before** debugging any app-side fetch problem. It separates
> "the API/token is wrong" from "my code is wrong" in ten seconds. Do not paste the
> token into a shared terminal or a commit.

---

## 9. Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Widget never appears over other apps | W1 — listener died with the activity | Task 1 |
| Widget never appears at all | Accessibility service off, so no foreground events | Person 2's slice — check `adb shell settings get secure enabled_accessibility_services` |
| Widget appears only inside Tether | Same as W1 | Task 1 |
| Infinite spinner | No fetch timeout | Task 2 |
| `401` from Canvas | Bad or expired token | Regenerate in Canvas settings |
| `404` from Canvas | Wrong host, or a path in the host field | Host only: `https://school.instructure.com` |
| Network request fails only on device | Venue WiFi captive portal | Test with `curl` from the same network |
| Widget renders blank | Component not registered in `index.js`, or name typo | Names must match exactly |
| All overlays blank after a config change | `newArchEnabled=true` | Set back to `false` (C1) |
| Widget covers something important | Fixed 260×300dp window | Task 5 |
| Build fails with `SourcesChanges` | A dependency needs newer Kotlin | Remove it (C3) — pure-JS deps are safe |

---

## 10. Definition of done

- [ ] Real Canvas todos render on a physical device (Task 0)
- [ ] Widget appears over other apps after the activity is destroyed (Task 1)
- [ ] Fetch times out in 8s with an actionable message and a Retry (Task 2)
- [ ] Repeat app switches produce one network request, not many (Task 3)
- [ ] The show/hide rule is implemented and documented (Task 4)
- [ ] All four widget states are visually distinct (Task 5)
- [ ] A second integration exists, added via one file + one line (Task 6)
- [ ] The token appears in no log, error message, or commit
- [ ] `npx tsc --noEmit` exits 0
- [ ] No files outside the "own" list in §3 were modified, except `index.js` for
      Task 1 — which Persons 1 and 2 were told about

---

## 11. Anti-goals

- **Do not implement OAuth** (C4). It needs an institutional developer key.
- **Do not add a backend** (C5). No proxy, no token relay, no serverless function.
- Do not add a heavy data-fetching library (React Query, SWR, Apollo). A `Map` and
  a `fetch` cover this. You may add small pure-JS packages, but ask whether the
  built-in does it first.
- Do not build a settings framework. Two text inputs are enough.
- Do not scrape Canvas HTML. Use the documented REST API.
- Do not write tests. No infrastructure, no time.
- Do not refactor `OverlayManager.kt` — shared with Persons 1 and 2.
- Do not remove the **Dev · simulate** panel in `HomeScreen.tsx` until final
  integration.
- Do not commit a real token, even in a comment or an example. If you do, revoke it
  in Canvas immediately — the repo is public.

---

## 12. Integration protocol

Integrate with Persons 1 and 2 in the **last 2–3 hours**, not continuously.

Until then you are the **least blocked** person on the team — your slice is almost
pure JS and testable without the other two:
- **Show Canvas widget** on the Focus tab renders your overlay with no accessibility
  service and no session.
- **Test widget** on the Apps tab does the same after saving credentials.

Verify your slice alone before integrating:
1. Save host + token, tap **Test widget** → real todos.
2. Airplane mode → clear error + Retry.
3. Re-enable network → Retry succeeds.
4. Swipe the app from Recents, open Canvas → widget still appears (Task 1).

The full end-to-end path at integration is:
**drag the snake → session starts → open Instagram → block wall appears → open
Canvas → your widget appears.**

If your widget does not appear during integration, the cause is usually **not** your
code: it is Person 2's accessibility service being disabled by the last reinstall.
Check that first:

```bash
adb shell settings get secure enabled_accessibility_services
```
