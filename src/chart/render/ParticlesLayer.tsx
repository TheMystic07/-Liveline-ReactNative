import React from 'react';

import { Circle, Group } from '@shopify/react-native-skia';
import type { SharedValue } from 'react-native-reanimated';
import { useDerivedValue } from 'react-native-reanimated';

export interface ParticleSpec {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
}

type ParticleProps = {
  particle: ParticleSpec;
  burstLife: SharedValue<number>;
};

const Particle = React.memo(function Particle({ particle, burstLife }: ParticleProps) {
  const cx = useDerivedValue(() => {
    const frames = burstLife.value * 60;
    const disp = (particle.vx * (1 - Math.pow(0.95, frames))) / 0.05 / 60;
    return particle.x + disp;
  });

  const cy = useDerivedValue(() => {
    const frames = burstLife.value * 60;
    const disp = (particle.vy * (1 - Math.pow(0.95, frames))) / 0.05 / 60;
    return particle.y + disp;
  });

  const opacity = useDerivedValue(() => (1 - burstLife.value) * 0.55);
  const radius = useDerivedValue(
    () => particle.size * (0.5 + (1 - burstLife.value) * 0.5),
  );

  return <Circle cx={cx} cy={cy} r={radius} color={particle.color} opacity={opacity} />;
});

type ParticlesLayerProps = {
  enabled: boolean;
  particles: readonly ParticleSpec[];
  burstLife: SharedValue<number>;
  opacity: number | SharedValue<number>;
};

export function ParticlesLayer({
  enabled,
  particles,
  burstLife,
  opacity,
}: ParticlesLayerProps) {
  if (!enabled || particles.length === 0) return null;

  return (
    <Group opacity={opacity}>
      {particles.map((particle) => (
        <Particle key={particle.id} particle={particle} burstLife={burstLife} />
      ))}
    </Group>
  );
}
