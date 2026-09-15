import React, {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';

/**
 * Tether's brand mark: a small coiled snake.
 *
 * PURELY DECORATIVE. It shares no code, state or gesture handling with
 * SnakeOverlay -- the real snake is the product's core interaction and is left
 * completely alone. This is a static spiral of dots, drawn with plain Views so
 * no image asset or icon dependency is needed.
 */

type Props = {
  /** Diameter of the mark in dp. */
  size?: number;
  color?: string;
};

/**
 * Walk a spiral by constant ARC LENGTH rather than constant angle, so the body
 * spaces evenly instead of bunching near the centre. Ratios are taken from the
 * real snake's geometry so the mark reads as the same creature.
 */
function buildCoil(radius: number) {
  const arcStep = radius * 0.184;
  const growthPerRadian = radius * 0.082;

  const raw: {x: number; y: number}[] = [];
  let theta = 0;
  let r = radius * 0.21;

  while (r < radius && raw.length < 26) {
    raw.push({x: r * Math.cos(theta), y: r * Math.sin(theta)});
    const dTheta = arcStep / r;
    theta += dTheta;
    r += growthPerRadian * dTheta;
  }

  const n = raw.length;
  return raw.map((p, i) => ({...p, t: n > 1 ? i / (n - 1) : 0}));
}

export default function SnakeMark({size = 76, color = '#22c55e'}: Props) {
  const radius = size / 2;
  const coil = useMemo(() => buildCoil(radius), [radius]);

  const headSize = Math.max(10, size * 0.26);
  const tailSize = Math.max(3, size * 0.07);

  return (
    <View
      style={[styles.root, {width: size, height: size}]}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Medusa">
      {coil.map((seg, i) => {
        const isHead = i === 0;
        const dotSize = headSize - (headSize - tailSize) * seg.t;
        return (
          <View
            key={i}
            style={[
              styles.dot,
              {
                width: dotSize,
                height: dotSize,
                borderRadius: dotSize / 2,
                backgroundColor: color,
                opacity: 1 - seg.t * 0.25,
                marginLeft: -dotSize / 2,
                marginTop: -dotSize / 2,
                transform: [{translateX: seg.x}, {translateY: seg.y}],
                zIndex: coil.length - i,
              },
            ]}>
            {isHead ? (
              <View style={styles.face}>
                <View style={[styles.eye, {width: dotSize * 0.17, height: dotSize * 0.17}]} />
                <View style={[styles.eye, {width: dotSize * 0.17, height: dotSize * 0.17}]} />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {alignItems: 'center', justifyContent: 'center'},
  dot: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#14532d',
  },
  face: {flexDirection: 'row', gap: 3},
  eye: {borderRadius: 4, backgroundColor: '#f0fdf4'},
});
