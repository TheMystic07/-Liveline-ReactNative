import { memo } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Canvas, Group, Path, Shadow } from '@shopify/react-native-skia';
import type { SkFont } from '@shopify/react-native-skia';
import Animated from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';

import { BadgeSkiaNumberFlow } from '../BadgeSkiaNumberFlow';
import { BADGE_PAD_X, BADGE_TAIL_LEN } from '../draw/badge';
import type { BadgeVariant, ChartPalette } from '../types';

type BadgeOverlayProps = {
  badge: boolean;
  empty: boolean;
  variant: BadgeVariant;
  skiaBadgeFlow: boolean;
  badgeFlowA11yLabel?: string;
  badgeNumFont: SkFont | null;
  badgeValue: SharedValue<number>;
  flowPillW: number;
  badgeStr: string;
  badgeStyle: object;
  badgeTextWrapStyle: object;
  backgroundPath: string | SharedValue<string>;
  innerPath: string | SharedValue<string>;
  innerColor: string | SharedValue<string>;
  pillH: number;
  onBadgeTemplateLayout: (e: { nativeEvent: { layout: { width: number } } }) => void;
  pal: Pick<ChartPalette, 'badgeOuterBg' | 'badgeOuterShadow' | 'badgeText' | 'tooltipText'>;
  badgeTextStyle: object;
};

function BadgeOverlayImpl({
  badge,
  empty,
  variant,
  skiaBadgeFlow,
  badgeFlowA11yLabel,
  badgeNumFont,
  badgeValue,
  flowPillW,
  badgeStr,
  badgeStyle,
  badgeTextWrapStyle,
  backgroundPath,
  innerPath,
  innerColor,
  pillH,
  onBadgeTemplateLayout,
  pal,
  badgeTextStyle,
}: BadgeOverlayProps) {
  if (!badge) return null;
  const minimal = variant === 'minimal';
  const textColor = minimal ? pal.tooltipText : pal.badgeText;
  const showRollingValue = skiaBadgeFlow && badgeNumFont != null;

  return (
    <>
      {!empty ? (
        <Text
          pointerEvents="none"
          onLayout={onBadgeTemplateLayout}
          style={[badgeTextStyle, styles.badgeMeasureGhost]}
        >
          {badgeStr.replace(/[0-9]/g, '8')}
        </Text>
      ) : null}

      <Animated.View pointerEvents="none" style={[styles.badgeWrap, badgeStyle]}>
        <Canvas
          style={StyleSheet.absoluteFill}
          accessible={showRollingValue}
          accessibilityLabel={showRollingValue ? badgeFlowA11yLabel : undefined}
        >
          <Path path={backgroundPath} color={pal.badgeOuterBg}>
            <Shadow dx={0} dy={2} blur={8} color={pal.badgeOuterShadow} />
          </Path>
          {!minimal ? (
            <Group transform={[{ translateX: 2 }, { translateY: 2 }]}>
              <Path path={innerPath} color={innerColor} />
            </Group>
          ) : null}
          {showRollingValue ? (
            <BadgeSkiaNumberFlow
              svTipV={badgeValue}
              font={badgeNumFont}
              color={textColor}
              pillBodyWidth={flowPillW}
            />
          ) : null}
        </Canvas>

        {!showRollingValue ? (
          <Animated.View
            style={[
              styles.badgeTextWrap,
              { height: pillH, left: BADGE_TAIL_LEN + 2, right: BADGE_PAD_X - 1 },
              badgeTextWrapStyle,
            ]}
          >
            <Text style={[badgeTextStyle, { color: textColor }]} numberOfLines={1}>
              {badgeStr}
            </Text>
          </Animated.View>
        ) : null}
      </Animated.View>
    </>
  );
}

export const BadgeOverlay = memo(BadgeOverlayImpl);

const styles = StyleSheet.create({
  badgeWrap: { position: 'absolute', overflow: 'visible' },
  badgeTextWrap: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  badgeMeasureGhost: {
    position: 'absolute',
    left: -4000,
    top: 0,
    opacity: 0,
  },
});
