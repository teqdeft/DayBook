'use client';
// Upload files (CONTRACT 27, Files tab): first "Add to" (preset to the place shown; Whole project
// from All files and On tasks; the current phase marked) and "Who can see it" (Everyone preset;
// the choice is always sent), then the drop box with "Choose files" and the picked files as chips
// marked "Ready" (the early checks run here; an X removes one). "Upload 3 files" queues them with
// the window's choices and closes it; the Uploads card takes over. It reads "Upload files" and is
// aria-disabled while nothing is ready. A full-screen sheet on a phone.
import { useState } from 'react';
import Button from '@/components/Button';
import Dialog from '@/components/Dialog';
import UploadField from '@/components/files/UploadField';
import { formatSize } from '@/modules/projectFiles/kinds';
import { plural } from '@/lib/text';
import windowStyles from '../projectWindows.module.css';
import { PlaceField, VisibilityField } from './FileChoices';
import { optionPhase, phaseForPlace, phaseOption } from './filesTabView';
import styles from './FileDialogs.module.css';

/** "Upload 3 files", or "Upload files" while none is ready. */
export const uploadLabel = (ready) =>
  ready > 0 ? `Upload ${ready} ${plural(ready, 'file')}` : 'Upload files';

/** "Any type of file, each up to 500 MB." */
export const uploadHelp = (limits) =>
  `Any type of file, each up to ${formatSize(limits.maxFileBytes)}.`;

function UploadWindow({ dialog, place, currentPhase, pmName, limits, onClose, onUpload }) {
  const [phase, setPhase] = useState(() => phaseForPlace(place));
  const [visibility, setVisibility] = useState('everyone');
  const { ready } = dialog;

  function submit(event) {
    event.preventDefault();
    if (ready === 0) return;
    onUpload({ phase, visibility });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Upload files"
      width={560}
      className={`${styles.panel} ${windowStyles.window}`}
      onSubmit={submit}
      footer={
        <>
          <Button variant="secondary" className={styles.second} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            className={styles.main}
            aria-disabled={ready === 0 ? true : undefined}
          >
            {uploadLabel(ready)}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <PlaceField
          id="upload-place"
          label="Add to"
          value={phaseOption(phase)}
          currentPhase={currentPhase}
          onChange={(value) => setPhase(optionPhase(value))}
        />
        <VisibilityField
          name="upload-visibility"
          value={visibility}
          pmName={pmName}
          onChange={setVisibility}
        />
        <UploadField
          id="upload-files"
          uploads={dialog.uploads}
          limits={limits}
          help={uploadHelp(limits)}
          dropText="Drop to add"
          phoneLabel="Choose files"
        />
      </div>
    </Dialog>
  );
}

/**
 * @param {{ dialog: null | { uploads: object, ready: number }, place: string,
 *   currentPhase: string | null, pmName: string | null, limits: object, onClose: () => void,
 *   onUpload: (choice: { phase: string | null, visibility: 'everyone' | 'managers' }) => void }}
 *   props dialog: useFilesUploads' window (null when closed); place: the place shown (the preset)
 */
export default function UploadDialog({ dialog, ...rest }) {
  if (!dialog) return null;
  return <UploadWindow dialog={dialog} {...rest} />;
}
