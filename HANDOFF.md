# Tether — Handoff

State of the project on **`feature/taskui`**. Written for whoever picks this up next.

Read [README.md](README.md) for setup. This file is what the README cannot tell
you: what actually works, where the sharp edges are, and which decisions you
should not undo.

---

## 1. What it is

A focus app. A green snake lives in the top bezel of the screen. Pull its tail
down; how far you pull sets the session length. During a session the apps you
have blocked **disappear from the launcher entirely**, and a task card shows what
you should be doing instead.

Android only. React Native 0.75.4 + a Kotlin layer. 20 Kotlin files, 6 native
modules, 6 overlays.

**Work on `feature/taskui`** — it is the only branch with all four slices.
`main` does not have the gamification merge. See SESSION-HANDOFF.md §3.

---

## 2. Status at a glance

| Area | State |
|---|---|
| Snake: bezel rest, pull, coil, crawl home | Working, verified on emulator |
| Session timer + foreground service | Working, survives reboot and force-stop |
| Blocking via accessibility service | Working |
| Vanish mode (apps disappear) | Working, needs Device Owner |
| Reminders → total lockout | Working |
| Task card | Working; only 1 of 3 tabs wired |
| Integrations catalogue | Working; only Canvas is real |
| Canvas API | **Never tested against a live instance** |
| Kill switch (✕) | Working, verified — stops the session, leaves the snake |
| Gamification: points, skins, leaderboard | Working, verified after the merge |
| Haptics | **Unverified** — emulator has no vibrator |

Everything marked "verified" was checked by running it on an emulator and reading
the result, not by assuming a build implies behaviour.

---

## 3. Six decisions not to undo

These look like things worth tidying. They are not.

### `newArchEnabled=false` must stay

The overlay system mounts a `ReactRootView` into a `WindowManager` window. That
is what lets all six overlays be ordinary React components instead of hand-drawn
Kotlin. `ReactRootView` **does not exist** under the New Architecture. Flip this
flag and every overlay renders nothing — silently. No crash, no error, blank
windows.

This also rules out a straight move to Expo; see the note at the end of §7.

### Blocking decisions never cross the JS bridge

`FocusSessionStore` is a Kotlin `object`, so it is a singleton across the whole
process **including the AccessibilityService**. `isBlocked(pkg)` is an in-memory
check in under a millisecond. Move session state into JS and blocking breaks: the
bridge is too slow and the JS thread may be asleep.

### Reminders fire from the 1-second ticker, not AlarmManager

Exact alarms need `SCHEDULE_EXACT_ALARM` on Android 12+, a restricted permission
with a Play policy attached. The foreground service already ticks every second.

The trade-off, which is fine: **a reminder only fires while the service is
alive.** A lockout is meaningless if Tether is not running anyway.

### No AsyncStorage

Its current release needs a newer Kotlin than RN 0.75 ships and fails with
`org.jetbrains.kotlin.buildtools.api.SourcesChanges`. It was replaced by a ~30
line `SharedPreferences` module, which is also strictly better here: the
accessibility service can read the blocklist at boot, before any JS has run.

**Check every native dependency's Kotlin version before adding it.** Pure-JS
packages are safe.

### Overlay resizes that happen "later" are timed in Kotlin

`Overlay.setLayoutAfter(name, config, ms)` exists because `setTimeout` does not
work for this. See §10 for the full story; the short version is that the
overlays are on screen precisely when Tether is backgrounded, and in that state
RN delivers neither JS timer callbacks nor the completion callbacks of
native-driver animations. Anything that must happen when an animation ends has
to be timed by a native `Handler`.

### Do not clone into a path with a space

Gradle and the NDK fail in confusing ways. `~/code/tether` is fine.

---

## 4. Architecture, in the order things happen

```
BOOT / app launch
  └─ BootReceiver (if armed) ─► TetherService
       ├─ Prefs.hydrate()        restore session + blocklist from disk
       ├─ RNBridge.ensureContext()  loads the JS bundle (no activity on boot)
       └─ 1s ticker ─► countdown, reminders, lockout expiry, AppHider.sync

index.js (module scope, outlives every activity)
  ├─ startSnake()          pins the snake; hides it while Tether is foreground
  └─ startWidgetTrigger()  foreground-app events + task card on session start

PULL THE TAIL
  └─ SnakeOverlay ─► Focus.startSession(minutes, blocklist)
       ├─ FocusSessionStore.start()   + persisted to Prefs
       ├─ AppHider.sync()             blocked apps vanish (Device Owner)
       └─ ~3.8s later ─► TaskCardOverlay slides up

OPEN A BLOCKED APP
  └─ TetherAccessibilityService.onAccessibilityEvent
       ├─ FocusSessionStore.isBlocked(pkg)   direct, no bridge
       └─ BlockOverlay (+ closes the app during a lockout)
```

