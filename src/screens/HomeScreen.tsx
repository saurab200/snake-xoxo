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
  PermissionStatus,
  Permissions,
  RemindersApi,
} from '../native';
import RewardBadge from '../components/RewardBadge';
import {logout, useAuth} from '../state/authStore';
import {rearm, startSnake} from '../state/bootstrap';
import {useGamification} from '../state/gamificationStore';
import {Storage} from '../state/storage';
import {formatRemaining, useFocusSession} from '../state/useFocusSession';

const EMPTY_PERMS: PermissionStatus = {
  overlay: false,
  accessibility: false,
  notifications: false,
};

export default function HomeScreen() {
  const session = useFocusSession();
  const game = useGamification();
  const auth = useAuth();
  const [perms, setPerms] = useState<PermissionStatus>(EMPTY_PERMS);

  const refreshPerms = useCallback(async () => {
    setPerms(await Permissions.getStatus());
  }, []);

  /**
   * Permissions are granted on a Settings screen, so re-check on resume.
   *
   * Depends on session.refresh (a stable useCallback) and NOT on `session`.
   * useFocusSession returns a fresh object literal every render, and the native
   * tick re-renders once a second -- so depending on the object re-ran this
   * effect every second, firing a TetherPermissions.getStatus bridge call and
   * re-registering the AppState listener each time. That accumulated hundreds of
   * pending native callbacks ("Excessive number of pending callbacks") and
   * eventually makes React Native start dropping calls.
   */
  const refreshSession = session.refresh;
  useEffect(() => {
    refreshPerms();
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        refreshPerms();
        refreshSession();
      }
    });
    return () => sub.remove();
  }, [refreshPerms, refreshSession]);

  const allGranted = perms.overlay && perms.accessibility;

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.h1}>Medusa</Text>

      <Section title="Your rewards">
        <View style={styles.pointsRow}>
          <Text style={styles.pointsValue}>{game.totalPoints}</Text>
          <Text style={styles.pointsUnit}>pts</Text>
          <View style={styles.levelPill}>
            <Text style={styles.levelPillText}>Lv {game.level}</Text>
          </View>
        </View>

        {/*
          Static bar, not animated: the animated version lives in RewardOverlay
          where the user is actually watching. Here it is a status readout, and
          a width percentage is the simplest thing that cannot drift out of sync.
        */}
        <View style={styles.levelTrack}>
          <View
            style={[
              styles.levelFill,
              {
                width: `${Math.round(game.progress * 100)}%`,
                backgroundColor: game.activeSkinColor,
              },
            ]}
          />
        </View>
        <Text style={styles.levelCaption}>
          {game.xpIntoLevel}/{game.xpForLevel} XP · {game.xpToNext} to level{' '}
          {game.level + 1}
        </Text>

        <Text style={styles.hint}>
          Finish a focus session to earn 1 point per minute, then unlock and
          equip new snake skins.
        </Text>
        <View style={styles.skinRow}>
          {game.skins.map(skin => (
            <RewardBadge
              key={skin.id}
              name={skin.name}
              color={skin.color}
              requiredPoints={skin.requiredPoints}
              unlocked={game.isSkinUnlocked(skin.id)}
              active={game.activeSkin === skin.id}
              onSelect={() => game.setActiveSkin(skin.id)}
            />
          ))}
        </View>
      </Section>

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
          Android kills the timer service under battery optimisation. Find Medusa
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
          A + sits in the top-right corner. Tap it to add a task from anywhere,
          without starting a session first. Like the snake, it lives on your
          screen from install onward.
        </Text>
        <Text style={styles.hint}>
          To stop early, use End focus mode below, or the notification.
        </Text>
      </Section>

      <Section title="3 · Focus">
        <Text style={styles.status}>
          {session.isLockedOut
            ? `Focus mode · ${formatRemaining(session.lockoutRemainingMs)} left`
            : session.isActive
            ? `Active · ${formatRemaining(session.remainingMs)} left`
            : 'Idle'}
        </Text>

        <Button
          label="Start 25 min"
          onPress={async () =>
            Focus.startSession(25, await Storage.getBlocklist())
          }
        />

        {/*
          ONE stop, because there are two ways to be in focus and the user
          should not have to know which one they are in.

          A session and a reminder-triggered focus mode are separate states
          natively, and each has its own native call -- so a button wired to
          just one of them looks broken exactly half the time. This ends
          whichever is running, and does nothing gracefully when neither is.

          This is also the ONLY way out of focus mode now that the ✕ overlay is
          gone, so it is a product control rather than the dev stub it used to
          be. Do not demote it back.
        */}
        <Button
          label="End focus mode"
          onPress={async () => {
            await Focus.stopSession().catch(() => {});
            await RemindersApi.stopLockout().catch(() => {});
          }}
          muted
        />
      </Section>

      <Section title="Account">
        <Text style={styles.accountName}>{auth.user?.name ?? 'Signed in'}</Text>
        <Text style={styles.accountEmail}>{auth.user?.email ?? ''}</Text>
        <Button label="Log out" onPress={() => logout()} muted />
        <Text style={styles.hint}>
          Signing out keeps your points, skins, blocklist and reminders — it only
          ends the session.
        </Text>
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
  pointsRow: {flexDirection: 'row', alignItems: 'baseline', gap: 6},
  pointsValue: {color: '#fff', fontSize: 34, fontWeight: '800'},
  pointsUnit: {color: '#8b949e', fontSize: 14, fontWeight: '700'},
  levelPill: {
    marginLeft: 'auto',
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  levelPillText: {color: '#e6edf3', fontSize: 12, fontWeight: '800'},
  levelTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: '#30363d',
    overflow: 'hidden',
    marginTop: 12,
  },
  levelFill: {height: '100%', borderRadius: 3},
  levelCaption: {color: '#8b949e', fontSize: 11, marginTop: 6},
  accountName: {color: '#e6edf3', fontSize: 15, fontWeight: '700'},
  accountEmail: {color: '#8b949e', fontSize: 12, marginTop: 2},
  skinRow: {flexDirection: 'row', gap: 8, marginTop: 12},
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
