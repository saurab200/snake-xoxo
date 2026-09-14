import React, {useCallback, useEffect, useState} from 'react';
import {
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Blocking,
  Focus,
  Overlay,
  PermissionStatus,
  Permissions,
  RemindersApi,
} from '../native';
import {WIDGET_LAYOUT} from '../overlays/WidgetOverlay';
import {rearm, startSnake} from '../state/bootstrap';
import {Storage} from '../state/storage';
import {formatRemaining, useFocusSession} from '../state/useFocusSession';

const EMPTY_PERMS: PermissionStatus = {
  overlay: false,
  accessibility: false,
  notifications: false,
};

export default function HomeScreen() {
  const session = useFocusSession();
  const [perms, setPerms] = useState<PermissionStatus>(EMPTY_PERMS);


  const refreshPerms = useCallback(async () => {
    setPerms(await Permissions.getStatus());
  }, []);

  // Permissions are granted on a Settings screen, so re-check on resume.
  useEffect(() => {
    refreshPerms();
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        refreshPerms();
        session.refresh();
      }
    });
    return () => sub.remove();
  }, [refreshPerms, session]);

  const allGranted = perms.overlay && perms.accessibility;

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.h1}>Tether</Text>

      <Section title="1 · Permissions">
        <PermRow
          label="Draw over other apps"
          ok={perms.overlay}
          onPress={Permissions.openOverlaySettings}
        />
        <PermRow
          label="Accessibility service"
          ok={perms.accessibility}
          onPress={Permissions.openAccessibilitySettings}
        />
        <PermRow
          label="Notifications"
          ok={perms.notifications}
          onPress={Permissions.openNotificationSettings}
        />
        <Button
          label="Battery: set to Unrestricted"
          onPress={Blocking.openBatteryOptimizationSettings}
          muted
        />
        <Text style={styles.hint}>
          Android kills the timer service under battery optimisation. Find Tether
          in the list and allow unrestricted background use.
        </Text>
        <Button label="Re-check" onPress={refreshPerms} muted />
      </Section>

      <Section title="2 · Snake">
        {!allGranted ? (
          <Text style={styles.warn}>
            Grant the permissions above — the snake appears automatically once
            you do.
          </Text>
        ) : (
          <Text style={styles.hint}>
            The snake lives in the top bezel. Leave the app, grab the tail tip
            and pull down — the further you pull, the further it comes out and
            the longer the session.
          </Text>
        )}
        <Button
          label="Re-pin snake"
          onPress={() => {
            startSnake();
            rearm();
          }}
          muted
        />
        <Text style={styles.hint}>
          A ✕ sits in the top-right corner while the snake is up. Tap it twice to
          stop everything — session, lockout and overlays — from anywhere.
        </Text>
      </Section>

      <Section title="3 · Session">
        <Text style={styles.status}>
          {session.isActive
            ? `Active · ${formatRemaining(session.remainingMs)} left`
            : 'Idle'}
        </Text>
        <View style={styles.row}>
          <Button
            label="Start 1 min"
            onPress={async () =>
              Focus.startSession(1, await Storage.getBlocklist())
            }
          />
          <Button
            label="Start 25 min"
            onPress={async () =>
              Focus.startSession(25, await Storage.getBlocklist())
            }
          />
        </View>
        <Button label="Stop" onPress={() => Focus.stopSession()} muted />
      </Section>

      {/*
        INTEGRATION STUBS -- use these so nobody is blocked waiting on someone
        else's real implementation. Delete once the real path works end to end.
      */}
      <Section title="Dev · simulate">
        <Button
          label="Show block overlay"
          onPress={() =>
            Overlay.show(
              'BlockOverlay',
              {
                width: Overlay.MATCH_PARENT,
                height: Overlay.MATCH_PARENT,
                gravity: 'center',
                focusable: true,
                touchThrough: false,
              },
              {appLabel: 'Instagram', packageName: 'com.instagram.android'},
            )
          }
          muted
        />
        <Button
          label="Show Canvas widget"
          onPress={() =>
            Overlay.show('WidgetOverlay', WIDGET_LAYOUT, {
              integrationId: 'canvas',
            })
          }
          muted
        />
        <Button
          label="Add a task / reminder"
          onPress={() =>
            Overlay.show(
              'ReminderOverlay',
              {
                width: Overlay.MATCH_PARENT,
                height: Overlay.MATCH_PARENT,
                gravity: 'center',
                focusable: true,
                touchThrough: false,
              },
              {},
            )
          }
          muted
        />
        <Button
          label="Trigger 2 min lockout"
          onPress={() => RemindersApi.startLockout(2, 'Demo lockout')}
          muted
        />
        <Button
          label="End lockout"
          onPress={() => RemindersApi.stopLockout()}
          muted
        />
        <Button label="Hide all overlays" onPress={Overlay.hideAll} muted />
      </Section>
    </ScrollView>
  );
}

/* ---- tiny local UI primitives, deliberately not a design system ---- */

function Section({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <View style={styles.section}>
      <Text style={styles.h2}>{title}</Text>
      {children}
    </View>
  );
}

function Button({
  label,
  onPress,
  muted,
}: {
  label: string;
  onPress: () => void;
  muted?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.button, muted && styles.buttonMuted]}
      onPress={onPress}>
      <Text style={[styles.buttonText, muted && styles.buttonTextMuted]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function PermRow({
  label,
  ok,
  onPress,
}: {
  label: string;
  ok: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.permRow} onPress={onPress}>
      <Text style={styles.permIcon}>{ok ? '✓' : '○'}</Text>
      <Text style={styles.permLabel}>{label}</Text>
      {!ok ? <Text style={styles.permAction}>Grant ›</Text> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: {padding: 20, paddingBottom: 60, backgroundColor: '#0d1117', flexGrow: 1},
  h1: {color: '#fff', fontSize: 28, fontWeight: '800', marginBottom: 20},
  h2: {color: '#8b949e', fontSize: 12, fontWeight: '700', marginBottom: 10},
  section: {
    backgroundColor: '#161b22',
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
  },
  row: {flexDirection: 'row', gap: 8},
  status: {color: '#e6edf3', fontSize: 16, marginBottom: 10},
  hint: {color: '#8b949e', fontSize: 12, marginTop: 8},
  warn: {color: '#d29922', fontSize: 12, marginBottom: 8},
  button: {
    backgroundColor: '#1f6feb',
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginTop: 8,
    flexGrow: 1,
  },
  buttonMuted: {backgroundColor: '#21262d'},
  buttonText: {color: '#fff', fontWeight: '600', textAlign: 'center'},
  buttonTextMuted: {color: '#c9d1d9'},
  permRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 8},
  permIcon: {color: '#3fb950', width: 22, fontSize: 15},
  permLabel: {color: '#e6edf3', flex: 1, fontSize: 14},
  permAction: {color: '#1f6feb', fontSize: 13},
});
