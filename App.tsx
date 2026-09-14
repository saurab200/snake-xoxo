import React, {useState} from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import BlocklistScreen from './src/screens/BlocklistScreen';
import HomeScreen from './src/screens/HomeScreen';
import IntegrationsScreen from './src/screens/IntegrationsScreen';
import {useWidgetTrigger} from './src/state/useWidgetTrigger';

type Tab = 'home' | 'blocklist' | 'integrations';

const TABS: {id: Tab; label: string}[] = [
  {id: 'home', label: 'Focus'},
  {id: 'blocklist', label: 'Blocked'},
  {id: 'integrations', label: 'Apps'},
];

export default function App() {
  const [tab, setTab] = useState<Tab>('home');

  // B -> C seam. Mounted once, for the whole app.
  useWidgetTrigger();

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0d1117" />

      <View style={styles.body}>
        {tab === 'home' ? <HomeScreen /> : null}
        {tab === 'blocklist' ? <BlocklistScreen /> : null}
        {tab === 'integrations' ? <IntegrationsScreen /> : null}
      </View>

      <View style={styles.tabBar}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.id}
            style={styles.tab}
            onPress={() => setTab(t.id)}>
            <Text style={[styles.tabText, tab === t.id && styles.tabActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0d1117'},
  body: {flex: 1},
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#21262d',
    backgroundColor: '#161b22',
  },
  tab: {flex: 1, paddingVertical: 14, alignItems: 'center'},
  tabText: {color: '#6e7681', fontWeight: '600'},
  tabActive: {color: '#1f6feb'},
});
