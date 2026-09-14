import React, {useEffect, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {Overlay} from '../native';
import {listIntegrations, syncTriggerPackages} from '../integrations/registry';
import {WIDGET_LAYOUT} from '../overlays/WidgetOverlay';
import {Storage} from '../state/storage';

/** PERSON C owns this screen. */
export default function IntegrationsScreen() {
  const [host, setHost] = useState('');
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      setHost((await Storage.getCanvasHost()) ?? '');
      setToken((await Storage.getCanvasToken()) ?? '');
    })();
  }, []);

  async function save() {
    await Storage.setCanvasHost(host.trim());
    await Storage.setCanvasToken(token.trim());
    await syncTriggerPackages();
    setSaved(true);
  }

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.h1}>Integrations</Text>

      <View style={styles.card}>
        <Text style={styles.h2}>Canvas</Text>
        <Text style={styles.hint}>
          Host, e.g. https://canvas.instructure.com
        </Text>
        <TextInput
          style={styles.input}
          value={host}
          onChangeText={t => {
            setHost(t);
            setSaved(false);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://your-school.instructure.com"
          placeholderTextColor="#484f58"
        />

        <Text style={styles.hint}>
          Access token — Canvas → Account → Settings → New Access Token
        </Text>
        <TextInput
          style={styles.input}
          value={token}
          onChangeText={t => {
            setToken(t);
            setSaved(false);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder="paste token"
          placeholderTextColor="#484f58"
        />

        <TouchableOpacity style={styles.button} onPress={save}>
          <Text style={styles.buttonText}>{saved ? 'Saved ✓' : 'Save'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.muted]}
          onPress={() =>
            Overlay.show('WidgetOverlay', WIDGET_LAYOUT, {
              integrationId: 'canvas',
            })
          }>
          <Text style={styles.buttonText}>Test widget</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.h2}>Registered</Text>
        {listIntegrations().map(i => (
          <Text key={i.id} style={styles.listItem}>
            {i.displayName} — triggers on {i.triggerPackages.join(', ')}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {padding: 20, backgroundColor: '#0d1117', flexGrow: 1},
  h1: {color: '#fff', fontSize: 24, fontWeight: '800', marginBottom: 16},
  h2: {color: '#e6edf3', fontSize: 16, fontWeight: '700', marginBottom: 10},
  card: {
    backgroundColor: '#161b22',
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
  },
  hint: {color: '#8b949e', fontSize: 11, marginBottom: 4, marginTop: 8},
  input: {
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 6,
    color: '#e6edf3',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  button: {
    backgroundColor: '#1f6feb',
    paddingVertical: 11,
    borderRadius: 8,
    marginTop: 12,
  },
  muted: {backgroundColor: '#21262d'},
  buttonText: {color: '#fff', fontWeight: '600', textAlign: 'center'},
  listItem: {color: '#8b949e', fontSize: 12, paddingVertical: 3},
});
