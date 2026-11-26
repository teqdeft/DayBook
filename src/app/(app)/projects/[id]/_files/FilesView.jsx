'use client';
// The Files tab (CONTRACT 27, Files tab), for managers and for people on the project: the side list
// of places (the "Show" select below 1024 px), the place's header with "New note" and "Upload
// files" for managers, the search and sort, the Uploads card, then one flat list. A picture opens
// the picture viewer, another file downloads, a note or a text-only document opens the note window.
// Members get the same list without Upload, New note or menus. While files upload or are read for
// the AI the page asks before it is left.
import { useCallback, useEffect, useRef } from 'react';
import { Info, StickyNote, Upload } from 'lucide-react';
import Button from '@/components/Button';
import SearchBox from '@/components/SearchBox';
import Select from '@/components/Select';
import { useToast } from '@/components/ToastProvider';
import PictureViewer from '@/components/files/PictureViewer';
import { startDownload, uploadingLeaveMessage, useLeaveGuard } from '@/components/files/leaveGuard';
import { UploadAnnouncer } from '@/components/files/uploadAnnouncer';
import { useTaskWindow } from '@/components/task/TaskWindowProvider';
import * as fileMessages from '@/modules/projectFiles/fileMessages';
import FileEditDialog from './FileEditDialog';
import FilesList from './FilesList';
import NoteDialog from './NoteDialog';
import NoteView from './NoteView';
import PlaceList from './PlaceList';
import PlaceSelect from './PlaceSelect';
import UploadDialog from './UploadDialog';
import UploadsCard from './UploadsCard';
import { phaseOption, placeName, SORTS } from './filesTabView';
import { useFilesTab } from './useFilesTab';
import { useFilesUploads } from './useFilesUploads';
import { readingLeaveMessage, useReadForAi } from './useReadForAi';
import styles from './FilesTab.module.css';

const focusById = (id) => requestAnimationFrame(() => document.getElementById(id)?.focus());

/** The uploads, the AI reader and the leave guard of a manager's tab. */
function useTabUploads({ projectId, limits }) {
  const readRef = useRef(null);
  const onFinished = useCallback((item) => {
    const file = item.file;
    if (!file) return;
    readRef.current?.({
      fileId: file.id,
      name: file.name,
      size: file.sizeBytes,
      ext: file.ext,
      source: item.source,
    });
  }, []);
  const up = useFilesUploads({ projectId, limits, onFinished });
  const reader = useReadForAi({ projectId, waiting: up.running > 0 });
  useEffect(() => {
    readRef.current = reader.add;
  }, [reader.add]);
  useLeaveGuard(up.running > 0, uploadingLeaveMessage(up.running));
  useLeaveGuard(up.running === 0 && reader.count > 0, readingLeaveMessage(reader.count));
  return { up, reader };
}

