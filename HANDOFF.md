# Medusa — Handoff

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
| Snake: bezel rest, pull, settled poses | Working, verified on emulator |
| Session timer + foreground service | Working, survives reboot and force-stop |
| Blocking via accessibility service | Working |
| Vanish mode (apps disappear) | Working, needs Device Owner |
| Reminders → total lockout | Working |
| Task panel (right edge, minimisable) | Working, verified |
| Tick a task -> XP, row disappears | Working, verified |
| XP bar pinned to the bezel | Working, verified across a reboot |
| Integrations catalogue | Working; only Canvas is real |
| Canvas API | **Never tested against a live instance** |
| Kill switch (✕) | Working, verified — stops the session, leaves the snake |
| Gamification: points, skins, leaderboard | Working, verified after the merge |
| Reward card on session completion | Merged from develop |
| Level pill + progress on the Focus tab | Merged from develop |
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
alive.** A lockout is meaningless if Medusa is not running anyway.

### No AsyncStorage

Its current release needs a newer Kotlin than RN 0.75 ships and fails with
`org.jetbrains.kotlin.buildtools.api.SourcesChanges`. It was replaced by a ~30
line `SharedPreferences` module, which is also strictly better here: the
accessibility service can read the blocklist at boot, before any JS has run.

**Check every native dependency's Kotlin version before adding it.** Pure-JS
packages are safe.

### Overlay resizes that happen "later" are timed in Kotlin

`Overlay.showAfter(name, config, props, ms)` exists because `setTimeout` does not
work for this. (`Overlay.setLayoutAfter` is its sibling for deferred resizes. It
currently has no caller -- every resize turned out to be immediate once the
snake stopped waiting on an animation -- but it is kept as the other half of the
same rule.) See §10 for the
full story; the short version is that the overlays are on screen precisely when
Medusa is backgrounded, and in that state RN delivers neither JS timer callbacks
nor the completion callbacks of native-driver animations. Anything that must
happen after a delay, or when an animation ends, has to be timed by a native
`Handler`.

The same rule used to kill two tempting bits of UI polish -- an XP bar that
tweens its fill, and a "+10 XP" toast that fades out -- because both would freeze
part-way. **The way to have them is the same rule applied harder: put the clock
in Kotlin too.** `NativeClock` (`core/NativeClock.kt`, `Clock.start` in
`src/native`) emits ~30 progress events a second for a bounded duration; JS
subscribes and re-renders, and every render still paints a finished state. Motion
that is native-timed and JS-painted works backgrounded; motion that is
JS-timed does not, whatever draws it. The task tick's XP flight is built on this
-- see §12.

### Do not clone into a path with a space

Gradle and the NDK fail in confusing ways. `~/code/tether` is fine.

---

## 4. Architecture, in the order things happen

