import React, {useCallback, useEffect, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {Overlay} from '../native';
import {
  getIntegration,
  listConnectors,
  syncTriggerPackages,
} from '../integrations/registry';
import {ConnectorMeta} from '../integrations/types';
import {TASK_CARD_LAYOUT} from '../overlays/TaskCardOverlay';
import {Storage} from '../state/storage';

/** PERSON 3 (Person C) owns this screen. */
export default function IntegrationsScreen() {
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [connecting, setConnecting] = useState<ConnectorMeta | null>(null);

  const refresh = useCallback(async () => {
    const next: Record<string, boolean> = {};
    for (const meta of listConnectors()) {
      const integration = getIntegration(meta.id);
      next[meta.id] = integration ? await integration.isConfigured() : false;
    }
    setConnected(next);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const connectors = listConnectors();
  const active = connectors.filter(c => connected[c.id]);
  const available = connectors.filter(c => !connected[c.id]);

  if (connecting) {
    return (
      <ConnectFlow
        connector={connecting}
        onDone={async () => {
          setConnecting(null);
          setAdding(false);
          await refresh();
        }}
        onCancel={() => setConnecting(null)}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.h1}>Apps</Text>
      <Text style={styles.caption}>
        Blocking clears the noise. These are what you clear it for — Tether
        pulls whatever you owe from each one into a single list.
      </Text>

      {active.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>CONNECTED</Text>
          {active.map(c => (
            <View key={c.id} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{c.displayName}</Text>
                <Text style={styles.rowBlurb}>{c.blurb}</Text>
              </View>
              <TouchableOpacity onPress={() => setConnecting(c)}>
                <Text style={styles.rowAction}>Edit</Text>
              </TouchableOpacity>
            </View>
          ))}
        </>
      ) : null}

      {!adding ? (
        <TouchableOpacity style={styles.addBtn} onPress={() => setAdding(true)}>
          <Text style={styles.addBtnText}>+  Add an app</Text>
        </TouchableOpacity>
      ) : (
        <>
          <Text style={styles.sectionLabel}>CHOOSE AN APP</Text>
          {available.map(c => (
            <TouchableOpacity
              key={c.id}
              style={[styles.row, !c.available && styles.rowDisabled]}
              disabled={!c.available}
              onPress={() => setConnecting(c)}>
              <View style={styles.rowText}>
                <Text
                  style={[
                    styles.rowTitle,
                    !c.available && styles.rowTitleDisabled,
                  ]}>
                  {c.displayName}
                </Text>
                <Text style={styles.rowBlurb}>{c.blurb}</Text>
              </View>
              <Text style={c.available ? styles.rowAction : styles.rowSoon}>
                {c.available ? 'Connect ›' : 'Soon'}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => setAdding(false)}>
            <Text style={styles.cancel}>Cancel</Text>
          </TouchableOpacity>
        </>
      )}

      <TouchableOpacity
        style={styles.preview}
        onPress={() =>
          Overlay.show('TaskCardOverlay', TASK_CARD_LAYOUT, {
            nonce: Date.now(),
          })
        }>
        <Text style={styles.previewText}>Preview task card</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

/**
 * Per-connector sign-in. Canvas is the only one with a real flow; the rest are
 * listed as unavailable, so this never renders for them.
 */
function ConnectFlow({
  connector,
  onDone,
  onCancel,
}: {
  connector: ConnectorMeta;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [host, setHost] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setHost((await Storage.getCanvasHost()) ?? '');
      setToken((await Storage.getCanvasToken()) ?? '');
    })();
  }, []);

  if (connector.id !== 'canvas') {
    // Nothing to configure; connectors like Focus stats work out of the box.
    return (
      <ScrollView contentContainerStyle={styles.root}>
        <Text style={styles.h1}>{connector.displayName}</Text>
        <Text style={styles.caption}>{connector.blurb}</Text>
        <Text style={styles.caption}>Nothing to set up — it just works.</Text>
        <TouchableOpacity style={styles.save} onPress={onDone}>
          <Text style={styles.saveText}>Done</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  async function save() {
    if (!host.trim() || !token.trim()) {
      setError('Both the host and a token are needed.');
      return;
    }
    await Storage.setCanvasHost(host.trim());
    await Storage.setCanvasToken(token.trim());
    await syncTriggerPackages();
    onDone();
  }

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.h1}>Connect Canvas</Text>

      <Text style={styles.label}>HOST</Text>
      <TextInput
        style={styles.input}
        value={host}
        onChangeText={t => {
          setHost(t);
          setError(null);
        }}
        placeholder="https://your-school.instructure.com"
        placeholderTextColor="#484f58"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>ACCESS TOKEN</Text>
      <Text style={styles.hint}>
        Canvas → Account → Settings → + New Access Token. It is stored on this
        device only.
      </Text>
      <TextInput
        style={styles.input}
        value={token}
        onChangeText={t => {
          setToken(t);
          setError(null);
        }}
        placeholder="paste token"
        placeholderTextColor="#484f58"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.save} onPress={save}>
        <Text style={styles.saveText}>Connect</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onCancel}>
        <Text style={styles.cancel}>Cancel</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {padding: 20, backgroundColor: '#0d1117', flexGrow: 1},
  h1: {color: '#fff', fontSize: 24, fontWeight: '800'},
  caption: {color: '#6e7681', fontSize: 13, lineHeight: 19, marginTop: 8},
  sectionLabel: {
    color: '#4ade80',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  rowDisabled: {opacity: 0.55},
  rowText: {flex: 1},
  rowTitle: {color: '#e6edf3', fontSize: 16, fontWeight: '700'},
  rowTitleDisabled: {color: '#8b949e'},
  rowBlurb: {color: '#6e7681', fontSize: 12, marginTop: 2},
  rowAction: {color: '#4ade80', fontSize: 13, fontWeight: '700'},
  rowSoon: {color: '#6e7681', fontSize: 12, fontWeight: '600'},
  addBtn: {
    borderWidth: 1,
    borderColor: '#16a34a',
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 22,
  },
  addBtnText: {color: '#4ade80', fontSize: 15, fontWeight: '700'},
  label: {
    color: '#4ade80',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 22,
  },
  hint: {color: '#6e7681', fontSize: 12, marginTop: 4, lineHeight: 17},
  input: {
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 8,
    color: '#e6edf3',
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginTop: 8,
  },
  error: {color: '#f85149', fontSize: 12, marginTop: 12},
  save: {
    backgroundColor: '#16a34a',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 24,
  },
  saveText: {color: '#fff', fontSize: 16, fontWeight: '700'},
  cancel: {
    color: '#6e7681',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 16,
  },
  preview: {
    marginTop: 30,
    paddingVertical: 12,
    alignItems: 'center',
  },
  previewText: {color: '#6e7681', fontSize: 13, fontWeight: '600'},
});
