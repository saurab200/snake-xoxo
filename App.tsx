import React, {useState} from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AuthFlow from './src/screens/AuthFlow';
import BlocklistScreen from './src/screens/BlocklistScreen';
import HomeScreen from './src/screens/HomeScreen';
import IntegrationsScreen from './src/screens/IntegrationsScreen';
import LeaderboardScreen from './src/screens/LeaderboardScreen';
import {useAuth} from './src/state/authStore';

type Tab = 'home' | 'blocklist' | 'integrations' | 'leaderboard';

const TABS: {id: Tab; label: string}[] = [
  {id: 'home', label: 'Focus'},
  {id: 'blocklist', label: 'Blocked'},
  {id: 'integrations', label: 'Apps'},
  {id: 'leaderboard', label: 'Rank'},
];

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const auth = useAuth();

  /**
   * The auth gate covers only the ACTIVITY's React tree.
   *
   * The overlays, the foreground service, blocking and the gamification
   * listeners are all started from index.js at module scope, so none of them
   * are affected by what this component returns. A signed-out user simply sees
   * the auth flow instead of the tabs.
   */
  if (!auth.initialized || !auth.isAuthenticated) {
    return (
      <>
        <StatusBar barStyle="light-content" backgroundColor="#0d1117" />
        <AuthFlow initializing={!auth.initialized} />
      </>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0d1117" />

      <View style={styles.body}>
        {tab === 'home' ? <HomeScreen /> : null}
        {tab === 'blocklist' ? <BlocklistScreen /> : null}
        {tab === 'integrations' ? <IntegrationsScreen /> : null}
        {tab === 'leaderboard' ? <LeaderboardScreen /> : null}
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
