import { StyleSheet, Text } from 'react-native';

import Animated, {
  type SharedValue,
  isSharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';

type ReferenceLineLabelProps = {
  label: string;
  y: number | SharedValue<number>;
  opacity: number | SharedValue<number>;
  padLeft: number;
  padRight: number;
  layoutWidth: number;
  color: string;
  textStyle: object;
};

export function ReferenceLineLabel({
  label,
  y,
  opacity,
  padLeft,
  padRight,
  layoutWidth,
  color,
  textStyle,
}: ReferenceLineLabelProps) {
  const labelStyle = useAnimatedStyle(() => {
    const yy = (isSharedValue(y) ? y.value : y) as number;
    const oo = (isSharedValue(opacity) ? opacity.value : opacity) as number;
    return { top: yy - 8, opacity: oo };
  }, [y, opacity]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        { left: padLeft, width: layoutWidth - padLeft - padRight },
        labelStyle,
      ]}
    >
      <Text style={[textStyle, styles.text, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    alignItems: 'center',
  },
  text: {
    textAlign: 'center',
  },
});
