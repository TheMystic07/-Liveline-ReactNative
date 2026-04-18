import {
  Group,
  LinearGradient,
  Path,
  vec,
} from '@shopify/react-native-skia';
import type { SharedValue } from 'react-native-reanimated';

type LinePathLayerProps = {
  clipRect: any;
  leftClip: any;
  rightClip: any;
  rightOpacity: number | SharedValue<number>;
  revealOpacity: number | SharedValue<number>;
  path: string | SharedValue<string>;
  layoutHeight: number;
  padTop: number;
  padRight: number;
  layoutWidth: number;
  lineWidth: number;
  lineColor: string | SharedValue<string>;
  trailGlow: boolean;
  trailGlowColor: string;
  gradientLineColoring: boolean;
  gradientStartColor: string;
  gradientEndColor: string;
};

export function LinePathLayer({
  clipRect,
  leftClip,
  rightClip,
  rightOpacity,
  revealOpacity,
  path,
  layoutHeight,
  padTop,
  padRight,
  layoutWidth,
  lineWidth,
  lineColor,
  trailGlow,
  trailGlowColor,
  gradientLineColoring,
  gradientStartColor,
  gradientEndColor,
}: LinePathLayerProps) {
  if (!clipRect) return null;

  return (
    <Group clip={clipRect} opacity={revealOpacity}>
      {trailGlow ? (
        <Path
          path={path}
          style="stroke"
          strokeWidth={lineWidth + 4}
          strokeJoin="round"
          strokeCap="round"
          color={trailGlowColor}
          opacity={0.5}
        />
      ) : null}

      <Group clip={leftClip}>
        <Path
          path={path}
          style="stroke"
          strokeWidth={lineWidth}
          strokeJoin="round"
          strokeCap="round"
          color={gradientLineColoring ? undefined : lineColor}
        >
          {gradientLineColoring ? (
            <LinearGradient
              start={vec(0, padTop)}
              end={vec(layoutWidth - padRight, layoutHeight)}
              colors={[gradientStartColor, gradientEndColor]}
            />
          ) : null}
        </Path>
      </Group>

      <Group clip={rightClip} opacity={rightOpacity}>
        <Path
          path={path}
          style="stroke"
          strokeWidth={lineWidth}
          strokeJoin="round"
          strokeCap="round"
          color={gradientLineColoring ? undefined : lineColor}
        >
          {gradientLineColoring ? (
            <LinearGradient
              start={vec(0, padTop)}
              end={vec(layoutWidth - padRight, layoutHeight)}
              colors={[gradientStartColor, gradientEndColor]}
            />
          ) : null}
        </Path>
      </Group>
    </Group>
  );
}
