import { Circle, Group, Shadow } from '@shopify/react-native-skia';
import { memo } from 'react';

type LiveDotLayerProps = {
  revealOpacity: number | any;
  liveX: number | any;
  liveY: number | any;
  glowEnabled: boolean;
  glowColor: string;
  outerColor: string;
  outerShadow: string;
  innerColor: string;
};

function LiveDotLayerImpl({
  revealOpacity,
  liveX,
  liveY,
  glowEnabled,
  glowColor,
  outerColor,
  outerShadow,
  innerColor,
}: LiveDotLayerProps) {
  return (
    <Group opacity={revealOpacity}>
      {glowEnabled ? (
        <Circle cx={liveX} cy={liveY} r={12} color={glowColor} opacity={0.75} />
      ) : null}

      <Circle cx={liveX} cy={liveY} r={6.5} color={outerColor}>
        <Shadow dx={0} dy={1} blur={6} color={outerShadow} />
      </Circle>

      <Circle cx={liveX} cy={liveY} r={3.5} color={innerColor} />
    </Group>
  );
}

export const LiveDotLayer = memo(LiveDotLayerImpl);
