/**
 * The app's own dialog queue, replacing `Alert.alert` everywhere.
 *
 * Four reasons the platform alert had to go, in the order they bite:
 *
 * It is the one surface in the app the theme cannot reach. Every other pixel
 * reads from `theme/tokens.ts`: the AMOLED canvas, the lime accent, the loaded
 * face, and then a delete confirmation opens in Material grey with Roboto on
 * it. On a screen that is otherwise true black, a white alert card is also the
 * brightest thing the app ever shows, which is a poor way to ask "are you sure".
 *
 * Android silently drops everything past the third button. `Alert.js` slices
 * the array before mapping it onto the neutral/negative/positive slots, so the
 * exercise menu in `exercise-block.tsx` offered four actions and shipped three,
 * with Cancel (last in the array) as the one that went missing.
 *
 * `Alert.prompt` is iOS-only, which is why `PromptModal` already exists. That
 * component is the precedent this one follows: same card, same backdrop, same
 * accessibility handling. Two dialogs that look nothing alike is the state this
 * replaces, not one to preserve.
 *
 * And an alert cannot be driven from a test or a screenshot run, because it is
 * not in the React tree at all.
 *
 * The queue lives in a store rather than in a provider so that non-component
 * code can raise a dialog: `features/workouts/start-session.ts` is a plain
 * async routine with no hooks available, and it has to be able to say "a
 * workout is already in progress". `DialogHost` renders whatever is at the
 * head. Requests raised before the host mounts simply wait for it.
 */

import { create } from 'zustand';

export type DialogActionStyle =
  /** Ordinary action. Renders accented when it is the only one of its kind. */
  | 'default'
  /** Completes the thing being asked about: finish workout, save. */
  | 'confirm'
  /** Backs out. At most one per dialog, and it is what a dismissal resolves to. */
  | 'cancel'
  /** Irreversible: delete, discard, sign out. */
  | 'destructive';

export interface DialogAction {
  label: string;
  style?: DialogActionStyle;
  onPress?: () => void;
}

export interface DialogRequest {
  title: string;
  message?: string;
  /** Defaults to a single dismissing "OK". */
  actions?: DialogAction[];
}

/** A request with its identity and its pending promise attached. */
export interface QueuedDialog extends DialogRequest {
  id: number;
  actions: DialogAction[];
  resolve: (index: number) => void;
}

interface DialogState {
  /** Head is what `DialogHost` shows; the rest wait their turn. */
  queue: QueuedDialog[];
  enqueue: (dialog: QueuedDialog) => void;
  remove: (id: number) => void;
}

export const useDialogs = create<DialogState>((set) => ({
  queue: [],
  enqueue: (dialog) => set((state) => ({ queue: [...state.queue, dialog] })),
  remove: (id) => set((state) => ({ queue: state.queue.filter((entry) => entry.id !== id) })),
}));

const DISMISS_ACTION: DialogAction = { label: 'OK', style: 'cancel' };

let nextId = 0;

/**
 * Raises a dialog and resolves with the index of the action that was pressed,
 * or `-1` if it was dismissed without one.
 *
 * The index is into the `actions` array as passed, not as displayed: the host
 * reorders Cancel to the platform-conventional end of the row or the bottom of
 * the stack, and a caller should not have to know which layout it got.
 *
 * Awaiting is optional. `onPress` on the action fires either way, which keeps
 * the call sites that were written against `Alert.alert` a rename apart, and
 * lets fire-and-forget callers stay synchronous.
 */
export function showDialog(request: DialogRequest): Promise<number> {
  const actions = request.actions?.length ? request.actions : [DISMISS_ACTION];

  return new Promise((resolve) => {
    nextId += 1;
    useDialogs.getState().enqueue({ ...request, actions, id: nextId, resolve });
  });
}

/**
 * Closes a dialog and settles its promise. Called by the host, and by nothing
 * else. `index` is trusted to be a real position in `dialog.actions`, or the
 * `-1` that means the backdrop or the back gesture closed it.
 *
 * Exactly once per dialog, enforced by its presence in the queue rather than by
 * the caller. `Modal` keeps its children mounted and hit-testable for the
 * length of the fade-out, so a second tap lands on a button belonging to a
 * dialog that has already answered, and `onPress` running twice there is a set
 * deleted twice or a workout discarded after it was finished. `resolve` is
 * harmless to call again; `onPress` is not.
 *
 * Removal happens before `onPress` runs, so an action that raises a second
 * dialog (the exercise menu's Remove, which then asks for confirmation) finds
 * the queue already advanced and opens immediately rather than behind itself.
 */
export function settleDialog(dialog: QueuedDialog, index: number): void {
  const { queue, remove } = useDialogs.getState();
  if (!queue.some((entry) => entry.id === dialog.id)) return;

  remove(dialog.id);
  dialog.actions[index]?.onPress?.();
  dialog.resolve(index);
}

/**
 * A statement with nothing to decide: a write failed, a file was written, a
 * restore finished. Resolves when it is acknowledged, which most callers ignore.
 */
export function showAlert(title: string, message?: string): Promise<void> {
  return showDialog({ title, message }).then(() => undefined);
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** The action being confirmed. Name it: "Delete", not "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** `destructive` unless the thing being confirmed builds rather than removes. */
  tone?: 'destructive' | 'confirm' | 'default';
}

/**
 * Two-button question. Resolves `true` only if the confirming action was
 * pressed: a dismissal, the back gesture and Cancel are all `false`.
 */
export async function showConfirm({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'destructive',
}: ConfirmOptions): Promise<boolean> {
  const chosen = await showDialog({
    title,
    message,
    actions: [
      { label: cancelLabel, style: 'cancel' },
      { label: confirmLabel, style: tone },
    ],
  });

  return chosen === 1;
}
