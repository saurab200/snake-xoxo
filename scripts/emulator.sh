#!/usr/bin/env bash
#
# Boot an emulator, install Tether, and grant every permission via adb.
#
# Why this exists: Tether needs three permissions that are normally granted by
# tapping through system Settings screens. On an emulator they can be set
# directly with adb, which turns a two-minute manual ritual into one command --
# and makes the app testable with no physical Android device at all.
#
# Usage:
#   ./scripts/emulator.sh boot      # start the emulator and wait for boot
#   ./scripts/emulator.sh install   # build + install + grant permissions
#   ./scripts/emulator.sh grant     # re-grant permissions (after a reinstall)
#   ./scripts/emulator.sh smoke     # automated end-to-end check
#   ./scripts/emulator.sh shot out.png
#
set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
[ -d "$ANDROID_HOME" ] || ANDROID_HOME="$HOME/Android/Sdk"
ADB="$ANDROID_HOME/platform-tools/adb"
EMULATOR="$ANDROID_HOME/emulator/emulator"

PKG="com.tether"
SERVICE="$PKG/$PKG.blocking.TetherAccessibilityService"
APK="android/app/build/outputs/apk/debug/app-debug.apk"

die() { echo "error: $*" >&2; exit 1; }

boot() {
  local avd
  avd="${1:-$("$EMULATOR" -list-avds | head -1)}"
  [ -n "$avd" ] || die "no AVD found. Create one in Android Studio > Device Manager."

  if "$ADB" devices | grep -q "emulator.*device"; then
    echo "emulator already running"
    return
  fi

  echo "booting $avd ..."
  # -gpu host uses the machine's real GPU. The software rasteriser
  # (swiftshader_indirect) costs ~23ms per frame just to draw, which alone
  # blows the 16.7ms budget and makes every animation look broken regardless of
  # how the app is written. Fall back to swiftshader only if host GPU fails.
  nohup "$EMULATOR" -avd "$avd" -gpu host -no-boot-anim \
    > /tmp/emulator.log 2>&1 &

  for _ in $(seq 1 90); do
    if [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
      echo "booted"
      return
    fi
    sleep 3
  done
  die "emulator did not boot in 270s -- see /tmp/emulator.log"
}

grant() {
  # Overlay + notifications are straightforward.
  "$ADB" shell appops set "$PKG" SYSTEM_ALERT_WINDOW allow
  "$ADB" shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS 2>/dev/null || true

  # The accessibility service is the fiddly one.
  #
  # GOTCHA: Android clears enabled_accessibility_services if the target package
  # is not running when you write it -- or if you force-stop the app afterwards.
  # So start the app FIRST, then write the setting, then verify it stuck.
  "$ADB" shell am start -n "$PKG/.MainActivity" > /dev/null
  sleep 6
  "$ADB" shell settings put secure enabled_accessibility_services "$SERVICE"
  "$ADB" shell settings put secure accessibility_enabled 1
  sleep 3

  local got
  got="$("$ADB" shell settings get secure enabled_accessibility_services | tr -d '\r')"
  if [ "$got" = "$SERVICE" ]; then
    echo "permissions granted (overlay, notifications, accessibility)"
  else
    echo "WARNING: accessibility did not stick (got '$got')."
    echo "Enable it by hand: Settings > Accessibility > Medusa app blocking."
  fi
}

install() {
  [ -f "$APK" ] || {
    echo "building debug APK ..."
    (cd android && ./gradlew :app:assembleDebug -q)
  }
  "$ADB" install -r "$APK"
  grant
}

shot() {
  local out="${1:-/tmp/tether-$(date +%H%M%S).png}"
  "$ADB" exec-out screencap -p > "$out"
  echo "$out"
}

# End-to-end check. Blocks YouTube (preinstalled on Google APIs images) and
# verifies the wall appears, persists, and re-appears after dismissal.
smoke() {
  local target="com.google.android.youtube"
  "$ADB" shell pm list packages | grep -q "$target" || die "$target not installed on this AVD"

  echo "1/4 starting a session ..."
  "$ADB" logcat -c
  echo "    -> open the app, Blocked tab (ticks YouTube), then Focus > Start 25 min"
  echo "    (this step is manual: the buttons move as the layout changes)"
  read -r -p "    press enter once a session is running... "

  echo "2/4 opening $target ..."
  "$ADB" shell monkey -p "$target" -c android.intent.category.LAUNCHER 1 > /dev/null 2>&1
  sleep 4
  "$ADB" logcat -d -s ReactNativeJS:V | grep -q 'Running "BlockOverlay"' \
    && echo "    PASS block wall appeared" || die "block wall did not appear"

  echo "3/4 checking it persists (the old vanishing bug) ..."
  sleep 6
  "$ADB" shell dumpsys window | grep -q "$PKG" \
    && echo "    PASS wall still up after 10s" || die "wall vanished"

  echo "4/4 foreground service alive?"
  "$ADB" shell dumpsys activity services "$PKG" | grep -q "isForeground=true" \
    && echo "    PASS foreground service running" || die "foreground service not running"

  echo "smoke test passed"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  boot) boot "$@" ;;
  install) install ;;
  grant) grant ;;
  smoke) smoke ;;
  shot) shot "$@" ;;
  *) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