### Why so much lives at module scope

Android destroys `MainActivity` routinely. Anything mounted from `App.tsx` dies
with it. The snake and the foreground-app listener both used to live there and
both silently stopped working once the user left the app. They now start from
`index.js` at module scope, which the JS context — kept alive by the foreground
service — outlives.

If you add something that must survive the user leaving the app, put it there.

---

## 5. Known limitations — read before demoing

Two kill-switch bugs that used to live here were fixed in `0c439a4`; the detail
is kept in §10 because the shape of both will recur.

### Vanish mode loses home-screen shortcuts

Hiding a package makes the launcher drop it from the saved home-screen layout.
Unhiding restores the app to the drawer but nothing puts the shortcut back. Block
Instagram a few times and it quietly stops living where the user put it.

Not our bug — it is how launchers react to a package disappearing — but it makes
vanish mode mildly destructive to a layout someone chose.

### A Device Owner app cannot be force-stopped

`adb shell am force-stop com.tether` has no effect once provisioned. To release
it:

```bash
adb shell dpm remove-active-admin com.tether/com.tether.admin.TetherDeviceAdmin
```

### Two task-card tabs are inert

By design, for now. Canvas exposes announcements and graded work, so both are a
connector method away. They render but do nothing.

---

## 6. Setup gotchas that will cost you an hour each

**Android disables the accessibility service on every reinstall.** This is the
single most common cause of "blocking just stopped working". The Blocked tab
shows a red banner when it happens.

**`adb uninstall` wipes SharedPreferences**, so the blocklist resets to defaults.
`adb install -r` preserves it.

**Enabling accessibility over adb only sticks if the app is running.** Android
clears `enabled_accessibility_services` if the target package is stopped when you
write it, or if you force-stop afterwards. Start the app first, then grant.
`./scripts/emulator.sh grant` does this in the right order.

**Kotlin changes need a full rebuild.** Metro reload will not pick them up. If
you edit anything under `android/`, run `npm run android`.

**Boot the emulator with `-gpu host`.** The software rasteriser costs ~23ms per
frame just to draw, which alone blows the 16.7ms budget and makes every animation
look broken regardless of the code. `scripts/emulator.sh` already does this.

---

## 7. Where to pick up

`docs/BACKLOG.md` has the deferred items with context. The short version:

1. **Test Canvas against a real instance.** The client has never run against live
   Canvas — only the error paths and the shape of the response have been
   reasoned about. This is the highest-value unknown in the codebase.
2. **Tune the snake's feel on hardware.** `MINUTES_PER_DP`, the spring
   `tension`/`friction`, `COIL_HOLD_MS`, `CRAWL_HOME_MS` — all picked blind.
   Haptics have never actually been felt.
3. **Warn before enabling vanish mode**, given the shortcut loss above.

### Per-slice agent briefs

`docs/PERSON-{A,B,C,D}-AGENT-BRIEF.md` are self-contained specs written to hand
to an AI coding agent — constraints, file ownership, the cross-person contract,
ordered tasks with acceptance criteria, `adb` commands and failure modes. Persons
A/B/C are implemented; D (gamification) is not started.

### On Expo

Expo Go can never run this — the two core features are custom native modules it
does not contain. A development build is technically possible but collides with
`newArchEnabled=false` (§3): recent Expo SDKs default the New Architecture on.
Migrating means porting all six overlays off `ReactRootView` first. Not worth it
unless this becomes a product.

---

## 8. Demo script

Pre-flight, in this order — the first two reset on every reinstall:

```bash
./scripts/emulator.sh boot
./scripts/emulator.sh install          # builds, installs, grants permissions
adb shell dpm set-device-owner com.tether/com.tether.admin.TetherDeviceAdmin
```

Then:

1. **Home screen** — the snake's tail hangs from the bezel. Small, ignorable.
2. **Pull the tail down** — it uncoils, the duration climbs with the pull.
   Release around 45 min.
3. It coils, holds, and **crawls back into the bezel**. A timer pill and a `+`
   appear beside it.
4. **The task card slides up** — what you owe, grouped by due date.
5. **Open YouTube** — the icon is *gone from the launcher*. Not blocked: absent.
6. **Tap the ✕ twice** — everything stops.

Record a backup video. Accessibility permissions are flaky live, and a Device
Owner app cannot be force-stopped if something goes wrong on stage.

---

## 9. Naming

"Tether" came from the original spec doc (`snake.md`), not from a deliberate
choice. It collides with Android's own "tethering" — there are two system
packages and an APEX module using the word, so `adb logcat | grep -i tether`
returns system noise. Use `grep "com.tether"`.