function Header({ tab, canManage, currentPhase, onNote, onUpload, storageReady }) {
  const { place } = tab;
  return (
    <div className={styles.head}>
      <PlaceSelect place={place} counts={tab.counts} onPlace={tab.choosePlace} />
      <h2 className={styles.title}>
        {placeName(place)}
        {place === currentPhase ? <span className={styles.titleNote}>Current phase</span> : null}
      </h2>
      {canManage ? (
        <div className={styles.actions}>
          <Button
            id="files-new-note"
            variant="secondary"
            icon={<StickyNote size={18} strokeWidth={1.8} />}
            onClick={onNote}
          >
            New note
          </Button>
          <Button
            id="files-upload"
            className={styles.primaryAction}
            icon={<Upload size={18} strokeWidth={1.8} />}
            aria-disabled={storageReady ? undefined : true}
            onClick={() => onUpload()}
          >
            Upload files
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Tools({ tab }) {
  return (
    <div className={styles.tools}>
      <SearchBox
        id="files-search"
        className={styles.search}
        placeholder="Search files and notes"
        label="Search files and notes"
        value={tab.query}
        onChange={tab.setQuery}
      />
      <div className={styles.sort}>
        <label className={styles.sortLabel} htmlFor="files-sort">
          Sort
        </label>
        <Select
          id="files-sort"
          className={styles.select}
          value={tab.sort}
          onChange={(event) => tab.setSort(event.target.value)}
          options={SORTS}
        />
      </div>
    </div>
  );
}

/**
 * @param {{ projectId: number, canManage: boolean, place: string, currentPhase: string | null,
 *   pmName: string | null, files: object[], documents: object[], links?: object[],
 *   limits: object, storageReady: boolean }} props files: ProjectFile[] with `addedOn`;
 *   documents: listDocumentsFor's rows with `addedOn`; links: the links this viewer may see for
 *   "On tasks" (CONTRACT 28); limits: projectFiles.limits() (managers)
 */
export default function FilesView(props) {
  const { projectId, canManage, currentPhase, pmName, limits, storageReady } = props;
  const toast = useToast();
  const tab = useFilesTab(props);
  const { up, reader } = useTabUploads({ projectId, limits });
  const taskWindow = useTaskWindow();
  const { view, panel, setPanel } = tab;

  function upload(files) {
    if (!storageReady) {
      toast({ title: fileMessages.storageOff(), tone: 'error' });
      return;
    }
    up.open(files);
  }

  function openTask(taskId, event) {
    taskWindow?.open(taskId, { origin: event?.currentTarget ?? null });
  }

  function open(item) {
    if (item.type === 'note' || item.type === 'text') return setPanel({ kind: 'view', item });
    const at = view.pictures.findIndex((file) => file.id === item.file.id);
    if (at !== -1) tab.setViewer(at);
  }

  /** A row menu's choice; a Delete chosen with Enter or Space (detail 0) puts focus on Undo. */
  function act(action, item, event) {
    if (action === 'download') startDownload(item.file.downloadUrl);
    else if (action === 'viewText' || action === 'open') setPanel({ kind: 'view', item });
    else if (action === 'readText') {
      const { file } = item;
      reader.add({
        fileId: file.id,
        name: file.name,
        size: file.sizeBytes,
        ext: file.ext,
        url: file.downloadUrl,
      });
    } else if (action === 'openTask') openTask(item.task.id);
    else if (action === 'unlink') tab.unlink(item, { keyboard: event?.detail === 0 });
    else if (action === 'edit') setPanel({ kind: item.type === 'note' ? 'note' : 'edit', item });
    else if (action === 'delete') tab.remove(item, { keyboard: event?.detail === 0 });
  }

  return (
    <div className={styles.files}>
      <PlaceList
        place={tab.place}
        counts={tab.counts}
        currentPhase={currentPhase}
        onPlace={tab.choosePlace}
      />
      <div className={styles.main}>
        <Header
          tab={tab}
          canManage={canManage}
          currentPhase={currentPhase}
          storageReady={storageReady}
          onNote={() => setPanel({ kind: 'note', item: null })}
          onUpload={upload}
        />
        {canManage && !storageReady ? (
          <p className={styles.storage}>
            <Info size={16} strokeWidth={1.8} aria-hidden="true" />
            {fileMessages.storageOff()}
          </p>
        ) : null}
        <Tools tab={tab} />
        {canManage ? (
          // Always there for managers (empty while nothing uploads), as the prototype lays it out.
          <div>
            <UploadsCard
              active={up.card.active}
              reading={reader.rows}
              failed={up.card.failed}
              onRemove={up.uploads.remove}
              onRetry={up.uploads.retry}
              onCancelAll={() => {
                up.uploads.cancelAll();
                focusById('files-upload');
              }}
              focusFallback={() => focusById('files-upload')}
            />
          </div>
        ) : null}
        <FilesList
          view={view}
          place={tab.place}
          canManage={canManage}
          canDrop={canManage && storageReady}
          onOpen={open}
          onOpenTask={openTask}
          onAction={act}
          onUpload={() => upload()}
          onClear={() => tab.setQuery('')}
          onDropFiles={upload}
        />
      </div>
      {canManage ? (
        <>
          <UploadDialog
            dialog={up.dialog}
            place={tab.place}
            currentPhase={currentPhase}
            pmName={pmName}
            limits={limits}
            onClose={up.close}
            onUpload={(choice) => {
              up.upload(choice);
              tab.choosePlace(phaseOption(choice.phase));
            }}
          />
          <NoteDialog
            open={panel?.kind === 'note'}
            projectId={projectId}
            note={panel?.kind === 'note' ? panel.item : null}
            place={tab.place}
            currentPhase={currentPhase}
            pmName={pmName}
            onClose={() => setPanel(null)}
            onSaved={(phase) => {
              setPanel(null);
              if (phase !== undefined) tab.choosePlace(phaseOption(phase));
            }}
            onDelete={(note, event) => tab.remove(note, { keyboard: event?.detail === 0 })}
          />
          <FileEditDialog
            item={panel?.kind === 'edit' ? panel.item : null}
            currentPhase={currentPhase}
            pmName={pmName}
            onClose={() => setPanel(null)}
            onSaved={tab.saved}
          />
          <UploadAnnouncer text={up.uploads.announcement ?? ''} />
          <UploadAnnouncer text={reader.announcement} />
        </>
      ) : null}
      <NoteView
        item={panel?.kind === 'view' ? panel.item : null}
        canManage={canManage}
        onClose={() => setPanel(null)}
        onEdit={(item) => setPanel({ kind: 'note', item })}
        onDelete={(item, event) => tab.remove(item, { keyboard: event?.detail === 0 })}
      />
      {tab.viewer !== null && view.pictures.length > 0 ? (
        <PictureViewer
          files={view.pictures}
          index={Math.min(tab.viewer, view.pictures.length - 1)}
          onIndex={tab.setViewer}
          onClose={() => tab.setViewer(null)}
        />
      ) : null}
      {tab.toast}
    </div>
  );
}
