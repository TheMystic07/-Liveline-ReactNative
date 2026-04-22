import {
  Group,
  LinearGradient,
  Path,
  vec,
} from '@shopify/react-native-skia';
import { memo } from 'react';
import {
  useAnimatedReaction,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

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
  rangeScaleY: SharedValue<number>;
  rangeTranslateY: SharedValue<number>;
  tipPath?: SharedValue<string>;
};

type RangeTransform = Array<{ translateY: number } | { scaleY: number }>;

function LinePathLayerImpl({
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
  rangeScaleY,
  rangeTranslateY,
  tipPath,
}: LinePathLayerProps) {
  const rangeTransform = useSharedValue<RangeTransform>([
    { translateY: 0 },
    { scaleY: 1 },
  ]);

  useAnimatedReaction(
    () => ({
      translateY: rangeTranslateY.value,
      scaleY: rangeScaleY.value,
    }),
    ({ translateY, scaleY }) => {
      rangeTransform.value = [{ translateY }, { scaleY }];
    },
    [rangeTranslateY, rangeScaleY],
  );

  if (!clipRect) return null;

  return (
    <Group clip={clipRect} opacity={revealOpacity}>
      <Group transform={rangeTransform}>
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
      {tipPath ? (
        <Path
          path={tipPath}
          style="stroke"
          strokeWidth={lineWidth}
          strokeJoin="round"
          strokeCap="round"
          color={gradientLineColoring ? gradientEndColor : (lineColor as string)}
        />
      ) : null}
    </Group>
  );
}

export const LinePathLayer = memo(LinePathLayerImpl);
