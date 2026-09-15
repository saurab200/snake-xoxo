import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  AppState,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {Blocking, Focus, InstalledApp} from '../native';
import {Storage} from '../state/storage';

/** PERSON 2 (Person B) owns this screen. */
export default function BlocklistScreen() {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [serviceOn, setServiceOn] = useState(true);
  const [deviceOwner, setDeviceOwner] = useState(false);
  const [protectedPkgs, setProtectedPkgs] = useState<Set<string>>(new Set());
  const [hiddenCount, setHiddenCount] = useState(0);

  const recheckService = useCallback(async () => {
    setServiceOn(await Blocking.isAccessibilityEnabled());
    try {
      setDeviceOwner(await Blocking.isDeviceOwner());
      setProtectedPkgs(new Set(await Blocking.getProtectedPackages()));
      setHiddenCount(await Blocking.getHiddenCount());
    } catch {
      /* older build without the device-owner bridge */
    }
  }, []);

  useEffect(() => {
    (async () => {
      const [installed, saved, suggested] = await Promise.all([
        Blocking.getInstalledApps(),
        Storage.getBlocklist(),
        Blocking.getSuggestedBlocklist(),
      ]);

      // First run: pre-select the known time sinks that are actually installed.
      const initial =
        saved.length > 0
          ? saved
          : suggested.filter(pkg =>
              installed.some(app => app.packageName === pkg),
            );

      setApps(installed);
      setBlocked(new Set(initial));
      setLoading(false);

      if (saved.length === 0 && initial.length > 0) {
        await persist(new Set(initial));
      }
    })();
  }, []);

  // Android silently disables the accessibility service after every reinstall.
  // Re-check whenever we come back to the foreground -- this is the single most
  // common cause of "blocking just stopped working".
  useEffect(() => {
    recheckService();
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        recheckService();
      }
    });
    return () => sub.remove();
  }, [recheckService]);

  async function persist(next: Set<string>) {
    const list = [...next];
    await Storage.setBlocklist(list);
    await Focus.setBlocklist(list); // takes effect mid-session
  }

  async function toggle(pkg: string) {
    if (protectedPkgs.has(pkg)) {
      return; // refused in AppHider too; this just stops the tick looking real
    }
    const next = new Set(blocked);
    if (next.has(pkg)) {
      next.delete(pkg);
    } else {
      next.add(pkg);
    }
    setBlocked(next);
    await persist(next);
  }

  async function clearAll() {
    setBlocked(new Set());
    await persist(new Set());
  }

  // Selected apps float to the top so the current blocklist is visible at a
  // glance, then alphabetical within each group.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? apps.filter(
          a =>
            a.label.toLowerCase().includes(q) ||
            a.packageName.toLowerCase().includes(q),
        )
      : apps;

    return [...filtered].sort((a, b) => {
      const aOn = blocked.has(a.packageName) ? 0 : 1;
      const bOn = blocked.has(b.packageName) ? 0 : 1;
      if (aOn !== bOn) {
        return aOn - bOn;
      }
      return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
    });
  }, [apps, blocked, query]);

  return (
    <View style={styles.root}>
      <Text style={styles.h1}>Blocked apps</Text>

      {!serviceOn ? (
        <TouchableOpacity
          style={styles.warning}
          onPress={Blocking.openAccessibilitySettings}>
          <Text style={styles.warningTitle}>Blocking is OFF</Text>
          <Text style={styles.warningBody}>
            The accessibility service is disabled, so nothing will be blocked.
            Android turns it off after every reinstall. Tap to fix.
          </Text>
        </TouchableOpacity>
      ) : null}

      {deviceOwner ? (
        <View style={styles.ownerOn}>
          <Text style={styles.ownerOnTitle}>Vanish mode active</Text>
          <Text style={styles.ownerOnBody}>
            Blocked apps disappear from your launcher during a session. No icon,
            no dialog, nothing to tap.
            {hiddenCount > 0 ? ` ${hiddenCount} hidden right now.` : ''}
          </Text>
          {hiddenCount > 0 ? (
            <TouchableOpacity
              onPress={async () => {
                await Blocking.restoreHiddenApps();
                recheckService();
              }}>
              <Text style={styles.ownerAction}>Restore all apps now ›</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <View style={styles.ownerOff}>
          <Text style={styles.ownerOffTitle}>Vanish mode off</Text>
          <Text style={styles.ownerOffBody}>
            Blocked apps are covered by a wall instead of disappearing. To make
            them vanish, run this once with the phone connected — it only works
            on a device with no Google account signed in:
          </Text>
          <Text selectable style={styles.code}>
            adb shell dpm set-device-owner{'\n'}
            com.tether/com.tether.admin.TetherDeviceAdmin
          </Text>
        </View>
      )}

      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Search apps…"
        placeholderTextColor="#484f58"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={styles.metaRow}>
        <Text style={styles.sub}>
          {loading ? 'Loading…' : `${blocked.size} blocked · ${apps.length} apps`}
        </Text>
        {blocked.size > 0 ? (
          <TouchableOpacity onPress={clearAll}>
            <Text style={styles.clear}>Clear all</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <FlatList
        data={visible}
        keyExtractor={item => item.packageName}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        ListEmptyComponent={
          loading ? null : <Text style={styles.empty}>No apps match.</Text>
        }
        renderItem={({item}) => {
          const on = blocked.has(item.packageName);
          const locked = protectedPkgs.has(item.packageName);
          return (
            <TouchableOpacity
              style={[styles.row, locked && styles.rowLocked]}
              disabled={locked}
              onPress={() => toggle(item.packageName)}>
              <Text style={[styles.check, on && styles.checkOn]}>
                {locked ? '—' : on ? '■' : '□'}
              </Text>
              <View style={styles.rowText}>
                <Text style={[styles.label, on && styles.labelOn]}>
                  {item.label}
                </Text>
                <Text style={styles.pkg}>
                  {locked ? 'Needed to use the phone' : item.packageName}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0d1117', padding: 20},
  h1: {color: '#fff', fontSize: 24, fontWeight: '800', marginBottom: 12},
  warning: {
    backgroundColor: '#3d1d1d',
    borderWidth: 1,
    borderColor: '#f85149',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  warningTitle: {color: '#f85149', fontWeight: '800', fontSize: 14},
  warningBody: {color: '#e6a1a1', fontSize: 12, marginTop: 4, lineHeight: 17},
  ownerOn: {
    backgroundColor: '#052e16',
    borderWidth: 1,
    borderColor: '#16a34a',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  ownerOnTitle: {color: '#4ade80', fontWeight: '800', fontSize: 13},
  ownerOnBody: {color: '#86efac', fontSize: 12, marginTop: 4, lineHeight: 17},
  ownerAction: {color: '#4ade80', fontSize: 12, fontWeight: '700', marginTop: 8},
  ownerOff: {
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  ownerOffTitle: {color: '#8b949e', fontWeight: '800', fontSize: 13},
  ownerOffBody: {color: '#6e7681', fontSize: 12, marginTop: 4, lineHeight: 17},
  code: {
    color: '#79c0ff',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 8,
    lineHeight: 16,
  },
  search: {
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 8,
    color: '#e6edf3',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  sub: {color: '#8b949e', fontSize: 12},
  clear: {color: '#1f6feb', fontSize: 12, fontWeight: '600'},
  empty: {color: '#6e7681', fontSize: 13, paddingTop: 20},
  row: {flexDirection: 'row', alignItems: 'center', paddingVertical: 10},
  rowLocked: {opacity: 0.45},
  rowText: {flex: 1},
  check: {color: '#8b949e', fontSize: 16, width: 28},
  checkOn: {color: '#1f6feb'},
  label: {color: '#e6edf3', fontSize: 15},
  labelOn: {fontWeight: '700'},
  pkg: {color: '#6e7681', fontSize: 11},
});
