import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {Overlay} from '../native';
import {getIntegration} from '../integrations/registry';
import {WidgetPayload} from '../integrations/types';

type Props = {
  integrationId?: string;
};

export const WIDGET_LAYOUT = {
  width: 260,
  height: 300,
  x: 12,
  y: 80,
  gravity: 'topRight' as const,
  touchThrough: true,
  focusable: false,
};

/**
 * PERSON C owns this file.
 *
 * Small floating card. It does not know anything about Canvas -- it just renders
 * whatever WidgetPayload the registered integration returns, so adding a second
 * integration later needs zero changes here.
 */
export default function WidgetOverlay({integrationId = 'canvas'}: Props) {
  const [payload, setPayload] = useState<WidgetPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const integration = getIntegration(integrationId);

    if (!integration) {
      setError(`No integration registered for "${integrationId}"`);
      return;
    }

    integration
      .fetchWidgetData()
      .then(data => !cancelled && setPayload(data))
      .catch(e => !cancelled && setError(e?.message ?? 'Fetch failed'));

    return () => {
      cancelled = true;
    };
  }, [integrationId]);

  const integration = getIntegration(integrationId);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{integration?.displayName ?? 'Widget'}</Text>
        <TouchableOpacity onPress={() => Overlay.hide('WidgetOverlay')}>
          <Text style={styles.close}>✕</Text>
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!payload && !error ? <ActivityIndicator color="#1f6feb" /> : null}

      {payload?.type === 'todoList' ? (
        <ScrollView>
          {payload.items.length === 0 ? (
            <Text style={styles.empty}>Nothing due. Go focus.</Text>
          ) : (
            payload.items.map(item => (
              <View key={item.id} style={styles.item}>
                <Text style={styles.itemTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                {item.subtitle ? (
                  <Text style={styles.itemSub}>{item.subtitle}</Text>
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: '#161b22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#30363d',
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {color: '#fff', fontWeight: '700', fontSize: 14},
  close: {color: '#8b949e', fontSize: 16, paddingHorizontal: 6},
  error: {color: '#f85149', fontSize: 12},
  empty: {color: '#8b949e', fontSize: 12},
  item: {
    borderTopWidth: 1,
    borderTopColor: '#21262d',
    paddingVertical: 8,
  },
  itemTitle: {color: '#e6edf3', fontSize: 13},
  itemSub: {color: '#8b949e', fontSize: 11, marginTop: 2},
});
