/**
 * Handing a share to the system share sheet, from wherever the button is.
 *
 * The routine screen and the workout screen do exactly the same four things:
 * build the file, check a share sheet exists, open it, and say something useful
 * when any of that fails. That is the whole hook, and it lives here rather than
 * twice in `app/` because the failure branch is the part worth writing once.
 *
 * When there is no share sheet, the path is printed instead of an apology. The
 * file has already been written by then, so the path is the only remaining way
 * to get it off the device: the same choice `export.tsx` makes for a backup.
 */

import { useCallback, useState } from 'react';
import * as Sharing from 'expo-sharing';

import { showAlert } from '@/store/dialog';

import { writeShareFile, type SharedFile } from './index';

/** The one line of an unknown failure worth putting in front of someone. */
function reason(cause: unknown): string {
  const text = cause instanceof Error ? cause.message.trim() : '';
  return text.length > 0 ? text : 'The reason was not reported.';
}

export function useShare(): { sharing: boolean; share: (build: () => Promise<SharedFile>) => void } {
  const [sharing, setSharing] = useState(false);

  const share = useCallback((build: () => Promise<SharedFile>) => {
    setSharing(true);

    void (async () => {
      try {
        const shared = await build();
        const file = await writeShareFile(shared);

        if (!(await Sharing.isAvailableAsync())) {
          void showAlert(
            'No share sheet on this device',
            `The file is written and waiting at:\n${file.uri}`,
          );
          return;
        }

        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: shared.kind === 'routine' ? 'Share routine' : 'Share workout',
        });
      } catch (cause) {
        void showAlert('Nothing was shared', reason(cause));
      } finally {
        setSharing(false);
      }
    })();
  }, []);

  return { sharing, share };
}
