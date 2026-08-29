import { Ionicons } from '@expo/vector-icons';
import { DATE_MEDIUM, formatDateTime, formatDuration } from '@lift/shared';
import { and, asc, desc, isNull } from 'drizzle-orm';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  Divider,
  EmptyState,
  ListRow,
  PromptModal,
  Screen,
  SectionHeader,
  Text,
  useScrollEdge,
} from '@/components/ui';
import { db } from '@/db/client';
import { routines as routinesTable, routineFolders, workouts } from '@/db/schema';
import { useRows } from '@/db/use-rows';
import { createRoutineFolder, updateRoutineFolder, deleteRoutineFolder } from '@/features/routines/repository';
import { startWorkout } from '@/features/workouts/repository';
import { startSession } from '@/features/workouts/start-session';
import { useLaunchAction } from '@/hooks/use-launch-action';
import { useTicker } from '@/hooks/use-ticker';
import { showDialog } from '@/store/dialog';
import { radius, spacing, useColors } from '@/theme';

/** Latch key for the ad-hoc Start, which has no routine id to be keyed by. */
const EMPTY_START = 'empty';

export default function WorkoutScreen() {
  const scrollEdge = useScrollEdge();

  const { start } = useLocalSearchParams<{ start?: string }>();

  const colors = useColors();

  // Newest first and capped at one: two open sessions should be impossible, but
  // an unordered query made "the active workout" whichever row SQLite handed
  // back first, which is not a promise SQLite makes.
  const { rows: activeRows, loaded: activeLoaded } = useRows(
    db
      .select()
      .from(workouts)
      .where(and(isNull(workouts.finishedAt), isNull(workouts.deletedAt)))
      .orderBy(desc(workouts.startedAt))
      .limit(1),
  );

  const { rows: routines, loaded: routinesLoaded } = useRows(
    db
      .select()
      .from(routinesTable)
      .where(isNull(routinesTable.deletedAt))
      .orderBy(asc(routinesTable.position)),
  );

  const { rows: folders, loaded: foldersLoaded } = useRows(
    db
      .select()
      .from(routineFolders)
      .where(isNull(routineFolders.deletedAt))
      .orderBy(asc(routineFolders.position)),
  );

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [editingFolder, setEditingFolder] = useState<{id: string, name: string} | null>(null);

  const active = activeRows[0];
  const now = useTicker(1000, Boolean(active));

  // Which Start control is mid-flight, or null. Session creation is a round
  // trip to disk, so an unlatched second tap would ask for a second session and
  // the loser of that race would fail silently. Held as an id rather than a
  // boolean so only the control that was pressed shows the spinner.
  const [starting, setStarting] = useState<string | null>(null);
  // The latch itself is a ref, not the state above: two taps inside one frame
  // would both read the pre-render state and both get through.
  const inFlight = useRef(false);

  const openActive = () => router.push('/workout/active');

  const openFolderMenu = (folder: typeof folders[0]) => {
    void showDialog({
      title: folder.name,
      actions: [
        {
          label: 'Add routine',
          onPress: () => router.push({ pathname: '/routine/new', params: { folderId: folder.id } }),
        },
        {
          label: 'Rename folder',
          onPress: () => setEditingFolder({ id: folder.id, name: folder.name }),
        },
        {
          label: 'Delete folder',
          style: 'destructive',
          onPress: () => {
            void showDialog({
              title: 'Delete folder?',
              message: 'The routines inside will not be deleted.',
              actions: [
                {
                  label: 'Delete',
                  style: 'destructive',
                  onPress: () => void deleteRoutineFolder(folder.id).then(() => {}),
                },
                { label: 'Cancel', style: 'cancel' },
              ],
            });
          },
        },
        { label: 'Cancel', style: 'cancel' },
      ],
    });
  };

  const begin = async (routineId?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStarting(routineId ?? EMPTY_START);

    try {
      const outcome = await startSession({
        create: () => startWorkout(routineId ? { routineId } : {}),
        // An open session started from the same routine, or an open ad-hoc
        // session when the tap was "start empty". Is the thing being asked
        // for. Going through is a resume, not a second session.
        resumes: (open) => open.routineId === (routineId ?? null),
        openExisting: openActive,
      });

      if (outcome === 'started' || outcome === 'resumed') openActive();
    } finally {
      inFlight.current = false;
      setStarting(null);
    }
  };

  /*
   * `?start=<token>` starts an ad-hoc session on arrival.
   *
   * The last row of the routines widget on the home screen. A routine's row
   * carries the same parameter to `/routine/[id]`; this is the same instruction
   * with no routine behind it, so it runs the same `begin` the Start button on
   * this screen runs and inherits every decision `startSession` makes.
   *
   * Placed above the loading gate on purpose: hooks cannot be conditional, and
   * `begin` reads the database itself rather than the rows this screen is
   * waiting on.
   */
  useLaunchAction(start, () => {
    void begin();
  });

  /*
   * Both queries seed `[]` and answer a tick later, and this tab is where a
   * cold start lands. Without the gate the routine list opens on "No routines
   * yet" for a user who has routines, and `active` is briefly undefined, so
   * the resume card is missing, the button offers to start a second session,
   * and a tap inside that window reaches `begin` with `resumes` false, which
   * silently discards the open workout.
   */
  if (!activeLoaded || !routinesLoaded) {
    return <Screen scrolled={scrollEdge.progress}>{null}</Screen>;
  }

  return (
    <Screen scrolled={scrollEdge.progress}>
      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        {active && (
          <Pressable
            onPress={openActive}
            accessibilityRole="button"
            // The label replaces the merged child text, which is the point: the
            // clock inside this card reads a second later on every frame, so an
            // announcement built from the children would never settle.
            accessibilityLabel={`Resume ${active.name}`}
            accessibilityHint="Opens the workout in progress"
            style={({ pressed }) => [
              styles.resume,
              {
                backgroundColor: colors.accentSurface,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View style={styles.resumeBody}>
              {/* The tint and the running clock are one accent object; the
                  kicker and the chevron are reinforcements that only spread
                  the accent thinner. */}
              <Text variant="overline" color="textSecondary">
                In progress
              </Text>
              <Text variant="bodyMedium" numberOfLines={1}>
                {active.name}
              </Text>
              <Text variant="numericLarge" color="accent">
                {formatDuration(Math.floor((now - active.startedAt.getTime()) / 1000))}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={colors.textTertiary} />
          </Pressable>
        )}

        <View style={styles.quickStart}>
          <Button
            title={active ? 'Resume workout' : 'Start empty workout'}
            icon={active ? 'play' : 'add'}
            size="lg"
            fullWidth
            loading={starting === EMPTY_START}
            onPress={() => (active ? openActive() : void begin())}
          />
        </View>

        <SectionHeader
          title="Routines"
          action={
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button
                title="Folder"
                icon="folder-outline"
                variant="ghost"
                size="sm"
                onPress={() => setCreatingFolder(true)}
              />
              <Button
                title="New"
                icon="add"
                variant="ghost"
                size="sm"
                onPress={() => router.push('/routine/new')}
              />
            </View>
          }
        />

        {routines.length === 0 && folders.length === 0 ? (
          <EmptyState
            icon="list-outline"
            title="No routines yet"
            description="Create one from scratch, or import your workouts and routines from another app."
            action={
              <View style={styles.emptyActions}>
                <Button title="Create routine" fullWidth onPress={() => router.push('/routine/new')} />
                <Button
                  title="Import from another app"
                  icon="download-outline"
                  variant="secondary"
                  fullWidth
                  onPress={() => router.push('/import')}
                />
              </View>
            }
          />
        ) : (
          <View style={{ gap: spacing.xl }}>
            {folders.map(folder => {
              const folderRoutines = routines.filter(r => r.folderId === folder.id);
              return (
                <View key={folder.id}>
                  <SectionHeader
                    title={folder.name}
                    action={
                      <Pressable
                        onPress={() => openFolderMenu(folder)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityRole="button"
                        accessibilityLabel={`More options for ${folder.name}`}
                      >
                        <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
                      </Pressable>
                    }
                  />
                  {folderRoutines.length > 0 ? (
                    <Card padded={false} style={styles.routineCard}>
                      {folderRoutines.map((routine, index) => (
                        <View key={routine.id}>
                          {index > 0 && <Divider inset={spacing.lg} />}
                          <ListRow
                            title={routine.name}
                            subtitle={
                              routine.lastPerformedAt
                                ? `Last performed ${formatDateTime(routine.lastPerformedAt, DATE_MEDIUM)}`
                                : 'Not performed yet'
                            }
                            onPress={() =>
                              router.push({ pathname: '/routine/[id]', params: { id: routine.id } })
                            }
                            accessibilityActions={[
                              {
                                name: 'start',
                                label: active?.routineId === routine.id ? 'Resume' : 'Start',
                              },
                            ]}
                            onAccessibilityAction={(event) => {
                              if (event.nativeEvent.actionName === 'start') void begin(routine.id);
                            }}
                            accessory={
                              <Button
                                title={active?.routineId === routine.id ? 'Resume' : 'Start'}
                                size="sm"
                                variant="secondary"
                                loading={starting === routine.id}
                                onPress={() => void begin(routine.id)}
                              />
                            }
                          />
                        </View>
                      ))}
                    </Card>
                  ) : (
                    <Text variant="bodyMedium" color="textTertiary" style={{ paddingHorizontal: spacing.lg }}>
                      Empty folder
                    </Text>
                  )}
                </View>
              );
            })}

            {routines.filter(r => !r.folderId).length > 0 && (
              <View>
                {folders.length > 0 && <SectionHeader title="Other routines" />}
                <Card padded={false} style={styles.routineCard}>
                  {routines.filter(r => !r.folderId).map((routine, index) => (
                    <View key={routine.id}>
                      {index > 0 && <Divider inset={spacing.lg} />}
                      <ListRow
                        title={routine.name}
                        subtitle={
                          routine.lastPerformedAt
                            ? `Last performed ${formatDateTime(routine.lastPerformedAt, DATE_MEDIUM)}`
                            : 'Not performed yet'
                        }
                        onPress={() =>
                          router.push({ pathname: '/routine/[id]', params: { id: routine.id } })
                        }
                        accessibilityActions={[
                          {
                            name: 'start',
                            label: active?.routineId === routine.id ? 'Resume' : 'Start',
                          },
                        ]}
                        onAccessibilityAction={(event) => {
                          if (event.nativeEvent.actionName === 'start') void begin(routine.id);
                        }}
                        accessory={
                          <Button
                            title={active?.routineId === routine.id ? 'Resume' : 'Start'}
                            size="sm"
                            variant="secondary"
                            loading={starting === routine.id}
                            onPress={() => void begin(routine.id)}
                          />
                        }
                      />
                    </View>
                  ))}
                </Card>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <PromptModal
        visible={creatingFolder}
        title="New folder"
        placeholder="Folder name"
        maxLength={60}
        onCancel={() => setCreatingFolder(false)}
        onConfirm={(name) => {
          setCreatingFolder(false);
          if (name.trim()) {
            void createRoutineFolder(name.trim());
          }
        }}
      />
      <PromptModal
        visible={!!editingFolder}
        title="Rename folder"
        initialValue={editingFolder?.name}
        placeholder="Folder name"
        onCancel={() => setEditingFolder(null)}
        onConfirm={(name) => {
          if (editingFolder) {
            void updateRoutineFolder(editingFolder.id, name).then(() => {});
            setEditingFolder(null);
          }
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.huge },
  resume: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
  },
  resumeBody: { flex: 1, gap: 2 },
  quickStart: { padding: spacing.lg },
  routineCard: { marginHorizontal: spacing.lg },
  emptyActions: { alignSelf: 'stretch', gap: spacing.sm, minWidth: 260 },
});
