'use client';
// Settings → Files (CONTRACT 27, Settings; the prototype's settings-files screen): the largest file
// (MB) and the company's storage limit (GB), saved with "Save changes", then the space used, read
// on the server from projectFiles.spaceUsage() (page.js): "Space used: 1.2 GB of 10 GB" with a bar
// (marigold from 80%, red from 100%), the files and projects, the room held by uploads and the
// deleted files that leave tonight. One muted line per storage problem, for a recent disk-full
// refusal, or before migration 019 in place of the numbers.
import { Info } from 'lucide-react';
import ProgressBar from '@/components/ProgressBar';
import { plural } from '@/lib/text';
import { diskRanOut, filesUpdateNeeded, storageProblem } from '@/modules/projectFiles/fileMessages';
import { formatSize } from '@/modules/projectFiles/kinds';
import NumberField from './NumberField';
import Section from './Section';
import { useSettingsForm } from './SettingsProvider';
import styles from './SettingsForm.module.css';
import own from './FilesSection.module.css';

const GIB = 1024 ** 3;

/** One muted line with an Info icon. */
function Note({ children }) {
  return (
    <p className={own.note}>
      <Info size={16} strokeWidth={1.8} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** The bar's tone: primary, marigold from 80%, red from 100%. */
const toneOf = (percent) => (percent >= 100 ? 'red' : percent >= 80 ? 'marigold' : 'primary');

/** "Space used: 1.2 GB of 10 GB", the bar and the lines under it. */
function SpaceUsed({ space, limitBytes }) {
  const percent = limitBytes > 0 ? (space.usedBytes / limitBytes) * 100 : 0;
  const files = `${space.fileCount.toLocaleString('en-US')} ${plural(space.fileCount, 'file')}`;
  const projects = `${space.projectCount.toLocaleString('en-US')} ${plural(space.projectCount, 'project')}`;
  return (
    <>
      {/* Plain body type, as the prototype: the tabular heading figures put gaps round a decimal
          point ("5 . 4 MB"). */}
      <p className={own.used}>
        Space used: {formatSize(space.usedBytes)} of {formatSize(limitBytes)}
      </p>
      <ProgressBar percent={percent} color={toneOf(percent)} label="Space used" />
      <p className={own.line}>
        {files} on {projects}.
      </p>
      {space.heldBytes > 0 ? (
        <p className={own.line}>
          {formatSize(space.heldBytes)} is held by uploads that are still running or waiting to be
          added to a task.
        </p>
      ) : null}
      {space.deletedBytes > 0 ? (
        <p className={own.line}>
          {formatSize(space.deletedBytes)} of deleted files leaves the server tonight.
        </p>
      ) : null}
    </>
  );
}

/**
 * @param {{ space: { usedBytes: number, heldBytes: number, deletedBytes: number,
 *   fileCount: number, projectCount: number, updateNeeded: boolean, problem: string | null,
 *   diskFullOn: string | null } | null }} props space: page.js filesSpace() (null when it couldn't
 *   be read); diskFullOn: "Sat, 21 Nov" when the server ran out of disk within 7 days
 */
export default function FilesSection({ space }) {
  const { saved } = useSettingsForm();
  // The saved limit, so the line follows a save without reloading the page.
  const limitBytes = Number(saved.fileStorageLimitGb) * GIB;
  const problem = space && !space.updateNeeded ? storageProblem(space.problem) : null;
  return (
    <Section id="files" title="Files" subtitle="Files people add to projects and tasks.">
      <div className={styles.grid2}>
        <NumberField
          name="fileMaxMb"
          label="Largest file (MB)"
          help="Each file can be up to this size. Very big files take a few minutes to upload."
          maxLength={4}
        />
        <NumberField
          name="fileStorageLimitGb"
          label="Storage limit (GB)"
          help="All project files together. Keep it to about half of the free space your hosting shows under Disk Usage."
          maxLength={4}
        />
      </div>
      {space ? (
        <div className={own.space}>
          {space.updateNeeded ? (
            <Note>{filesUpdateNeeded()}</Note>
          ) : (
            <SpaceUsed space={space} limitBytes={limitBytes} />
          )}
          {problem ? <Note>{problem}</Note> : null}
          {space.diskFullOn && !space.updateNeeded ? (
            <Note>{diskRanOut(space.diskFullOn)}</Note>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}
