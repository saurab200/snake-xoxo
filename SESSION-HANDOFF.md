# Tether — Session Handoff

For picking this up on a **different machine**. State as of `c49d141`, 26 commits.

[HANDOFF.md](HANDOFF.md) covers the code. This file covers everything that does
*not* live in the repo — the environment, and how to get back to a working setup.

> All work is pushed. Local and `github.com/saurab200/snake-xoxo` are identical
> at `c49d141`, working tree clean.

---

## 1. Where we left off

Tether is an Android focus app. A green snake lives in the top bezel; pull its
tail down and how far you pull sets the session length. During a session the
apps you blocked **disappear from the launcher entirely**, and a task card shows
what to work on instead.

| Commit | What |
|---|---|
| `c49d141` | Corrected stale hashes in the handoff doc |
| `0c439a4` | **Fixed both kill-switch bugs** — it now stops the service, and stays stopped |
| `994d651` | Wrote `HANDOFF.md` |
| `0afb9c4` | Task card on session start + "Add an app" catalogue |
| `a5f7e52` | Snake lives in the bezel, crawls home after a pull |

Tag `demo-v1` marks a known-good demo build to fall back to.

---

## 2. What does NOT transfer

The code travels. The environment does not.

| Thing | Why it matters |
|---|---|
| **The emulator AVD** | Create one in Android Studio → Device Manager. Any Pixel, **API 34/35, Google APIs** — it needs YouTube and Chrome preinstalled for the demo. |
| **Device Owner** | Per-device provisioning. Without it, blocked apps are covered by a wall instead of vanishing. |
| **Accessibility grant** | Resets on *every* reinstall. The number-one cause of "blocking just stopped working". |
| **The built APK** | `~/Desktop/tether.apk` existed only on the old machine. Rebuild or copy it. |
| **Canvas credentials** | Never set on either machine — see §5. |

**Clone into a path with no spaces.** The old checkout was
`/Users/hunter/snake xoxo`, and Gradle is unreliable with spaces in the path.
Use `~/code/tether`. This already cost real time once.

---

## 3. Getting running

Needs Node 18+, JDK 17+, Android Studio, and an AVD as above.

```bash
git clone git@github.com:saurab200/snake-xoxo.git ~/code/tether
cd ~/code/tether
npm install
npm run setup                  # writes android/local.properties for this machine

./scripts/emulator.sh boot     # starts the AVD with -gpu host
./scripts/emulator.sh install  # builds, installs, grants all three permissions
```

Once only, to enable vanish mode:

```bash
adb shell dpm set-device-owner com.tether/com.tether.admin.TetherDeviceAdmin
```

Only works on a device with no Google account signed in — fine on a fresh
emulator, needs a factory-reset phone otherwise. Skip it and everything still
works; blocked apps get the wall instead of disappearing.

### Check it worked

```bash
adb shell settings get secure enabled_accessibility_services
    # expect com.tether/com.tether.blocking.TetherAccessibilityService

adb shell dpm list-owners
    # expect com.tether/.admin.TetherDeviceAdmin, DeviceOwner
```

---

## 4. Read these, in this order

| File | What it gives you |
|---|---|
| `HANDOFF.md` | **Start here.** Status table, five decisions not to undo, architecture in execution order, setup gotchas, and §10 on two bugs whose shape will recur. |
| `README.md` | Setup, why there is Kotlin in a React Native project, per-slice file ownership. |
| `docs/BACKLOG.md` | Deferred items with enough context to pick up cold. |
| `docs/PERSON-{A,B,C,D}-AGENT-BRIEF.md` | Self-contained specs per slice, written to hand to an AI agent. A/B/C implemented; D (gamification) not started. |

---

## 5. The three genuinely unverified things

Everything else in the status table was checked by running it and reading the
result. These were not, and more coding will not settle them:

1. **Canvas has never hit a live instance.** The client, its 8s timeout and its
   error mapping were reasoned about, not exercised. Highest-value unknown in
   the codebase. Get a token from Canvas → Account → Settings → *+ New Access
   Token* and connect it on the Apps tab.
2. **Haptics have never been felt.** The emulator has no vibrator.
3. **The snake's feel is guesswork.** `MINUTES_PER_DP`, the spring
   `tension`/`friction`, `COIL_HOLD_MS`, `CRAWL_HOME_MS` were picked blind.
   Judge them with a thumb.

---

## 6. Known sharp edges

- **Vanish mode loses home-screen shortcuts.** Hiding a package makes the
  launcher drop it from the saved layout; unhiding returns the app to the drawer
  but not to the home screen.
- **A Device Owner app cannot be force-stopped.** `am force-stop` silently does
  nothing. Release it with
  `adb shell dpm remove-active-admin com.tether/com.tether.admin.TetherDeviceAdmin`
- **Two task-card tabs are inert** by design.
- **Reminders only fire while the service is alive** — they run off the 1-second
  ticker, deliberately, to avoid the restricted exact-alarm permission.

---

## 7. Demo script

1. **Home screen** — the snake's tail hangs from the bezel, small and ignorable.
2. **Pull the tail down** — it uncoils, the duration climbs. Release around 45 min.
3. It coils, holds, then **crawls back into the bezel**. A timer pill and a `+`
   appear beside it.
4. **The task card slides up** — what you owe, grouped by due date.
5. **Open YouTube** — the icon is *gone from the launcher*. Not blocked: absent.
6. **Tap the ✕ twice** — everything stops, and stays stopped.

Record a backup video. Accessibility permissions are flaky live, and a Device
Owner app cannot be force-stopped if something goes sideways on stage.

---

## 8. Starting a new AI session

Paste this as the first message, after cloning:

```
I'm continuing work on Tether, an Android focus app in React Native 0.75.4
plus a Kotlin layer. The repo is cloned here and is at commit c49d141.

Read HANDOFF.md first — it covers what works, what is unverified, and five
decisions not to undo (the most important: newArchEnabled must stay false,
or all six overlays silently render nothing).

Environment notes: the emulator AVD, Device Owner provisioning and the
accessibility grant are per-machine and do not come from the repo. See
SESSION-HANDOFF.md §3, or scripts/emulator.sh.

Next up, in priority order:
  1. Test the Canvas connector against a real instance — it has never run
     against live Canvas.
  2. Tune the snake's feel on hardware (MINUTES_PER_DP, spring tension and
     friction, COIL_HOLD_MS, CRAWL_HOME_MS). Haptics have never been felt.
  3. Warn the user before enabling vanish mode, since it loses home-screen
     shortcuts.
```

---

## 9. Naming

"Tether" came from the original spec doc, not a deliberate choice, and it
collides with Android's own *tethering* — two system packages and an APEX module
use the word, so `adb logcat | grep -i tether` returns system noise. Use
`grep "com.tether"`.

Renaming touches `applicationId`, `namespace`, 20 Kotlin package declarations,
the accessibility service ID, the Device Owner component name, the emulator
script and all four briefs — and invalidates the Device Owner provisioning.
Cheap after the demo, expensive during it.
