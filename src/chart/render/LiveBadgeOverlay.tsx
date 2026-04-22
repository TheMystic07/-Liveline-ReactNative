import { useCallback, useEffect, useState } from 'react';
import type { SkFont } from '@shopify/react-native-skia';
import { runOnJS, useAnimatedReaction, type SharedValue } from 'react-native-reanimated';

import { BadgeOverlay } from './BadgeOverlay';
import type { BadgeVariant, ChartPalette } from '../types';

type LiveBadgeOverlayProps = {
  badge: boolean;
  empty: boolean;
  variant: BadgeVariant;
  skiaBadgeFlow: boolean;
  badgeFlowA11yLabel?: string;
  badgeNumFont: SkFont | null;
  badgeValue: SharedValue<number>;
  badgePillWidth: SharedValue<number>;
  badgeTargetTextW: SharedValue<number>;
  badgeLastJsFlush?: SharedValue<number>;
  badgeQuantMul: number;
  formatValue: (v: number) => string;
  effectiveValue: number;
  badgeStyle: object;
  badgeTextWrapStyle: object;
  backgroundPath: string | SharedValue<string>;
  innerPath: string | SharedValue<string>;
  innerColor: string | SharedValue<string>;
  pillH: number;
  pal: Pick<ChartPalette, 'badgeOuterBg' | 'badgeOuterShadow' | 'badgeText' | 'tooltipText'>;
  badgeTextStyle: object;
};

export function LiveBadgeOverlay({
  badge,
  empty,
  variant,
  skiaBadgeFlow,
  badgeFlowA11yLabel,
  badgeNumFont,
  badgeValue,
  badgePillWidth,
  badgeTargetTextW,
  badgeLastJsFlush,
  badgeQuantMul,
  formatValue,
  effectiveValue,
  badgeStyle,
  badgeTextWrapStyle,
  backgroundPath,
  innerPath,
  innerColor,
  pillH,
  pal,
  badgeTextStyle,
}: LiveBadgeOverlayProps) {
  const [flowPillW, setFlowPillW] = useState(80);
  const [badgeStr, setBadgeStr] = useState(() => formatValue(effectiveValue));

  useEffect(() => {
    setBadgeStr(formatValue(effectiveValue));
  }, [effectiveValue, formatValue]);

  const setFlowPillWStable = useCallback((w: number) => {
    setFlowPillW((prev) => (prev === w ? prev : w));
  }, []);

  useAnimatedReaction(
    () => Math.round(badgePillWidth.value),
    (w, prev) => {
      'worklet';
      if (prev !== undefined && w === prev) return;
      runOnJS(setFlowPillWStable)(w);
    },
    [setFlowPillWStable, badgePillWidth],
  );

  const setBadgeFromQuant = useCallback(
    (q: number) => {
      const v = q / badgeQuantMul;
      setBadgeStr((prev) => {
        const next = formatValue(v);
        return next === prev ? prev : next;
      });
    },
    [badgeQuantMul, formatValue],
  );

  useAnimatedReaction(
    () => Math.round(badgeValue.value * badgeQuantMul),
    (q, prev) => {
      'worklet';
      if (prev !== undefined && q === prev) return;
      if (badgeLastJsFlush) {
        const t = Date.now();
        if (t - badgeLastJsFlush.value < 24) return;
        badgeLastJsFlush.value = t;
      }
      runOnJS(setBadgeFromQuant)(q);
    },
    [badgeLastJsFlush, badgeQuantMul, badgeValue, setBadgeFromQuant],
  );

  const onBadgeTemplateLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number } } }) => {
      badgeTargetTextW.value = e.nativeEvent.layout.width;
    },
    [badgeTargetTextW],
  );

  return (
    <BadgeOverlay
      badge={badge}
      empty={empty}
      variant={variant}
      skiaBadgeFlow={skiaBadgeFlow}
      badgeFlowA11yLabel={badgeFlowA11yLabel}
      badgeNumFont={badgeNumFont}
      badgeValue={badgeValue}
      flowPillW={flowPillW}
      badgeStr={badgeStr}
      badgeStyle={badgeStyle}
      badgeTextWrapStyle={badgeTextWrapStyle}
      backgroundPath={backgroundPath}
      innerPath={innerPath}
      innerColor={innerColor}
      pillH={pillH}
      onBadgeTemplateLayout={onBadgeTemplateLayout}
      pal={pal}
      badgeTextStyle={badgeTextStyle}
    />
  );
}
