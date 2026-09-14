# Tether

Drag a snake down from the top of the screen to set a focus timer. While the timer
runs, distracting apps are blocked and productivity widgets (Canvas first) float in
the corner.

**Android only.** React Native + a thin Kotlin layer.

---

## Read this first: why there is Kotlin in a React Native project

React Native **cannot** do the two things this app is built around:

| Feature | Why JS can't do it |
|---|---|
| Floating UI over *other apps* | Needs `WindowManager` + `SYSTEM_ALERT_WINDOW`. No JS API exists. |
| Knowing which app is in the foreground | Needs an `AccessibilityService`. No JS API exists. |

So the Kotlin layer is not optional and not a "native module we might extract later" —
it is the product. What we *did* do is make it thin, so **all three overlays are
normal React components**, not hand-drawn Kotlin canvas code.

`OverlayManager.kt` mounts a `ReactRootView` into a floating system window. That means:

```js
Overlay.show('SnakeOverlay', {height: 420, gravity: 'top'})
```

...renders `src/overlays/SnakeOverlay.tsx` on top of Instagram. You write React; the
Kotlin just supplies the window.

### Two things that will break the build if you change them

1. **Do not enable the new architecture.** `android/gradle.properties` has
   `newArchEnabled=false`. `ReactRootView` — the whole overlay mechanism — does not
   exist in bridgeless mode. If you flip this, every overlay silently renders nothing.
2. **Do not clone into a path containing a space.** Gradle and the NDK are unreliable
   with spaces. `~/code/tether` is fine; `~/my projects/tether` is not.

---

## Setup

The team is split across macOS and Windows. The steps are the same on both; the
differences are called out below.

**Everyone needs:** Node 18+, JDK 17+, Android Studio (open it once so it downloads
the SDK), and a **physical Android phone**. Overlay and accessibility permissions are
miserable on emulators and the demo is a phone demo.

```bash
git clone git@github.com:saurab200/snake-xoxo.git tether
cd tether
npm install
npm run setup      # writes android/local.properties for YOUR machine
npm start          # terminal 1: Metro
npm run android    # terminal 2: build + install
```

`npm run setup` finds your SDK automatically (`~/Library/Android/sdk` on macOS,
`%LOCALAPPDATA%\Android\Sdk` on Windows) and writes `android/local.properties`.
That file is gitignored on purpose — it is the one file that must differ per machine.
Never commit it.

### Clone into a path with no spaces

`~/code/tether` or `C:\dev\tether` — good.
`~/my projects/tether` or `C:\Users\me\OneDrive\My Stuff\tether` — Gradle breaks
in confusing ways.

**Windows people:** avoid cloning into a OneDrive- or Dropbox-synced folder. The
sync client locks files mid-build and Gradle fails with permission errors that look
like compiler bugs.

### Windows specifics

- Use **PowerShell** or Git Bash, not `cmd.exe`.
- Your phone needs an OEM USB driver before `adb` will see it. Install Android
  Studio's "Google USB Driver" (SDK Manager → SDK Tools), plug the phone in with
  USB debugging on, then confirm with `adb devices` — if it prints `unauthorized`,
  accept the prompt on the phone screen.
- If `npm run android` cannot find a JDK, set `JAVA_HOME` to the JDK that ships with
  Android Studio: `C:\Program Files\Android\Android Studio\jbr`.

### Line endings

`.gitattributes` forces LF in the repo. Do not override it. Without it, Windows
commits CRLF and `android/gradlew` then fails on macOS with
`bad interpreter: /bin/sh^M`. If you hit that after a bad merge:

```bash
git rm --cached -r . && git reset --hard
```

---


## The shared contract

Agree on this before splitting up. It is defined in exactly two places, which must
stay in sync:

- `android/app/src/main/java/com/tether/core/FocusSessionStore.kt`
- `src/native/index.ts`

```ts
type FocusState = {
  isActive: boolean;
  durationMinutes: number;
  endAtMs: number;          // wall clock ms
  remainingMs: number;
  remainingMinutes: number;
};
```

`FocusSessionStore` is a Kotlin `object` — a singleton for the whole process, which
includes the AccessibilityService. **The blocklist check reads it directly, with no
bridge hop.** Never route a blocking decision through JS: the bridge is too slow and
the JS thread may be asleep.

Events flowing the other way (`src/native/index.ts`):

