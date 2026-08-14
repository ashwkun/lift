import { StyleSheet, View } from 'react-native';

import { Screen, Text } from '@/components/ui';
import { spacing } from '@/theme';

export default function HistoryScreen() {
  return (
    <Screen>
      <View style={styles.container}>
        <Text variant="heading">History</Text>
        <Text variant="body" color="textSecondary">
          Completed workouts, grouped by month.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
});
