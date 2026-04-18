import { Pressable, StyleSheet, Text, View } from 'react-native';

export function ControlRow({
  label,
  children,
  labelColor,
}: {
  label: string;
  children: React.ReactNode;
  labelColor?: string;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, labelColor ? { color: labelColor } : null]}>{label}</Text>
      <View style={styles.items}>{children}</View>
    </View>
  );
}

export function Chip({
  active,
  label,
  onPress,
  disabled = false,
  theme = 'dark',
  accent = '#3b82f6',
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  theme?: 'dark' | 'light';
  accent?: string;
}) {
  const isDark = theme === 'dark';
  const baseBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const baseBackground = isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)';
  const baseText = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.42)';
  const activeBackground = isDark ? `${accent}1f` : `${accent}14`;
  const activeBorder = isDark ? `${accent}66` : `${accent}52`;

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: baseBackground,
          borderColor: baseBorder,
        },
        active && styles.chipActive,
        active
          ? {
              backgroundColor: activeBackground,
              borderColor: activeBorder,
            }
          : null,
        disabled && styles.chipDisabled,
        pressed && styles.chipPressed,
      ]}
    >
      <Text
        style={[
          styles.chipLabel,
          { color: baseText },
          active && styles.chipLabelActive,
          active ? { color: accent } : null,
          disabled && styles.chipLabelDisabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    flexWrap: 'wrap',
  },
  label: {
    width: 72,
    color: 'rgba(255,255,255,0.35)',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.8,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  items: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    flex: 1,
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 5,
    borderWidth: 1,
  },
  chipActive: {
  },
  chipPressed: {
    opacity: 0.85,
  },
  chipDisabled: {
    opacity: 0.35,
  },
  chipLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
  chipLabelActive: {
  },
  chipLabelDisabled: {
    color: 'rgba(255,255,255,0.3)',
  },
});
