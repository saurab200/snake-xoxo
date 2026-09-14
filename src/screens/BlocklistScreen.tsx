import React, {useEffect, useState} from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {Blocking, Focus, InstalledApp} from '../native';
import {Storage} from '../state/storage';

/** PERSON B owns this screen. */
export default function BlocklistScreen() {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

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

  async function persist(next: Set<string>) {
    const list = [...next];
    await Storage.setBlocklist(list);
    await Focus.setBlocklist(list); // takes effect mid-session
  }

  async function toggle(pkg: string) {
    const next = new Set(blocked);
    if (next.has(pkg)) {
      next.delete(pkg);
    } else {
      next.add(pkg);
    }
    setBlocked(next);
    await persist(next);
  }

  return (
    <View style={styles.root}>
      <Text style={styles.h1}>Blocked apps</Text>
      <Text style={styles.sub}>
        {loading ? 'Loading…' : `${blocked.size} selected`}
      </Text>

      <FlatList
        data={apps}
        keyExtractor={item => item.packageName}
        renderItem={({item}) => {
          const on = blocked.has(item.packageName);
          return (
            <TouchableOpacity
              style={styles.row}
              onPress={() => toggle(item.packageName)}>
              <Text style={[styles.check, on && styles.checkOn]}>
                {on ? '■' : '□'}
              </Text>
              <View style={styles.rowText}>
                <Text style={styles.label}>{item.label}</Text>
                <Text style={styles.pkg}>{item.packageName}</Text>
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
  h1: {color: '#fff', fontSize: 24, fontWeight: '800'},
  sub: {color: '#8b949e', fontSize: 12, marginBottom: 14},
  row: {flexDirection: 'row', alignItems: 'center', paddingVertical: 10},
  rowText: {flex: 1},
  check: {color: '#8b949e', fontSize: 16, width: 28},
  checkOn: {color: '#1f6feb'},
  label: {color: '#e6edf3', fontSize: 15},
  pkg: {color: '#6e7681', fontSize: 11},
});