```
BOOT / app launch
  └─ BootReceiver ─► TetherService
       ├─ Prefs.hydrate()        restore session + blocklist from disk
       ├─ RNBridge.ensureContext()  loads the JS bundle (no activity on boot)
       └─ 1s ticker ─► countdown, reminders, lockout expiry, AppHider.sync

index.js (module scope, outlives every activity)
  ├─ initializeGamification()  hydrates points; installs the award listener
  ├─ startSnake()              pins the snake, the XP bar and the X;
  │                            hides them while Medusa is foreground
  └─ startWidgetTrigger()      foreground-app events + task panel on session start

PULL THE TAIL
  └─ SnakeOverlay ─► Focus.startSession(minutes, blocklist)
       ├─ FocusSessionStore.start()   + persisted to Prefs
       ├─ AppHider.sync()             blocked apps vanish (Device Owner)
       └─ Overlay.showAfter(3.8s) ─► TaskCardOverlay, timed in Kotlin

TICK A TASK OFF / FINISH A SESSION
  └─ gamificationStore.totalPoints
       ├─ XpBarOverlay      fills toward the next level (25 XP)
       └─ LeaderboardScreen ranks on the same number

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

### The task panel is a dead zone for touches

An overlay window receives every touch inside its own bounds. Taps that no React
component handles are dropped, not forwarded to the app underneath -- so while
the panel is open, the right-hand strip of the screen does not respond to the
launcher. `touchThrough` only covers touches *outside* the window.

This is why the panel is 286x430dp rather than full height, and why **›**
minimises to a 54dp handle instead of merely being a nicety. There is no flag
that fixes it; the mitigation is to keep the window small.

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

### The task panel has no announcements tab

The old three-tab bar had two inert tabs. The panel now has two working ones --
To do and Done, the latter backed by `completedTaskIds` in the gamification
store. Announcements were dropped rather than shipped dead: Canvas exposes them,
so re-adding is a connector method plus a tab.

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
   `tension`/`friction`, `COMMIT_THRESHOLD_DP` — all picked blind.
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
3. Let go: **the head pops up into the XP bar**, with a timer pill and a `+`
   beside it.
4. **The task panel appears on the right** — what you owe, grouped by due date.
5. **Tick something off** — the row goes and the bar at the top of the screen
   fills. Tap **›** to minimise the panel to an edge handle.
6. **Open YouTube** — the icon is *gone from the launcher*. Not blocked: absent.
7. **Tap the ✕ twice** — the session stops and the apps come back. The snake and
   the XP bar stay: they are permanent.

Record a backup video. Accessibility permissions are flaky live, and a Device
Owner app cannot be force-stopped if something goes wrong on stage.

---

## 9. Naming

The app is **Medusa** to the user and `com.tether` to Android. That split is
deliberate, and the second half of it is load-bearing.

What was renamed is every string a user can read: the launcher label
(`app_name`), the wordmark and tagline on the sign-in screen, the Focus tab
title, the foreground-service notification title, the accessibility service
label and description shown in Settings, and the prose in these docs.

What was **not** renamed, and must not be: `applicationId`, `namespace`, the 20
Kotlin package declarations, the accessibility `SERVICE_ID`, and the Device
Owner component `com.tether/.admin.TetherDeviceAdmin`. Changing the
applicationId invalidates the Device Owner provisioning — and a Device Owner
cannot be force-stopped or cleanly uninstalled without
`dpm remove-active-admin` — revokes the accessibility grant, and wipes the
SharedPreferences holding XP, level, blocklist and completed tasks. The
internal Kotlin names (`TetherService`, `TetherPackage`, `TetherStorage`, the
`tether:` event prefixes) stayed for the same reason in miniature: nobody sees
them, and a `TetherStorage` key rename would orphan the user's saved points.

`app.json` looks inconsistent on purpose: `displayName` is Medusa, `name` is
still `Tether`. `name` is the React Native root component name, tied to
`MainActivity.getMainComponentName()` and to `AppRegistry.registerComponent()`
in `index.js`. Change one of those three without the other two and the app
boots to a blank screen. It is invisible to users, so it was left alone.

So every `com.tether` in this repo is a real identifier, not a leftover. The
original name came from the spec doc (`snake.md`), and it still collides with
Android's own "tethering" — two system packages and an APEX module use the
word, so `adb logcat | grep -i tether` returns system noise. Use
`grep "com.tether"`.

Renaming the package itself is cheap after the demo and expensive during it.

---

## 10. Three bugs worth learning from

Two were in the kill switch — the one control that has to work when everything
else has gone wrong. The third is the one that keeps coming back. All are fixed;
the shape of them will recur.

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

**Why:** the overlay is on screen exactly when Medusa is *backgrounded*. In that
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

And a fourth time, the worst of them, in the snake itself. A release used to
spring the snake into a coil, hold it, then crawl it home over 2.4s. **None of
that was ever seen by anyone.** The animation did not advance, so the snake
simply froze in whatever pose the release caught it in -- usually fully
extended, its head stranded 44dp down the screen, where it stayed until the next
process start. The pose depended on where the user's finger happened to stop.

That is why `SnakeAtRest` draws the settled states as plain Views instead:

> The animated body is rendered ONLY while a finger is down. dragY is driven by
> touch events, so that is the one moment animation is guaranteed to advance.
> Everything after the release is drawn, not animated to.

The coil-and-crawl-home flourish is gone rather than fixed. It could only ever
play while Medusa was in the foreground, and the overlays are hidden then, so
there was no state in which it could be seen.

The same bug was found a third time in `widgetTrigger.ts`: the task panel was
shown by `setTimeout(..., 3800)` so it would not collide with the snake crawling
home. It therefore **never appeared on a real session start** -- only when
something else happened to be driving the JS thread. `Overlay.showAfter` fixed
it. Three instances in one file each is enough to call it the house rule:

> If it happens later, Kotlin owns the clock.

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

The one thing that still hides the snake is Medusa being in the foreground — the
`AppState` listener in `bootstrap.ts` pulls it, the ✕ and the task card down while
you are looking at the app itself, and puts them back when you leave. That is
intentional: the overlay would otherwise sit on top of the app's own UI.

**If you are tempted to let something remove the snake, don't.** There is no
in-app path back to it any more, because there is no longer meant to be a state
it can be missing from.

---

## 12a. Sign-in

One screen, two fields: type a name and an email, tap Continue, you are in. Only
the email is required. No password, no separate sign-up, no network.

A password could only ever have been checked against the device it was typed on,
which proves nothing, so it was removed along with the two screens that
collected it (`LoginScreen`/`SignUpScreen`, recoverable from git). `isValidEmail`
is deliberately permissive and there is **no domain allowlist**: university and
work addresses are the expected case, but an allowlist rejects legitimate users
and a free-provider denylist is trivially side-stepped. Neither can actually be
enforced without a backend.

`continueWithEmail(email, name?)` in `src/state/authStore.ts` signs into the
existing local account for that address if there is one -- so points survive a
sign-out -- and otherwise creates it. The Name field is optional because it is
the one thing standing between a judge and the app at a demo: blank keeps a
returning account's stored name, or for a first sign-in derives one from the
address (`ada.lovelace@uni.edu` -> "Ada Lovelace", but also
`saurab200@gmail.com` -> "Saurab200", which is why we ask). A name that IS typed
always wins and overwrites the stored one -- only the name changes, so the
account and its points are untouched. Identity lives under `auth.session` /
`auth.accounts` in the same SharedPreferences-backed `Storage` as everything
else.

**The gate does not gate the app.** `index.js` is untouched: the snake, the XP
bar, the foreground service, gamification and the reward trigger all still start
at module scope, outside React. A signed-out user loses the tabs and nothing
else -- a running session keeps counting and still credits points.

### Do not oversell this

It is not authentication and it does not make the leaderboard authentic. Anyone
can type anyone's address, and `LeaderboardScreen` still falls back to five
hardcoded rows when its fetch fails, which it always does. What sign-in actually
buys is the user's own row carrying their own name. The honest framing is
"accounts and a sign-in experience; leaderboard backend still to come."

---

## 12. XP, levels and the leaderboard

One number, `totalPoints`, in `src/state/gamificationStore.ts`. Everything reads
it: the leaderboard ranks on it, skins unlock from it, and the bar across the top
of the screen shows progress through the current level.

Two things pay into it:

| Action | XP |
|---|---|
| Sitting out a whole focus session | 1 per minute |
| Ticking a task off | `XP_PER_TASK` (10) |

Levels are **derived**, never stored: `levelInfoFor(points)`, 25 XP per level.
There is no second currency and nothing to migrate.

### Ticking a task

`completeTask(id)` credits the XP and records the id in `completedTaskIds`, which
does double duty: it is the dedup record AND the reason a ticked task stays gone
when the panel reloads. Tasks are re-fetched from Canvas on every open, so
without it a refresh would resurrect everything the user had just cleared.
`uncompleteTask(id)` gives the XP back, so a tick cannot be farmed by toggling.

Rows marked `readOnly` (the Focus-stats rows: streak, minutes today, distractions
blocked) render without a tick control. They are figures that regenerate on every
fetch, so "completing" one is meaningless -- and would have been free XP.

### The flourish, and the third window it needs

Ticking plays a ~1.2s flourish: the row empties out, a `+10 XP` token flies from
the tick box to the leading edge of the XP bar's fill, and a line of
encouragement appears under it. Three things about it are not negotiable:

- **It needs a third window.** The panel is anchored right, the bar is 18dp
  across the top, and nothing can draw across a window boundary. `XpFlightOverlay`
  is a full-screen stage that exists only for the flourish. Every gravity-placed
  overlay is laid out inside the same parent frame (the display minus the system
  bars), which is why the flight overlay can derive the panel's origin from its
  own measured size rather than guessing.
- **It is `touchable: false`.** A window swallows every touch inside its bounds
  and unhandled touches are NOT forwarded (§5). Full-screen without
  `FLAG_NOT_TOUCHABLE`, it would freeze the whole phone for a second.
- **Both of its clocks are native.** `NativeClock` drives the frames and
  `Overlay.hideAfter` removes the window. A JS timer for either would strand a
  screen-sized overlay on top of everything.

The panel and the flight overlay subscribe to the SAME run id, which is how two
separate windows animate in step.

### Ticking does NOT fire an AwardEvent

`AwardEvent` means "a focus session completed" and exists to drive a celebration.
A tick is small and frequent; a card for each one would be unbearable. The XP bar
watches plain store state, so it still moves.

### That merge has now happened

`origin/develop` (Ali's reward overlay + levels) is merged in. The verbatim copy
did its job: the store conflict was cosmetic, because this branch's copy is a
strict **superset** of develop's -- every difference is an addition.

One real trap, for whoever merges anything else from that side: develop's
`HomeScreen` imports `PEEK_NOW_EVENT` and `setSnakePeeking`, which belong to the
old peek snake design this branch deleted when the snake moved into the bezel.
They do not compile here. Git drops the button that used them on its own, but
the imports have to go by hand.

### The reward card waits for a tap

When a session completes over another app, `RewardOverlay` appears and stays
until tapped (or until Medusa is next opened -- it has its own AppState listener
for that). Its 4.6s auto-dismiss is a JS timer and cannot run while Medusa is
backgrounded. Ali found this independently and designed the card to paint its
finished state on first frame rather than fade in, which is why it appears at
all. Left as designed; know it before demoing.
