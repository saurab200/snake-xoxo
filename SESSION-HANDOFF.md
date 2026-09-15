# Tether — Session Handoff

Everything built so far, and how to pick it back up.

Current state: branch **`feature/taskui`**, clean and pushed.

- [HANDOFF.md](HANDOFF.md) — the code: architecture, decisions not to undo, known edges
- [README.md](README.md) — setup and per-slice file ownership
- **This file** — what was built, branch topology, and how to resume

---

## 1. What Tether is

An Android focus app. A green snake lives in the top bezel. Pull its tail down —
how far you pull sets the session length. During a session the apps you blocked
**disappear from the launcher entirely**, a task card shows what to work on, and
finishing a session earns points that unlock snake skins.

React Native 0.75.4 + a Kotlin layer. Android only.

---

## 2. What was built

### The snake (Person 1 / A)

- Lives in the bezel; only the tail tip shows at rest.
- One `Animated.Value` drives three stops: **bezel → coiled → extended**, so how
  far it emerges is exactly how far you pull.
- A committed pull settles into a coil, holds, then crawls home over ~2.4s. A
  short pull just retracts.
- Duration snaps to 5-minute steps with haptic detents. 60fps, flat 16ms frames.
- Timer runs in a Kotlin foreground service, so it survives the JS thread idling.
- Survives reboot and force-stop; the session deadline is preserved exactly.

### Blocking (Person 2 / B)

- Accessibility service detects the foreground app and checks the blocklist in
  Kotlin — no JS bridge hop.
- Block wall with a live countdown, or **vanish mode**: with Device Owner the
  blocked app's icon disappears from the launcher entirely. No icon, no dialog,
  nothing to tap.
- Searchable blocklist, selected-first, persisted natively so it survives a cold
  start.
- Warns when Android silently disables the accessibility service.

### Integrations and tasks (Person 3 / C)

- **Apps tab** with a "+ Add an app" catalogue. Canvas connects for real; Google
  Classroom, Notion and Todoist are listed as unavailable on purpose.
- **Task panel** slides in from the right edge when a session starts: no
  background of its own, compact rows, collapsible `DUE IN N DAYS` headings, and
  a **›** that minimises it to a handle on the edge rather than closing it.
- **Tick a task** and the row disappears and pays 10 XP. Ticks persist, so a
  refresh from Canvas cannot resurrect what you cleared.
- Canvas assignments and your own reminders land in one list.
- **Reminders**: add a task with a due date and lock duration; when it falls due
  Tether goes into a **total lockout** — blocked apps close on sight, no exit.

### Gamification (Person 4 / D — Ali)

- 1 point per minute of a completed session; cancelled sessions earn nothing.
- Points unlock snake skins: Green 0 / Blue 30 / Gold 120. The active skin
  re-tints the whole snake and its pills.
- **Rank** tab with a leaderboard.
- **XP bar** bolted to the bezel across the top of the screen, with the snake
  hanging from it. Every point earned -- a ticked task, or a session sat out to
  the end -- lands in the same pot the leaderboard ranks on, and fills the bar
  toward the next level (25 XP each).
- Sessions are credited once, keyed on a persisted fingerprint, so repeated
  events and app restarts cannot double-award.

### Cross-cutting

- **Kill switch** — a ✕ in the top-right. Two taps stops the session, any
  lockout and the task card, from anywhere. It does **not** remove the snake:
  the snake is a permanent fixture from install onward, through reboots. See
  HANDOFF.md §11.

---

## 3. Branch topology

```
main                          d8c3bff   snake + blocking + tasks (no gamification)
feature/gamification-rewards  ad98e4e   Ali's work, untouched
develop                       f5b8051   gamification merged in
feature/taskui                8b2e689   ← EVERYTHING. Work here.
```

`feature/taskui` is the only branch with all four slices. `main` does **not**
have gamification yet.

The merge was smaller than expected: Ali's SnakeOverlay change was colour-only
and built on top of the arc-length spiral, so only two files conflicted. Details
are in the merge commit.

---

## 4. Verified vs assumed

Everything below marked verified was checked by running it on an emulator and
reading the result.

| Area | State |
|---|---|
| Snake: bezel, pull, coil, crawl home | Verified |
| Timer, reboot and force-stop survival | Verified |
| Blocking + vanish mode | Verified |
| Reminders → lockout | Verified |
| Task card + due-date grouping | Verified |
| Integrations catalogue | Verified |
| Points, dedup, skins tinting the snake | Verified after the merge |
| Kill switch: stops the session, leaves the snake | Verified |
| Task panel: right edge, minimise, expand | Verified |
| Tick -> row disappears, XP bar fills | Verified (5/25 -> 15/25) |
| XP bar survives a reboot | Verified |
| Snake returns after a reboot, app never opened | Verified |
| Overlay window resizes across pull / session / stop | Verified, 3 cycles |
| **Canvas against a live instance** | **Never tested** |
| **Haptics** | **Never felt** — emulator has no vibrator |
| **Leaderboard network path** | Falls back to mock data silently by design |

---

## 5. Resuming on THIS machine

The environment is already provisioned here — emulator, Device Owner,
accessibility grant. Usually all you need is:

```bash
cd "/Users/hunter/snake xoxo"
git checkout feature/taskui
```

The snake should already be on screen — it is pinned from install onward and
survives reboots. If it is missing, the overlay permission was probably revoked;
grant it and use Focus tab → **Re-pin snake**.

