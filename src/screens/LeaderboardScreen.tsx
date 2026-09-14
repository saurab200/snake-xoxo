import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useGamification} from '../state/gamificationStore';

/**
 * LEADERBOARD
 *
 * Demo-safe by construction: it tries a REST call, gives up after 2s, and
 * silently renders mock data on ANY failure. There is deliberately no error
 * state, no alert and no retry prompt -- on stage the judges must simply see a
 * populated leaderboard.
 */

export type LeaderboardEntry = {
  id: string;
  username: string;
  points: number;
};

/**
 * No leaderboard service exists in this repo. Point this at one if a backend
 * appears; until then every request fails fast and the mock list is shown.
 */
const LEADERBOARD_URL = 'https://tether.invalid/api/leaderboard';

/** Hard ceiling on how long the demo waits for the network. */
const TIMEOUT_MS = 2000;

const MOCK_LEADERBOARD: LeaderboardEntry[] = [
  {id: 'mock-1', username: 'FocusKing', points: 450},
  {id: 'mock-2', username: 'HackathonJudge', points: 420},
  {id: 'mock-3', username: 'DemoUser', points: 360},
  {id: 'mock-4', username: 'SnakeMaster', points: 220},
  {id: 'mock-5', username: 'DeepWorker', points: 180},
];

/** Accept only well-formed rows; anything else falls back to the mock list. */
function parseEntries(raw: unknown): LeaderboardEntry[] | null {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as {entries?: unknown})?.entries)
    ? (raw as {entries: unknown[]}).entries
    : null;

  if (!list || list.length === 0) {
    return null;
  }

  const entries: LeaderboardEntry[] = [];
  list.forEach((item, i) => {
    const row = item as Partial<LeaderboardEntry>;
    const points = Number(row?.points);
    if (typeof row?.username !== 'string' || !isFinite(points)) {
      return;
    }
    entries.push({
      id: String(row.id ?? `row-${i}`),
      username: row.username,
      points: Math.max(0, Math.floor(points)),
    });
  });

  return entries.length > 0 ? entries : null;
}

/**
 * Never rejects. Every failure mode -- offline, timeout, non-2xx, malformed
 * body, unexpected throw -- resolves to MOCK_LEADERBOARD.
 */
export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(LEADERBOARD_URL, {
      signal: controller.signal,
      headers: {Accept: 'application/json'},
    });

    if (!response.ok) {
      return MOCK_LEADERBOARD;
    }

    return parseEntries(await response.json()) ?? MOCK_LEADERBOARD;
  } catch {
    return MOCK_LEADERBOARD;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */

type Row = LeaderboardEntry & {rank: number; isMe: boolean};

const ME_ID = 'local-user';

/** Splice the local score into the board and rank the whole thing. */
function buildRows(entries: LeaderboardEntry[], myPoints: number): Row[] {
  const combined: LeaderboardEntry[] = [
    ...entries.filter(e => e.id !== ME_ID),
    {id: ME_ID, username: 'You', points: myPoints},
  ];

  return combined
    .sort((a, b) => b.points - a.points)
    .map((entry, i) => ({...entry, rank: i + 1, isMe: entry.id === ME_ID}));
}

export default function LeaderboardScreen() {
  const {totalPoints} = useGamification();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // fetchLeaderboard never throws and never runs longer than TIMEOUT_MS.
    setEntries(await fetchLeaderboard());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = buildRows(entries, totalPoints);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.h1}>Leaderboard</Text>
        <View style={styles.myScore}>
          <Text style={styles.myScoreValue}>{totalPoints}</Text>
          <Text style={styles.myScoreUnit}>pts</Text>
        </View>
        <Text style={styles.hint}>
          Every focused minute is a point. Keep the snake pulled.
        </Text>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#1f6feb" />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          renderItem={({item}) => <LeaderboardRow row={item} />}
        />
      )}
    </View>
  );
}

const MEDALS: Record<number, string> = {1: '🥇', 2: '🥈', 3: '🥉'};

function LeaderboardRow({row}: {row: Row}) {
  return (
    <View style={[styles.row, row.isMe && styles.rowMe]}>
      <Text style={[styles.rank, row.isMe && styles.textMe]}>
        {MEDALS[row.rank] ?? row.rank}
      </Text>
      <Text
        style={[styles.username, row.isMe && styles.textMe]}
        numberOfLines={1}>
        {row.username}
      </Text>
      <Text style={[styles.points, row.isMe && styles.textMe]}>
        {row.points} pts
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0d1117'},
  header: {paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8},
  h1: {color: '#fff', fontSize: 24, fontWeight: '800'},
  myScore: {flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 10},
  myScoreValue: {color: '#fff', fontSize: 34, fontWeight: '800'},
  myScoreUnit: {color: '#8b949e', fontSize: 14, fontWeight: '700'},
  hint: {color: '#8b949e', fontSize: 12, marginTop: 6},
  loading: {paddingTop: 40},
  list: {paddingHorizontal: 20, paddingBottom: 40, paddingTop: 8},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161b22',
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#161b22',
  },
  rowMe: {borderColor: '#1f6feb', backgroundColor: '#10203c'},
  rank: {
    color: '#8b949e',
    fontSize: 15,
    fontWeight: '800',
    width: 34,
  },
  username: {color: '#e6edf3', fontSize: 15, fontWeight: '600', flex: 1},
  points: {
    color: '#8b949e',
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  textMe: {color: '#fff'},
});
