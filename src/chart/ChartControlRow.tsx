import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ChartChromeColors, LiveLineTheme, LiveLineWindowStyle } from './types';

export type ChartControlOption = {
  key: string | number;
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
};

type ChartControlRowProps = {
  options: readonly ChartControlOption[];
  theme: LiveLineTheme;
  styleVariant?: LiveLineWindowStyle;
  marginLeft?: number;
  colors?: Pick<
    ChartChromeColors,
    | 'controlBarBg'
    | 'controlIndicatorBg'
    | 'controlActiveText'
    | 'controlInactiveText'
    | 'controlDisabledText'
  >;
};

function ChartControlRowImpl({
  options,
  theme,
  styleVariant = 'default',
  marginLeft = 0,
  colors,
}: ChartControlRowProps) {
  const isDark = theme === 'dark';
  const ui = useMemo(
    () => ({
      indicatorBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)',
      activeTxt: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.55)',
      inactiveTxt: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.22)',
      disabledTxt: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
    }),
    [isDark],
  );
  const controlUi = useMemo(
    () => ({
      indicatorBg: colors?.controlIndicatorBg ?? ui.indicatorBg,
      activeTxt: colors?.controlActiveText ?? ui.activeTxt,
      inactiveTxt: colors?.controlInactiveText ?? ui.inactiveTxt,
      disabledTxt: colors?.controlDisabledText ?? ui.disabledTxt,
    }),
    [
      colors?.controlActiveText,
      colors?.controlDisabledText,
      colors?.controlInactiveText,
      colors?.controlIndicatorBg,
      ui.activeTxt,
      ui.disabledTxt,
      ui.inactiveTxt,
      ui.indicatorBg,
    ],
  );

  const metrics = useMemo(() => {
    const defaultBarBg =
      styleVariant === 'text'
        ? 'transparent'
        : isDark
          ? 'rgba(255,255,255,0.03)'
          : 'rgba(0,0,0,0.02)';
    const barBg = colors?.controlBarBg ?? defaultBarBg;
    if (styleVariant === 'text') {
      return {
        gap: 4,
        barRadius: 0,
        barPadding: 0,
        barBg,
        btnRadius: 4,
        padH: 6,
        padV: 2,
      };
    }
    if (styleVariant === 'rounded') {
      return {
        gap: 2,
        barRadius: 999,
        barPadding: 3,
        barBg,
        btnRadius: 999,
        padH: 10,
        padV: 3,
      };
    }
    return {
      gap: 2,
      barRadius: 6,
      barPadding: 2,
      barBg,
      btnRadius: 4,
      padH: 10,
      padV: 3,
    };
  }, [colors?.controlBarBg, isDark, styleVariant]);

  if (options.length === 0) return null;

  return (
    <View style={[styles.wrap, { marginLeft }]}>
      <View
        style={[
          styles.bar,
          {
            gap: metrics.gap,
            borderRadius: metrics.barRadius,
            padding: metrics.barPadding,
            backgroundColor: metrics.barBg,
          },
        ]}
      >
        {options.map((option) => (
          <Pressable
            key={option.key}
            disabled={option.disabled}
            onPress={option.onPress}
            style={({ pressed }) => [
              {
                paddingHorizontal: metrics.padH,
                paddingVertical: metrics.padV,
                borderRadius: metrics.btnRadius,
                backgroundColor: option.active ? controlUi.indicatorBg : 'transparent',
                opacity: option.disabled ? 0.45 : pressed ? 0.82 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.label,
                {
                  color: option.disabled
                    ? controlUi.disabledTxt
                    : option.active
                      ? controlUi.activeTxt
                      : controlUi.inactiveTxt,
                  fontWeight: option.active ? '600' : '400',
                },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export const ChartControlRow = memo(ChartControlRowImpl);

const styles = StyleSheet.create({
  wrap: {
    marginTop: 2,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: 11,
  },
});