### Resuming on a DIFFERENT machine

The code travels; the environment does not. The emulator AVD, Device Owner
provisioning and the accessibility grant are all per-machine, and two of the
three reset on every reinstall.

```bash
git clone git@github.com:saurab200/snake-xoxo.git ~/code/tether   # no spaces in the path
cd ~/code/tether
git checkout feature/taskui
npm install
npm run setup                  # writes android/local.properties

./scripts/emulator.sh boot     # AVD: any Pixel, API 34/35, Google APIs
./scripts/emulator.sh install  # builds, installs, grants permissions

adb shell dpm set-device-owner com.tether/com.tether.admin.TetherDeviceAdmin
```

That last one enables vanish mode and only works with no Google account signed
in. Skip it and everything else still works; blocked apps get the wall instead
of disappearing.

---

## 6. Gotchas that each cost an hour once

- **Android disables the accessibility service on every reinstall.** Top cause of
  "blocking just stopped working". The Blocked tab shows a red banner.
- **Enabling it over adb only sticks if the app is running.** Start the app
  first, then grant. `./scripts/emulator.sh grant` does it in the right order.
- **`adb uninstall` wipes SharedPreferences** — the blocklist resets.
  `adb install -r` preserves it.
- **Kotlin changes need `npm run android`.** Metro reload will not pick them up.
- **A Device Owner app cannot be force-stopped.** `am force-stop` silently does
  nothing.
- **Boot the emulator with `-gpu host`.** Software rendering costs ~23ms a frame
  and makes every animation look broken. `scripts/emulator.sh` already does this.
- **Never set `newArchEnabled=true`.** All six overlays would silently render
  nothing.
- **JS timers and animation callbacks do not fire while Tether is
  backgrounded** — which is whenever the overlays are actually on screen. Use
  `Overlay.setLayoutAfter` for deferred resizes. HANDOFF.md §10.

---

## 7. What is next

1. **Test Canvas against a real instance.** The client has never run against
   live Canvas — only its error paths were reasoned about. Highest-value unknown
   in the codebase. Token: Canvas → Account → Settings → *+ New Access Token*.
2. **Tune the snake on hardware.** `MINUTES_PER_DP`, spring `tension`/`friction`,
   `COIL_HOLD_MS`, `CRAWL_HOME_MS` were all picked blind. Haptics unfelt.
3. **Decide whether `feature/taskui` merges into `main` or `develop`.**
4. **Ask Ali** whether the bezel tail should use his `palette.accent` — his
   peek-nub tinting was dropped with the nub it belonged to.
5. **Merge `feature/reward-overlay-and-levels`** (Ali's newest). The levels and
   `AwardEvent` code in `gamificationStore.ts` was copied from that branch
   verbatim so the two sides make an identical change — keep it that way or the
   merge stops being free. HANDOFF.md §12.
6. **Warn before enabling vanish mode** — it loses home-screen shortcuts.

---

## 8. Starting a new AI session

Paste this as the first message:

```
Continuing Tether, an Android focus app (React Native 0.75.4 + Kotlin).
Repo: /Users/hunter/snake xoxo — branch feature/taskui, clean and pushed.
That branch has all four slices including the gamification merge; main
does not.

Read HANDOFF.md first: architecture, the decisions not to undo (most
important: newArchEnabled must stay false or all six overlays silently
render nothing; and deferred overlay resizes must be timed natively,
because JS timers do not fire while Tether is backgrounded), plus known
edges.

Environment is already set up on this machine — emulator, Device Owner,
accessibility grant. The snake is pinned permanently and survives
reboots; if it is missing, check the overlay permission.

Next up:
  1. Test the Canvas connector against a real instance — it has never run
     against live Canvas.
  2. Tune the snake's feel on hardware. Haptics have never been felt.
  3. Decide whether feature/taskui merges into main or develop.
```

---

## 9. Demo script

1. **Home screen** — the XP bar runs along the bezel and the snake's tail hangs
   from it, small and ignorable.
2. **Pull the tail down** — it uncoils, duration climbs. Release around 45 min.
3. It coils, holds, then **crawls back into the bezel**. Timer and `+` pills
   appear beside it.
4. **The task panel slides in from the right** — what you owe, grouped by due
   date, floating over the wallpaper with no panel behind it.
5. **Tick a task** — the row disappears and the bar at the top visibly fills.
   Tap **›** to minimise the panel to an edge handle.
6. **Open YouTube** — the icon is *gone from the launcher*. Not blocked: absent.
7. **Finish a session** → a minute is a point, the bar fills further, and a skin
   can be equipped to recolour the snake and the bar.
8. **Tap the ✕ twice** — the session stops and the blocked apps come back. The
   snake and the XP bar stay, where they always are.

Record a backup video. Accessibility permissions are flaky live, and a Device
Owner app cannot be force-stopped if something goes sideways on stage.

---

## 10. Naming

"Tether" came from the original spec doc, not a deliberate choice, and collides
with Android's own *tethering* — two system packages and an APEX module use the
word, so `adb logcat | grep -i tether` returns system noise. Use
`grep "com.tether"`.

Renaming touches `applicationId`, `namespace`, 20 Kotlin package declarations,
the accessibility service ID, the Device Owner component name, the emulator
script and all four briefs — and invalidates the Device Owner provisioning.
Cheap after the demo, expensive during it.