Renaming touches `applicationId`, `namespace`, 20 Kotlin package declarations,
the accessibility `SERVICE_ID`, the Device Owner component name, the emulator
script and all four briefs — and invalidates the Device Owner provisioning. Cheap
after the demo, expensive during it.

---

## 10. Two bugs worth learning from

Both were in the kill switch — the one control that has to work when everything
else has gone wrong. Both are fixed; the shape of them will recur.

### Unmounting the component that is running your handler

`stopEverything()` called `Overlay.hideAll()` and then `Focus.disarm()`.
`hideAll` tears down every overlay including the kill switch itself, so the
handler's own React root was unmounted mid-await and `disarm()` never ran. The
symptom was subtle: the overlays vanished, so it *looked* like it worked, while
the foreground service kept running.

`disarm()` runs first now. It stops the service, whose `onDestroy` removes the
overlays natively, so nothing depends on the component still existing.

**The general shape:** if an async handler tears down its own UI, everything
after that line is on borrowed time. Do the durable work first.

### A flag nothing consulted — then the flag itself turned out to be wrong

The ✕ set `armed = false` in Prefs, and `BootReceiver` honoured it — but
`startSnake()` called `Focus.arm()` unconditionally on every process start. The
accessibility service revives the process constantly, so "stop everything" undid
itself within seconds. The fix was to make `showSnake()` read the flag too.

**The general shape:** a flag is only as good as the number of places that read
it. This one had one writer and one reader, and the third path ignored it.

The sequel is the more useful lesson. Once the flag worked, the behaviour it
bought was wrong: the ✕ took the snake off the screen, and it only came back via
a button buried in the Focus tab. The snake is the app's entire surface. Making
the panic button able to remove it meant one stray double-tap looked exactly
like an uninstall.

So the flag is gone again — deliberately, not by regression. See §11.

### The animation finished, but nothing was told about it

The snake's drag window is 170x440dp, grown on touch-down so a full pull is not
clipped. After the release it has to shrink back to 96x64dp (idle) or 320x104dp
(session). That shrink was driven by the completion callback of the crawl-home
animation, with a `setTimeout` as a backstop.

Neither ever ran. The window stayed at its full drag size from the first pull
onward, forever, across sessions and reboots — a 170x440dp invisible slab over
the launcher, with the `+` pill clipped off its right edge.

**Why:** the overlay is on screen exactly when Tether is *backgrounded*. In that
state React Native delivers neither JS timer callbacks nor the completion
callbacks of `useNativeDriver` animations. The animation itself runs — you can
watch the snake crawl home — but nothing downstream of it fires. A previous fix
in this same function blamed driver mixing for an identical symptom; that was
the same cause wearing a different hat.

The fix is `Overlay.setLayoutAfter`, which schedules the resize on the service's
own `Handler`. JS states the intent immediately and native owns the clock. A
later `setLayout`, `setLayoutAfter` or `hide` on the same overlay cancels a
pending one, so a new pull cannot be shrunk out from under itself.

**The general shape:** in this app, "background" is the normal case, not the
edge case. Before relying on any callback, ask whether it is delivered when no
activity exists. Native events (the 1s ticker) and native handlers are; JS
timers and animation callbacks are not.

Worth knowing: the earlier "timer pill sits too low on screen" bug was this bug.
It was treated as a layout problem and patched with a 30dp inset, which made the
pills look right inside the stuck 440dp window. Both the inset and the stuck
window are gone now.

---

## 11. The snake is permanent

The snake is on screen from install onward. It is not a session artefact and
nothing in the normal running of the app takes it away.

That means three things in the code, and all three have to agree:

- `showSnake()` in `src/state/bootstrap.ts` has **no armed gate**. It pins the
  snake on every process start and calls `Focus.arm()` (idempotent) to make sure
  the foreground service the overlay depends on is up.
- `BootReceiver` starts `TetherService` on `BOOT_COMPLETED` **unconditionally**.
- `stopEverything()` in `KillSwitchOverlay` stops the session and any lockout and
  hides only the transient overlays — `BlockOverlay`, `TaskCardOverlay`,
  `WidgetOverlay`, `ReminderOverlay`. It does **not** hide `SnakeOverlay`, does
  not hide itself, and does not call `Focus.disarm()`. The button says *Stop
  session*, which is what it does.

The one thing that still hides the snake is Tether being in the foreground — the
`AppState` listener in `bootstrap.ts` pulls it, the ✕ and the task card down while
you are looking at the app itself, and puts them back when you leave. That is
intentional: the overlay would otherwise sit on top of the app's own UI.

**If you are tempted to let something remove the snake, don't.** There is no
in-app path back to it any more, because there is no longer meant to be a state
it can be missing from.
