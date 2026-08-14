import { StyleSheet, View } from 'react-native';

import { Screen, Text } from '@/components/ui';
import { spacing } from '@/theme';

export default function ProfileScreen() {
  return (
    <Screen>
      <View style={styles.container}>
        <Text variant="heading">Profile</Text>
        <Text variant="body" color="textSecondary">
          Stats, measurements and settings.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
});
