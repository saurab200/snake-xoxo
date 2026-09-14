import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {Overlay} from '../native';
import {cachedPayload, invalidate, loadWidgetData} from '../integrations/cache';
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

/** Collapsed pill, so the card can be got out of the way without dismissing it. */
export const WIDGET_LAYOUT_COLLAPSED = {
  width: 130,
  height: 44,
  x: 12,
  y: 80,
  gravity: 'topRight' as const,
  touchThrough: true,
  focusable: false,
};

/**
 * PERSON 3 (Person C) owns this file.
 *
 * Small floating card. It knows nothing about Canvas -- it renders whatever
 * WidgetPayload the registered integration returns, so adding a second
 * integration needs zero changes here.
 */
export default function WidgetOverlay({integrationId = 'canvas'}: Props) {
  const integration = getIntegration(integrationId);

  // Seed from cache so returning to the app paints instantly instead of
  // flashing a spinner at data we already have.
  const [payload, setPayload] = useState<WidgetPayload | null>(() =>
    cachedPayload(integrationId),
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(
    async (force: boolean) => {
      if (!integration) {
        setError(`No integration registered for "${integrationId}"`);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        if (force) {
          invalidate(integration.id);
        }
        setPayload(await loadWidgetData(integration, {force}));
      } catch (e) {
        setError((e as Error)?.message ?? 'Something went wrong.');
      } finally {
        setLoading(false);
      }
    },
    [integration, integrationId],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  async function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    // setLayout resizes the window without remounting, so state survives.
    await Overlay.setLayout(
      'WidgetOverlay',
      next ? WIDGET_LAYOUT_COLLAPSED : WIDGET_LAYOUT,
    );
  }

  if (collapsed) {
    return (
      <TouchableOpacity style={styles.pill} onPress={toggleCollapsed}>
        <Text style={styles.pillText} numberOfLines={1}>
          {integration?.displayName ?? 'Widget'}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {integration?.displayName ?? 'Widget'}
        </Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => load(true)} hitSlop={HIT}>
            <Text style={styles.action}>↻</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleCollapsed} hitSlop={HIT}>
            <Text style={styles.action}>—</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => Overlay.hide('WidgetOverlay')}
            hitSlop={HIT}>
            <Text style={styles.action}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* error state -- distinct from empty, and always recoverable */}
      {error ? (
        <View style={styles.centered}>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity style={styles.retry} onPress={() => load(true)}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* loading, only when we have nothing to show yet */}
      {!error && loading && !payload ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#1f6feb" />
        </View>
      ) : null}

      {!error && payload?.type === 'text' ? (
        <Text style={styles.body}>{payload.body}</Text>
      ) : null}

      {!error && payload?.type === 'todoList' ? (
        payload.items.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.empty}>Nothing due.</Text>
            <Text style={styles.emptySub}>Go focus.</Text>
          </View>
        ) : (
          <ScrollView>
            {payload.items.map(item => (
              <View key={item.id} style={styles.item}>
                <Text style={styles.itemTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                {item.subtitle ? (
                  <Text style={styles.itemSub} numberOfLines={1}>
                    {item.subtitle}
                  </Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
        )
      ) : null}
    </View>
  );
}

const HIT = {top: 8, bottom: 8, left: 8, right: 8};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: '#161b22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#30363d',
    padding: 12,
  },
  pill: {
    flex: 1,
    backgroundColor: '#161b22',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#30363d',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  pillText: {color: '#e6edf3', fontSize: 12, fontWeight: '600'},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerActions: {flexDirection: 'row', gap: 12},
  title: {color: '#fff', fontWeight: '700', fontSize: 14, flex: 1},
  action: {color: '#8b949e', fontSize: 15},
  centered: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  error: {color: '#f85149', fontSize: 12, textAlign: 'center'},
  retry: {
    marginTop: 10,
    backgroundColor: '#21262d',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 6,
  },
  retryText: {color: '#e6edf3', fontSize: 12, fontWeight: '600'},
  body: {color: '#8b949e', fontSize: 12, lineHeight: 18},
  empty: {color: '#e6edf3', fontSize: 14, fontWeight: '600'},
  emptySub: {color: '#6e7681', fontSize: 12, marginTop: 2},
  item: {borderTopWidth: 1, borderTopColor: '#21262d', paddingVertical: 8},
  itemTitle: {color: '#e6edf3', fontSize: 13},
  itemSub: {color: '#8b949e', fontSize: 11, marginTop: 2},
});
