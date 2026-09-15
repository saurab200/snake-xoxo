# Backlog

Deferred items, with enough context to pick them up cold.

## Snake recoil feel

`Animated.spring(dragY, {tension: 70, friction: 11})` in
[`src/overlays/SnakeOverlay.tsx`](../src/overlays/SnakeOverlay.tsx) makes the
snake recoil slowly and heavily on release. That was a guess, never tuned
against a real thumb.

- Higher `tension` / lower `friction` -> snappier, more elastic
- Lower `tension` / higher `friction` -> heavier, more deliberate

Related: `MINUTES_PER_DP` (0.4) was set when the snake was twice its current
size. The same pull distance still gives the same duration, which may now feel
wrong relative to how small the snake looks.

Both are feel decisions. Judge on hardware, not the emulator.

## Lockout wall wording

The lockout wall still reads "No early exit during a lockout." The top-right
kill switch is now an exit, so that line is slightly untrue. Either soften the
wording or hide the kill switch during a lockout to make it literally true.
Product call, not a technical one.

## Vanish mode: apps disappear from Medusa's own list too

`AppList.installed()` queries launchable activities, and a hidden app has no
launchable activity -- so while a session is running, blocked apps also vanish
from Medusa's own Blocked tab. You can see the count drop (20 apps -> 19) but
cannot untick the app that is currently hidden.

"Restore all apps now" on that screen is the workaround. A better fix would be
to merge the live launchable list with the persisted blocklist so hidden
entries still render (greyed, with a "hidden now" tag).

## Device Owner cannot be undone from inside the app

`dpm set-device-owner` sticks until the device is factory reset or the owner is
explicitly removed:

    adb shell dpm remove-active-admin com.tether/com.tether.admin.TetherDeviceAdmin

Worth putting behind a visible control before anyone provisions a phone they
actually care about.

## Vanish mode loses home-screen shortcuts

Observed on the emulator: after a blocked app is hidden and later restored, it
comes back in the app drawer but its HOME SCREEN shortcut is gone.

Hiding a package makes the launcher drop it from the saved home-screen layout;
unhiding re-registers the app but nothing puts the shortcut back where the user
had it. So blocking Instagram a few times quietly rearranges someone's home
screen.

Not a bug in Medusa -- it is how launchers react to a package disappearing --
but it makes vanish mode mildly destructive to a layout the user chose. Worth
warning about in the UI before anyone enables it on a phone they care about, or
worth reconsidering against the launcher approach (option 2 in the original
blocking decision), where Medusa owns the grid and can dim in place instead.
