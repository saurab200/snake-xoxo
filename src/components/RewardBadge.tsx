import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

/**
 * A single snake-skin reward chip.
 *
 * Three visual states:
 *  - locked   -> dimmed, shows the points needed and a lock glyph
 *  - unlocked -> full colour, tappable to select
 *  - active   -> unlocked + a highlighted ring and a check
 *
 * React Native primitives only; no icon library (the project ships none).
 */

export type RewardBadgeProps = {
  name: string;
  color: string;
  requiredPoints: number;
  unlocked: boolean;
  active: boolean;
  /** Called only when the badge is unlocked. */
  onSelect?: () => void;
};

export default function RewardBadge({
  name,
  color,
  requiredPoints,
  unlocked,
  active,
  onSelect,
}: RewardBadgeProps) {
  // Skin colours are data, so these have to be computed rather than static.
  const activeRing = {borderColor: color};
  const dotFill = {backgroundColor: unlocked ? color : '#30363d'};
  const activeText = {color};

  return (
    <TouchableOpacity
      activeOpacity={unlocked ? 0.7 : 1}
      disabled={!unlocked}
      onPress={unlocked ? onSelect : undefined}
      style={[
        styles.badge,
        active && styles.badgeActive,
        active && activeRing,
        !unlocked && styles.locked,
      ]}>
      <View style={[styles.dot, dotFill]}>
        <Text style={styles.snake}>{unlocked ? '🐍' : '🔒'}</Text>
      </View>

      <Text style={[styles.name, !unlocked && styles.mutedText]}>{name}</Text>

      {active ? (
        <Text style={[styles.status, activeText]}>Active ✓</Text>
      ) : unlocked ? (
        <Text style={styles.status}>Unlocked</Text>
      ) : (
        <Text style={styles.mutedText}>{requiredPoints} pts</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  badge: {
    flex: 1,
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 6,
  },
  badgeActive: {borderWidth: 2},
  locked: {opacity: 0.55},
  dot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snake: {fontSize: 16},
  name: {color: '#e6edf3', fontSize: 13, fontWeight: '700'},
  status: {color: '#8b949e', fontSize: 11, fontWeight: '600'},
  mutedText: {color: '#6e7681', fontSize: 11, fontWeight: '600'},
});
