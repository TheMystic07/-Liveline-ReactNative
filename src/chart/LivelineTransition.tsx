import { Children, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

export interface LivelineTransitionProps {
  active: string;
  duration?: number;
  children: ReactNode;
}

export function LivelineTransition({
  active,
  duration = 220,
  children,
}: LivelineTransitionProps) {
  const childList = useMemo(
    () => Children.toArray(children).filter(Boolean) as ReactElement[],
    [children],
  );
  const activeChild = childList.find((child) => String(child.key) === active) ?? childList[0] ?? null;
  const [previousChild, setPreviousChild] = useState<ReactElement | null>(null);
  const prevActiveRef = useRef(active);
  const activeOpacity = useRef(new Animated.Value(1)).current;
  const previousOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (prevActiveRef.current === active || !activeChild) return;
    const outgoing =
      childList.find((child) => String(child.key) === prevActiveRef.current) ?? null;
    prevActiveRef.current = active;
    setPreviousChild(outgoing);
    activeOpacity.setValue(0);
    previousOpacity.setValue(1);
    Animated.parallel([
      Animated.timing(activeOpacity, {
        toValue: 1,
        duration,
        useNativeDriver: true,
      }),
      Animated.timing(previousOpacity, {
        toValue: 0,
        duration,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setPreviousChild(null);
    });
  }, [active, activeChild, activeOpacity, childList, duration, previousOpacity]);

  if (!activeChild) return null;

  return (
    <View style={styles.root}>
      {previousChild ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: previousOpacity }]}>
          {previousChild}
        </Animated.View>
      ) : null}

      <Animated.View style={{ opacity: activeOpacity }}>
        {activeChild}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
  },
});
