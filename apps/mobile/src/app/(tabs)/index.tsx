import { Screen, Text } from '@/components/ui';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';

export default function HomeScreen() {
  return (
    <Screen>
      <View style={styles.container}>
        <Text variant="heading">Home</Text>
        <Text variant="body" color="textSecondary">
          Dashboard, streaks and weekly volume land here.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
});
