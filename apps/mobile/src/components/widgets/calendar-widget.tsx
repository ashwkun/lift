import { View, StyleSheet } from 'react-native';
import { WideWidget } from '@/components/ui/widget';
import { useColors, spacing } from '@/theme';

export function CalendarWidget({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle: string;
  onPress?: () => void;
}) {
  const colors = useColors();

  // Create a 7x14 grid of dots to simulate a 3-month calendar
  const cols = 12;
  const rows = 5;

  const dots = Array.from({ length: cols * rows }).map((_, i) => {
    // Randomize some active dots
    const isActive = Math.random() > 0.7;
    return (
      <View
        key={i}
        style={[
          styles.dot,
          { backgroundColor: isActive ? colors.text : colors.border },
        ]}
      />
    );
  });

  return (
    <WideWidget
      title={title}
      subtitle={subtitle}
      actionIcon="options-outline"
      onPress={onPress}
    >
      <View style={styles.container}>
        {Array.from({ length: cols }).map((_, c) => (
          <View key={c} style={styles.column}>
            {Array.from({ length: rows }).map((_, r) => {
              const i = c * rows + r;
              // Fake active pattern
              const isActive = (i % 7 === 0 || i % 11 === 0 || i % 19 === 0) && i !== 0;
              return (
                <View
                  key={r}
                  style={[
                    styles.dot,
                    { backgroundColor: isActive ? colors.text : colors.surfaceMuted },
                  ]}
                />
              );
            })}
          </View>
        ))}
      </View>
    </WideWidget>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
  column: {
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