| Event | Emitted by | Consumed by |
|---|---|---|
| `tether:tick` | Person A's service, 1/s | Anyone showing a countdown |
| `tether:session` | Person A | Everyone |
| `tether:foregroundApp` | Person B | Person C (widget triggers) |

---

## Who owns what

Every file below has exactly one owner. Touch someone else's file only to fix a build.

If you are handing your slice to an AI coding agent, give it the matching brief in
[`docs/`](docs/) — it contains the full contract, task list, verification commands and
failure modes.

- Person A → [`docs/PERSON-A-AGENT-BRIEF.md`](docs/PERSON-A-AGENT-BRIEF.md)

### Person A — Interaction & timer
```
src/overlays/SnakeOverlay.tsx                          drag -> duration, the demo hook
android/.../core/TetherService.kt                      foreground service + countdown
android/.../core/FocusSessionStore.kt                  the shared contract
android/.../modules/FocusModule.kt                     JS bridge
```
Tuning knobs are at the top of `SnakeOverlay.tsx`: `MINUTES_PER_DP`, `MIN_MINUTES`,
`MAX_MINUTES`, `MAX_DRAG_DP`. The feel of the whole product lives in those four numbers.

**Produces:** `FocusSession.isActive` + duration.

### Person B — Blocking engine
```
android/.../blocking/TetherAccessibilityService.kt      foreground app detection
android/.../blocking/AppList.kt                         installed apps + defaults
android/.../modules/BlockingModule.kt                   JS bridge
src/overlays/BlockOverlay.tsx                           the "you're blocked" screen
src/screens/BlocklistScreen.tsx                         pick which apps to block
```
**Consumes:** `FocusSessionStore.isActive`.
**Produces:** `tether:foregroundApp` events.

### Person C — Integrations
```
src/integrations/types.ts                               plugin interface
src/integrations/registry.ts                            add integrations here
src/integrations/canvas.ts                              Canvas API client
src/overlays/WidgetOverlay.tsx                          the floating card
src/screens/IntegrationsScreen.tsx                      paste host + token
src/state/useWidgetTrigger.ts                           the B -> C seam
```
**Consumes:** `tether:foregroundApp`.

Adding a second integration = write one object implementing `ProductivityIntegration`,
add it to the array in `registry.ts`. Nothing else changes.

---

## Do not block on each other

The **Dev · simulate** section on the Focus tab exists so nobody waits:

- **Person B** — tap *Start 1 min* to get a real active session without A's snake.
- **Person C** — tap *Show Canvas widget* to render the widget without B's
  accessibility service.
- **Person B** — tap *Show block overlay* to style the block screen with no session.

Delete that section once the real path works end to end.

**Integrate in the last 2–3 hours, not continuously.**

---

## Build order

| Hours | Work |
|---|---|
| 0–2 | Everyone: get the app installed, permissions granted, `Start 1 min` working |
| 2–5 | A: snake drag feel · B: accessibility detection logs the right package · C: Canvas fetch returns real todos |
| 5–8 | A: polish · B: block overlay fires on a real app · C: widget renders real data |
| 8–11 | Blocklist + integrations screens |
| 11–13 | **Integration** — snake → session → block → widget in one run |
| Last | Polish, demo script, **record a backup video** |

---

## Demo risks (all of them have bitten people on stage)

1. **Accessibility service silently dies.** Android disables it after a force-stop or
   a reinstall. Re-check the toggle right before demoing. This is the #1 failure.
2. **Debug builds need Metro.** If your laptop's WiFi drops, the app is a white screen.
   Build a release APK for the actual demo:
   `cd android && ./gradlew assembleRelease`
3. **Battery optimisation kills the service.** Settings → Apps → Tether → Battery →
   Unrestricted.
4. **Overlays do not appear over some system screens.** Demo over a normal app
   (Instagram, Chrome), never over Settings.
5. **Record a backup video.** Seriously.

---

## Cut list

Already cut, on purpose: iOS, OAuth, any backend, AsyncStorage (replaced by a 30-line
native `SharedPreferences` module so the blocklist survives a cold start), navigation
library, state management library, tests.

If you fall behind, cut in this order: the blocklist screen (hardcode 3 packages in
`AppList.SUGGESTED_BLOCKLIST`), then the integrations screen (hardcode the token), then
the widget entirely. Never cut the snake — it is the only thing judges will remember.
