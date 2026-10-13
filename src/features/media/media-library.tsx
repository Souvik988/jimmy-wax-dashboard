'use client';

/* eslint-disable @next/next/no-img-element -- Media is served by the same-origin immutable media proxy. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clipboard, FileImage, FileText, FileVideo, Grid2X2, List, Plus, UploadCloud } from 'lucide-react';

import { Badge, Button, Checkbox, Input, Select, Textarea } from '@/components/ui/core';
import { Card, EmptyState, ErrorState, NotAllowedState, OfflineState, Skeleton } from '@/components/ui/feedback';
import { ConfirmDialog, Dialog, Drawer, ReasonDialog } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { approveMedia, archiveMedia, getMedia, getMediaPage, getMediaUsage, rejectMedia, restoreMedia, updateMedia, uploadMediaFile, type Media, type MediaFilters, type MediaPatch, type MediaUsage } from '@/lib/api/resources/media';
import { composeMediaLicenseEvidence, localMediaUrl, mediaFileError, readMediaPrefix, sniffMediaKind, type MediaKind } from '@/lib/api/resources/media-validation';

import styles from './media-library.module.css';

type Approval = 'draft' | 'approved' | 'rejected';
type Kind = 'image' | 'video' | 'font';
type Provenance = 'original_photo' | 'edited_photo' | 'generated' | 'illustration';
type ViewMode = 'grid' | 'list';
type UploadPhase = 'checking' | 'queued' | 'uploading' | 'created' | 'duplicate' | 'failed' | 'uncertain' | 'cancelled';
type UploadEntry = { key: string; file: File; kind: MediaKind | null; alt: string; decorative: boolean; phase: UploadPhase; percent: number; message?: string; requestId?: string; mediaId?: string };
type MediaDraft = { alt: string; decorative: boolean; tags: string; folder: string; role: string; provenance: Provenance; license: string; rightsHolder: string; provenanceNote: string; consentReference: string; posterMediaId: string };

const approvals: Approval[] = ['draft', 'approved', 'rejected'];
const kinds: Kind[] = ['image', 'video', 'font'];
const provenances: Provenance[] = ['original_photo', 'edited_photo', 'generated', 'illustration'];

function mediaLabel(value: string): string { return value.replaceAll('_', ' '); }
function isOffline(error: unknown): error is ApiError { return error instanceof ApiError && (error.status === 0 || error.status >= 500 || error.code === 'UNAVAILABLE'); }
function apiError(error: unknown): ApiError | null { return error instanceof ApiError ? error : null; }

function mediaPreviewUrl(media: Media): string | null {
  const variant = media.kind === 'image' ? media.urls.variants.find((item) => item.width !== null && item.width >= 640) ?? media.urls.variants.at(-1) : undefined;
  return localMediaUrl(variant?.url ?? media.urls.original);
}

function mediaTone(media: Media): 'positive' | 'warning' | 'negative' | 'neutral' {
  if (media.archived) return 'neutral';
  if (media.approval === 'approved') return 'positive';
  if (media.approval === 'rejected') return 'negative';
  return 'warning';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function mediaDraftFrom(media: Media): MediaDraft {
  return {
    alt: media.alt, decorative: media.decorative, tags: media.tags.join(', '), folder: media.folder,
    role: media.role ?? '', provenance: media.provenance, license: media.license ?? '', rightsHolder: media.rightsHolder ?? '', provenanceNote: media.provenanceNote ?? '', consentReference: media.consentReference ?? '', posterMediaId: media.posterMediaId ?? '',
  };
}

function MediaGlyph({ kind }: { kind: Kind }): React.ReactNode {
  if (kind === 'video') return <FileVideo size={19} aria-hidden="true" />;
  if (kind === 'font') return <FileText size={19} aria-hidden="true" />;
  return <FileImage size={19} aria-hidden="true" />;
}

function FontSpecimen({ src }: { src: string | null }): React.ReactNode {
  const [fontState, setFontState] = useState('Loading a specimen from the backend asset.');
  useEffect(() => {
    if (!src || typeof FontFace === 'undefined') return;
    const face = new FontFace('jw-media-specimen', `url("${src}")`);
    let active = true;
    void face.load().then((loaded) => {
      if (!active) return;
      document.fonts.add(loaded);
      setFontState('Font loaded from the same-origin media proxy.');
    }).catch(() => { if (active) setFontState('Font could not be rendered; the stored file remains unchanged.'); });
    return () => { active = false; document.fonts.delete(face); };
  }, [src]);
  const state = !src || typeof FontFace === 'undefined' ? 'This browser cannot load a local font specimen.' : fontState;
  return <div className={styles.fontSpecimen}><p>JIMMY &amp; WAX</p><p>Premium leather care · 0123456789</p><small role="status">{state}</small></div>;
}

function MediaCard({
  media, view, selected, canWrite, onSelect, onOpen,
}: { media: Media; view: ViewMode; selected: boolean; canWrite: boolean; onSelect: (checked: boolean) => void; onOpen: () => void }): React.ReactNode {
  const preview = mediaPreviewUrl(media);
  return <article className={`${styles.asset} ${view === 'list' ? styles.assetList : ''}`}>
    <div className={styles.preview}>
      {media.kind === 'image' && preview ? <img src={preview} alt={media.decorative ? '' : media.alt} loading="lazy" decoding="async" /> :
        <span className={styles.glyph}><MediaGlyph kind={media.kind} /></span>}
      <span className={styles.type}>{media.kind}</span>
    </div>
    <div className={styles.assetContent}>
      <div className={styles.assetHeading}>
        <div><p className={styles.folder}>{media.folder || 'Unfiled'} · {formatBytes(media.bytes)}</p><h2>{media.filename}</h2></div>
        <Badge tone={mediaTone(media)}>{media.archived ? 'Archived' : media.approval === 'draft' ? 'Draft' : mediaLabel(media.approval)}</Badge>
      </div>
      <p className={styles.alt}>{media.decorative ? 'Decorative image' : media.alt || 'Alternative text not supplied'}</p>
      <div className={styles.meta}><span>{mediaLabel(media.provenance)}</span>{media.role ? <span>{mediaLabel(media.role)}</span> : null}</div>
      {media.approval === 'rejected' && media.approvalNote ? <p className={styles.rejected}>Review note: {media.approvalNote}</p> : null}
      {media.kind === 'video' ? <p className={styles.metaUnknown}>Duration and dimensions are not reported by the backend.</p> : null}
      <div className={styles.assetActions}>
        <Button variant="secondary" size="sm" onClick={onOpen}>Review {media.filename}</Button>
        {canWrite && !media.archived && media.approval === 'approved' ? <Checkbox label="Select approved URL" checked={selected} onChange={onSelect} /> : null}
      </div>
    </div>
  </article>;
}

function MediaDetail({
  id, canWrite, canReview, onClose,
}: { id: string | null; canWrite: boolean; canReview: boolean; onClose: () => void }): React.ReactNode {
  const queryClient = useQueryClient();
  const [draftState, setDraftState] = useState<{ id: string; value: MediaDraft } | null>(null);
  const [noticeState, setNoticeState] = useState<{ id: string; value: string } | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [confirmReviewReset, setConfirmReviewReset] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [lifecycle, setLifecycle] = useState<'archive' | 'restore' | null>(null);
  const [lifecyclePending, setLifecyclePending] = useState(false);
  const [blockers, setBlockers] = useState<Array<{ type: string; id: string; label: string }>>([]);
  const [packagingState, setPackagingState] = useState<{ id: string; checked: boolean } | null>(null);
  const detail = useQuery({ queryKey: id ? queryKeys.media.detail(id) : ['media', 'detail', 'closed'], queryFn: ({ signal }) => getMedia(id!, signal), enabled: Boolean(id), retry: false });
  const usage = useQuery({ queryKey: id ? queryKeys.media.usage(id) : ['media', 'usage', 'closed'], queryFn: ({ signal }) => getMediaUsage(id!, signal), enabled: Boolean(id), retry: false, staleTime: 15_000 });
  const media = detail.data;
  const draft = media ? (draftState?.id === media.id ? draftState.value : mediaDraftFrom(media)) : null;
  const notice = media && noticeState?.id === media.id ? noticeState.value : '';
  const packagingAttested = Boolean(media && packagingState?.id === media.id && packagingState.checked);
  const setDraft = (value: MediaDraft) => { if (media) setDraftState({ id: media.id, value }); };
  const setNotice = (value: string) => { if (media) setNoticeState({ id: media.id, value }); };
  const setPackagingAttested = (checked: boolean) => { if (media) setPackagingState({ id: media.id, checked }); };
  const preview = media ? mediaPreviewUrl(media) : null;
  const hasChanges = Boolean(media && draft && (
    draft.alt !== media.alt || draft.decorative !== media.decorative || draft.tags !== media.tags.join(', ') ||
    draft.folder !== media.folder || draft.role !== (media.role ?? '') || draft.provenance !== media.provenance ||
    draft.license !== (media.license ?? '') || draft.posterMediaId !== (media.posterMediaId ?? '') ||
    draft.rightsHolder !== (media.rightsHolder ?? '') || draft.provenanceNote !== (media.provenanceNote ?? '') || draft.consentReference !== (media.consentReference ?? '')
  ));
  const reviewWillReset = Boolean(media?.approval === 'approved' && draft && (draft.provenance !== media.provenance || draft.role !== (media.role ?? '')));
  const mayApprove = Boolean(media && canReview && !media.archived && media.status === 'ready' && media.approval !== 'approved' &&
    (media.kind !== 'image' || media.decorative || media.alt.trim().length >= 3) &&
    (media.role !== 'product_packshot' || media.provenance === 'original_photo' || media.provenance === 'edited_photo') &&
    (media.provenance !== 'generated' || packagingAttested) && (media.kind !== 'video' || media.posterMediaId) &&
    (media.kind !== 'font' || Boolean(media.license?.trim())));

  const refreshMedia = async (next: Media) => {
    queryClient.setQueryData(queryKeys.media.detail(next.id), next);
    await queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
    await queryClient.invalidateQueries({ queryKey: queryKeys.media.usage(next.id) });
  };

  const save = async () => {
    if (!media || !draft || !hasChanges) return;
    const patch: MediaPatch = {};
    const tags = draft.tags.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean);
    const role = draft.role ? draft.role as NonNullable<Media['role']> : null;
    const license = draft.license.trim() || null;
    const posterMediaId = draft.posterMediaId.trim() || null;
    if (draft.alt.trim() !== media.alt) patch.alt = draft.alt.trim();
    if (draft.decorative !== media.decorative) patch.decorative = draft.decorative;
    if (tags.join('\u0000') !== media.tags.join('\u0000')) patch.tags = tags;
    if (draft.folder.trim() !== media.folder) patch.folder = draft.folder.trim();
    if (role !== media.role) patch.role = role;
    if (draft.provenance !== media.provenance) patch.provenance = draft.provenance;
    if (license !== media.license) patch.license = license;
    const rightsHolder = draft.rightsHolder.trim() || null;
    const provenanceNote = draft.provenanceNote.trim() || null;
    const consentReference = draft.consentReference.trim() || null;
    if (rightsHolder !== media.rightsHolder) patch.rightsHolder = rightsHolder;
    if (provenanceNote !== media.provenanceNote) patch.provenanceNote = provenanceNote;
    if (consentReference !== media.consentReference) patch.consentReference = consentReference;
    if (posterMediaId !== media.posterMediaId) patch.posterMediaId = posterMediaId;
    if (Object.keys(patch).length === 0) return;
    try {
      const updated = await updateMedia(media.id, patch);
      await refreshMedia(updated);
      setDraft(mediaDraftFrom(updated));
      setConfirmReviewReset(false);
      setNotice('Metadata saved from the backend.');
    } catch (error) { setNotice(error instanceof ApiError ? `${error.message}${error.requestId ? ` (Request ID: ${error.requestId})` : ''}` : 'Metadata save failed. Refresh before trying again.'); }
  };

  const approve = async () => {
    if (!media || !mayApprove) return;
    try {
      await refreshMedia(await approveMedia(media.id, { ...(media.provenance === 'generated' ? { packagingAttested: true } : {}) }));
      setConfirmApprove(false);
      setNotice('Approval saved. This review status does not make the public URL private or control URL access.');
    } catch (error) { setNotice(error instanceof ApiError ? `${error.message}${error.requestId ? ` (Request ID: ${error.requestId})` : ''}` : 'Approval failed. Refresh and check the review state before another attempt.'); }
  };

  const runLifecycle = async (reason: string) => {
    if (!media || !lifecycle) return;
    const action = lifecycle;
    setLifecyclePending(true);
    setBlockers([]);
    try {
      await (action === 'archive' ? archiveMedia : restoreMedia)(media.id, { expectedUpdatedAt: media.updatedAt, reason });
      setLifecycle(null);
      await refreshMedia(await getMedia(media.id));
      setNotice(action === 'archive' ? 'Asset archived. It is no longer served publicly.' : 'Asset restored.');
    } catch (error) {
      setLifecycle(null);
      if (error instanceof ApiError && error.code === 'CART_VERSION_CONFLICT') {
        await queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
        setNotice('This asset changed while you were looking at it. The latest copy is loaded; review it and try again.');
      } else if (error instanceof ApiError && error.code === 'ILLEGAL_STATE' && error.lines?.length) {
        setBlockers(error.lines.filter((line): line is { type: string; id: string; label: string } => typeof line === 'object' && line !== null && 'label' in line).slice(0, 50));
        setNotice(`Not archived: it is still referenced${error.requestId ? ` (Request ID: ${error.requestId})` : ''}. Remove the references listed below first.`);
      } else setNotice(error instanceof ApiError ? `${error.message}${error.requestId ? ` (Request ID: ${error.requestId})` : ''}` : 'The change did not complete. Refresh before trying again.');
    } finally { setLifecyclePending(false); }
  };

  const reject = async (reason: string) => {
    if (!media || !canReview) return;
    try {
      await refreshMedia(await rejectMedia(media.id, reason));
      setRejectOpen(false);
      setNotice('Rejection note saved. The asset remains visible in the library.');
    } catch (error) { setNotice(error instanceof ApiError ? `${error.message}${error.requestId ? ` (Request ID: ${error.requestId})` : ''}` : 'Rejection failed. Refresh before making another decision.'); }
  };

  return <Drawer open={Boolean(id)} onOpenChange={(open) => { if (!open) { if (id && draftState?.id === id) setDraftState(null); onClose(); } }} title={media?.filename ?? 'Media details'} className={styles.drawer ?? ''}>
    {!media && detail.isLoading ? <Skeleton lines={5} /> : null}
    {!media && detail.error ? <ErrorState title="Media details unavailable" requestId={apiError(detail.error)?.requestId} actionLabel="Retry" onAction={() => void detail.refetch()}>The media record could not be loaded from the backend. No cached substitute is shown.</ErrorState> : null}
    {media && draft ? <div className={styles.detail}>
      <div className={styles.detailPreview}>
        {media.kind === 'image' && preview ? <img src={preview} alt={media.decorative ? '' : media.alt} /> :
          media.kind === 'video' && preview ? <video controls preload="metadata" aria-label={media.alt || media.filename}><source src={preview} type={media.mime} /></video> :
          media.kind === 'font' ? <FontSpecimen key={media.id} src={preview} /> : <div className={styles.glyph}><MediaGlyph kind={media.kind} /></div>}
      </div>
      <div className={styles.publicWarning} role="note"><strong>{media.approval === 'approved' && !media.archived ? 'Approved: publicly retrievable.' : 'Not public: only operators can preview this asset.'}</strong><span>{media.approval === 'approved' && !media.archived ? 'Approved media is served with year-long caching. Rejecting or archiving it later stops the origin, but copies already cached by browsers or a CDN cannot be recalled.' : 'Drafts, rejected and archived assets are served only to signed-in operators through the preview route and answer 404 publicly.'}</span></div>
      <dl className={styles.facts}>
        <div><dt>Status</dt><dd>{media.status}</dd></div><div><dt>Review</dt><dd>{mediaLabel(media.approval)}</dd></div>
        <div><dt>Provenance</dt><dd>{mediaLabel(media.provenance)}</dd></div><div><dt>Size</dt><dd>{formatBytes(media.bytes)}</dd></div>
        <div><dt>Dimensions</dt><dd>{media.width !== null && media.height !== null ? `${media.width} × ${media.height}` : 'Not reported'}</dd></div>
        <div><dt>Duration</dt><dd>{media.durationMs === null ? 'Not reported' : `${Math.round(media.durationMs / 1000)} seconds`}</dd></div>
        {media.bundledKey ? <div><dt>Bundled in the app as</dt><dd>{media.bundledKey}</dd></div> : null}
      </dl>
      {media.approval === 'rejected' && media.approvalNote ? <p className={styles.rejected}>Reviewer note: {media.approvalNote}</p> : null}
      {media.license || media.rightsHolder ? <p className={styles.license}><strong>Rights / licence evidence</strong>{media.rightsHolder ? <span>Rights holder: {media.rightsHolder}</span> : null}{media.provenanceNote ? <span>Provenance: {media.provenanceNote}</span> : null}{media.consentReference ? <span>Consent reference: {media.consentReference}</span> : null}{media.license ? <span>{media.license}</span> : null}</p> : <p className={styles.rejected}>No rights evidence is recorded.</p>}
      {localMediaUrl(media.urls.original) ? <a className={styles.url} href={localMediaUrl(media.urls.original) ?? undefined} target="_blank" rel="noreferrer">Open asset (operator preview)</a> : <p>Backend URL is not a supported content-addressed path.</p>}
      {!usage.isLoading && !usage.error && usage.data ? <section className={styles.usage} aria-labelledby="media-usage-title">
        <h3 id="media-usage-title">Where used · {usage.data.items.length} reference{usage.data.items.length === 1 ? '' : 's'} reported</h3>
        {usage.data.items.length ? <ul>{usage.data.items.map((item) => <li key={`${item.type}:${item.id}`}><span>{mediaLabel(item.type)}</span> · {item.label}</li>)}</ul> : <p>No references were returned by the current backend.</p>}
        <p className={styles.metaUnknown}>Complete list: products, categories, library entries, Studio drafts, live releases and campaigns. An asset with any reference cannot be archived.</p>
      </section> : null}
      {usage.isLoading ? <p role="status">Loading usage…</p> : null}
      {usage.error ? <p className={styles.error} role="alert">Usage could not be loaded{apiError(usage.error)?.requestId ? ` · Request ID: ${apiError(usage.error)?.requestId}` : ''}.</p> : null}
      {canWrite ? <section className={styles.editor} aria-labelledby="media-editor-title">
        <h3 id="media-editor-title">Metadata</h3>
        <p className={styles.muted}>Metadata saves are not version-guarded. Check with another operator who may have this item open before saving.</p>
        <Input label="Alternative text" value={draft.alt} maxLength={200} onChange={(event) => setDraft({ ...draft, alt: event.target.value })} />
        {media.kind === 'image' ? <Checkbox label="Mark as decorative (screen readers will skip this image)" checked={draft.decorative} onChange={(decorative) => setDraft({ ...draft, decorative, ...(decorative ? { alt: '' } : {}) })} /> : null}
        <Input label="Tags (comma separated)" value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} />
        <Input label="Folder" value={draft.folder} maxLength={80} onChange={(event) => setDraft({ ...draft, folder: event.target.value })} />
        <Select label="Provenance" value={draft.provenance} onChange={(event) => setDraft({ ...draft, provenance: event.target.value as Provenance })}>
          {provenances.map((value) => <option key={value} value={value}>{mediaLabel(value)}</option>)}
        </Select>
        <Select label="Asset role" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })}>
          <option value="">No role</option>{['product_packshot', 'campaign', 'brand', 'mascot', 'state_art', 'avatar', 'poster', 'font'].map((value) => <option key={value} value={value}>{mediaLabel(value)}</option>)}
        </Select>
        <Input label="Rights holder" value={draft.rightsHolder} maxLength={200} onChange={(event) => setDraft({ ...draft, rightsHolder: event.target.value })} />
        <Textarea label="Provenance note" value={draft.provenanceNote} maxLength={500} description="Where the asset came from and how it was made. Avoid personal contact details." onChange={(event) => setDraft({ ...draft, provenanceNote: event.target.value })} />
        <Input label="Consent reference" value={draft.consentReference} maxLength={200} description="Reference to a signed release when a person appears in the asset." onChange={(event) => setDraft({ ...draft, consentReference: event.target.value })} />
        <Textarea label="Licence summary" value={draft.license} maxLength={300} onChange={(event) => setDraft({ ...draft, license: event.target.value })} />
        {media.kind === 'video' ? <Input label="Poster media ID" value={draft.posterMediaId} maxLength={36} description="A video cannot be approved until a poster image is selected. Enter an existing media UUID." onChange={(event) => setDraft({ ...draft, posterMediaId: event.target.value })} /> : null}
        {notice ? <p role="status" className={styles.notice}>{notice}</p> : null}
        {reviewWillReset ? <p className={styles.reviewResetWarning} role="note">Changing provenance or role on an approved asset will reset its review to Draft in the backend. It will need Admin review again.</p> : null}
        <Button onClick={() => { if (reviewWillReset) setConfirmReviewReset(true); else void save(); }} disabled={!hasChanges}>Save metadata</Button>
      </section> : null}
      {canReview ? <section className={styles.review} aria-labelledby="media-review-title">
        <h3 id="media-review-title">Admin review</h3>
        {media.provenance === 'generated' ? <Checkbox label="I verified the generated image does not alter product packaging or labels" checked={packagingAttested} onChange={setPackagingAttested} /> : null}
        <div className={styles.actions}>
          <Button onClick={() => setConfirmApprove(true)} disabled={!mayApprove}>Approve for use</Button>
          <Button variant="danger" onClick={() => setRejectOpen(true)} disabled={media.archived || media.approval === 'rejected'}>Reject with note</Button>
        </div>
        {!mayApprove && media.approval !== 'approved' ? <p className={styles.muted}>Approval requirements are incomplete or this item is not ready. Check alt text, product-photo provenance, generated packaging review, video poster, and font licence.</p> : null}
      </section> : null}
      {canWrite ? <section className={styles.archiveNote} aria-labelledby="media-lifecycle-title">
        <h3 id="media-lifecycle-title">{media.archived ? 'Archived asset' : 'Archive'}</h3>
        <span>{media.archived ? 'Restoring puts the asset back in the library. It keeps its review state.' : 'Archiving removes the asset from public serving. It is refused while anything still references it, and the references are listed here so you can replace them first.'}</span>
        {blockers.length ? <ul aria-label="References that block archiving">{blockers.map((blocker) => <li key={`${blocker.type}:${blocker.id}`}><span>{mediaLabel(blocker.type)}</span> · {blocker.label}</li>)}</ul> : null}
        <Button variant={media.archived ? 'secondary' : 'danger'} onClick={() => { setBlockers([]); setLifecycle(media.archived ? 'restore' : 'archive'); }}>{media.archived ? 'Restore asset' : 'Archive asset'}</Button>
      </section> : null}
    </div> : null}
    <ConfirmDialog open={confirmApprove} onOpenChange={setConfirmApprove} phrase="APPROVE ASSET" title="Approve media for customer-facing use" onConfirm={() => void approve()}>
      Review the stored rights evidence and source. The public URL is already retrievable; this action does not make it public. Approval allows the asset to be selected in downstream experiences.
    </ConfirmDialog>
    <ConfirmDialog open={confirmReviewReset} onOpenChange={setConfirmReviewReset} phrase="RESET REVIEW" title="Save and reset media approval" onConfirm={() => void save()}>
      This edit changes provenance or role, so the backend will turn the approved asset back into a draft. It will no longer qualify for new Studio selection until an Admin reviews it again.
    </ConfirmDialog>
    <ReasonDialog open={lifecycle !== null} onOpenChange={(open) => { if (!open) setLifecycle(null); }} title={lifecycle === 'restore' ? 'Restore this media asset' : 'Archive this media asset'} pending={lifecyclePending} onConfirm={(reason) => void runLifecycle(reason)}>
      {lifecycle === 'restore' ? 'Explain why this asset is coming back. The reason is stored in the audit log.' : 'Explain why this asset is being retired. If anything still references it the backend refuses and lists what to replace first. The reason is stored in the audit log.'}
    </ReasonDialog>
    <ReasonDialog open={rejectOpen} onOpenChange={setRejectOpen} title="Reject this media asset" onConfirm={(reason) => void reject(reason)}>
      Explain why the asset must not be selected. The note is saved by the backend and remains visible to operators.
    </ReasonDialog>
  </Drawer>;
}

export function MediaLibrary({ canWrite, canReview }: { canWrite: boolean; canReview: boolean }): React.ReactNode {
  const queryClient = useQueryClient();
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<Kind | ''>('');
  const [approval, setApproval] = useState<Approval | ''>('');
  const [provenance, setProvenance] = useState<Provenance | ''>('');
  const [tagDraft, setTagDraft] = useState('');
  const [tag, setTag] = useState('');
  const [archived, setArchived] = useState(false);
  const [usage, setUsage] = useState<'' | 'used' | 'unused'>('');
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [view, setView] = useState<ViewMode>('grid');
  const [selected, setSelected] = useState<Media[]>([]);
  const [copied, setCopied] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadEntries, setUploadEntries] = useState<UploadEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadRequestId, setUploadRequestId] = useState('');
  const [uploadProvenance, setUploadProvenance] = useState<Provenance>('original_photo');
  const [folder, setFolder] = useState('');
  const [rightsHolder, setRightsHolder] = useState('');
  const [evidence, setEvidence] = useState('');
  const [fontLicense, setFontLicense] = useState('');
  const [publicRightsConfirmed, setPublicRightsConfirmed] = useState(false);
  const activeUploads = useRef(new Map<string, AbortController>());
  const resetPage = () => { setCursorStack([null]); setSelected([]); };

  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(searchDraft.trim().slice(0, 100)); setCursorStack([null]); setSelected([]); }, 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);
  useEffect(() => {
    const timer = window.setTimeout(() => { setTag(tagDraft.trim().slice(0, 40)); setCursorStack([null]); setSelected([]); }, 250);
    return () => window.clearTimeout(timer);
  }, [tagDraft]);

  const filters = useMemo<MediaFilters>(() => ({
    q: search, kind: kind || undefined, approval: approval || undefined, provenance: provenance || undefined,
    tag: tag.trim() || undefined, archived, inUse: usage === '' ? undefined : usage === 'used', limit: 30,
  }), [approval, archived, kind, provenance, search, tag, usage]);
  const cursor = cursorStack.at(-1) ?? null;
  const list = useQuery({ queryKey: queryKeys.media.list(filters, cursor), queryFn: ({ signal }) => getMediaPage(filters, cursor, signal), staleTime: 15_000, retry: false });
  const items = list.data?.items ?? [];
  const selectionBlocked = selected.some((media) => media.approval !== 'approved' || media.archived);

  const setEntry = (key: string, update: Partial<UploadEntry>) => setUploadEntries((current) => current.map((entry) => entry.key === key ? { ...entry, ...update } : entry));
  const addFiles = (files: FileList | File[]) => {
    const additions = Array.from(files).slice(0, Math.max(0, 10 - uploadEntries.length));
    const entries = additions.map((file) => ({ key: crypto.randomUUID(), file, kind: null, alt: '', decorative: false, phase: 'checking' as const, percent: 0 }));
    setUploadEntries((current) => [...current, ...entries]);
    if (files.length > additions.length) setUploadError('A single upload batch is limited to 10 files.');
    else setUploadError('');
    for (const entry of entries) {
      void readMediaPrefix(entry.file).then((bytes) => {
        const kind = sniffMediaKind(bytes);
        const error = mediaFileError(kind, entry.file.size);
        setEntry(entry.key, { kind, phase: error ? 'failed' : 'queued', ...(error ? { message: error } : { message: `Signature verified as ${kind}.` }) });
      }).catch(() => setEntry(entry.key, { phase: 'failed', message: 'The selected file could not be read.' }));
    }
  };

  const runUploads = async () => {
    const license = composeMediaLicenseEvidence({ rightsHolder, evidence, fontLicense });
    if (!uploadEntries.some((entry) => entry.phase === 'queued')) { setUploadError('Choose at least one file.'); return; }
    if (uploadEntries.some((entry) => entry.phase === 'checking')) { setUploadError('Wait for file signature checks to finish before uploading.'); return; }
    if (!license) { setUploadError('Provide a rights holder and source/consent evidence. Combined text must fit the 300-character licence summary.'); return; }
    if (!publicRightsConfirmed) { setUploadError('Confirm that these files may be used publicly once approved.'); return; }
    const queued = uploadEntries.filter((entry) => entry.phase === 'queued');
    setUploading(true); setUploadError(''); setUploadRequestId('');
    for (const entry of queued) {
      if (!entry.alt.trim() && !entry.decorative) { setEntry(entry.key, { phase: 'failed', message: 'Add alt text or explicitly mark this asset decorative.' }); continue; }
      if (entry.file.size === 0) { setEntry(entry.key, { phase: 'failed', message: 'The selected file is empty.' }); continue; }
      const controller = new AbortController();
      activeUploads.current.set(entry.key, controller);
      setEntry(entry.key, { phase: 'uploading', percent: 0 });
      try {
        const uploaded = await uploadMediaFile(entry.file, {
          ...(entry.alt.trim() ? { alt: entry.alt.trim() } : {}), ...(entry.kind === 'image' && entry.decorative ? { decorative: true } : {}), provenance: uploadProvenance,
          ...(folder.trim() ? { folder: folder.trim() } : {}), license,
          rightsHolder: rightsHolder.trim(), provenanceNote: evidence.trim(),
        }, { signal: controller.signal, onProgress: (progress) => setEntry(entry.key, { percent: progress.percent }) });
        if (entry.decorative && !uploaded.duplicate) {
          await updateMedia(uploaded.id, { decorative: true });
        }
        setEntry(entry.key, { phase: uploaded.duplicate ? 'duplicate' : 'created', percent: 100, mediaId: uploaded.id, message: uploaded.duplicate ? 'Same bytes already exist; existing metadata was not changed.' : 'Uploaded as a pending asset.' });
        await queryClient.invalidateQueries({ queryKey: queryKeys.media.all });
      } catch (error) {
        const err = apiError(error);
        const uncertain = !err || err.status === 0 || err.status >= 500 || err.code === 'TIMEOUT' || err.code === 'REQUEST_CANCELLED';
        setEntry(entry.key, {
          phase: uncertain ? (err?.code === 'REQUEST_CANCELLED' ? 'cancelled' : 'uncertain') : 'failed',
          message: uncertain ? 'Final status is unknown. Refresh/search the library before any retry.' : (err?.message ?? 'Upload failed.'),
          ...(err?.requestId ? { requestId: err.requestId } : {}),
        });
        if (err?.requestId) setUploadRequestId(err.requestId);
      } finally { activeUploads.current.delete(entry.key); }
    }
    setUploading(false);
  };

  const copySelected = async () => {
    if (!selected.length || selectionBlocked) return;
    const urls = selected.map((media) => localMediaUrl(media.urls.original)).filter((url): url is string => Boolean(url));
    if (!urls.length) return;
    try { await navigator.clipboard.writeText(urls.join('\n')); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }
    catch { setUploadError('Clipboard access was denied. Open an approved asset to copy its URL.'); }
  };

  const updateSelected = (media: Media, checked: boolean) => setSelected((current) => checked ? [...current.filter((item) => item.id !== media.id), media] : current.filter((item) => item.id !== media.id));
  const resetUpload = () => {
    if (uploading) return;
    setUploadOpen(false); setUploadEntries([]); setUploadError(''); setUploadRequestId(''); setPublicRightsConfirmed(false);
    setRightsHolder(''); setEvidence(''); setFontLicense(''); setFolder(''); setUploadProvenance('original_photo');
  };
  const queryError = apiError(list.error);

  return <div className={styles.workspace}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>Asset governance · one storefront</p><h1>Media library</h1><p>Find, describe and review the images, videos and fonts used by Jimmy &amp; Wax.</p></div>
      {canWrite ? <Button onClick={() => setUploadOpen(true)}><Plus size={16} aria-hidden="true" /> Upload assets</Button> : null}
    </header>

    <section className={styles.publicWarning} role="note" aria-label="Important public media warning">
      <strong>Approved media becomes publicly retrievable.</strong>
      <span>New uploads start as drafts that only operators can preview. Once an Admin approves an asset it is served publicly with year-long caching, and later removal cannot recall cached copies. Do not upload customer photos, confidential files or assets without documented public-use rights.</span>
    </section>

    <Card className={styles.queueCard}>
      <div className={styles.queueHead}><div><p className={styles.eyebrow}>Review desk</p><h2>Approval queue</h2><p>Draft items can be reviewed by an Admin only. This count covers the current server page, not the entire library.</p></div>
        <Button variant={approval === 'draft' ? 'primary' : 'secondary'} onClick={() => { setApproval(approval === 'draft' ? '' : 'draft'); resetPage(); }}> {approval === 'draft' ? 'Show all media' : 'Show draft queue'}</Button>
      </div>
    </Card>

    <Card className={styles.libraryCard}>
      <div className={styles.libraryTop}><div><p className={styles.eyebrow}>Library</p><h2>Assets</h2><p>{list.data ? `${items.length} assets on this page` : 'Loading backend assets'}. Open an item to see exactly where it is used.</p></div>
        <div className={styles.viewButtons} aria-label="Media layout">
          <Button variant={view === 'grid' ? 'primary' : 'secondary'} size="sm" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Grid2X2 size={15} aria-hidden="true" /> Grid</Button>
          <Button variant={view === 'list' ? 'primary' : 'secondary'} size="sm" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={15} aria-hidden="true" /> List</Button>
        </div>
      </div>
      <div className={styles.filters}>
        <Input label="Search media" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Filename or alt text" />
        <Select label="Filter media by type" value={kind} onChange={(event) => { setKind(event.target.value as Kind | ''); resetPage(); }}><option value="">All types</option>{kinds.map((value) => <option key={value} value={value}>{mediaLabel(value)}</option>)}</Select>
        <Select label="Filter media by approval" value={approval} onChange={(event) => { setApproval(event.target.value as Approval | ''); resetPage(); }}><option value="">All approvals</option>{approvals.map((value) => <option key={value} value={value}>{mediaLabel(value)}</option>)}</Select>
        <Select label="Filter media by provenance" value={provenance} onChange={(event) => { setProvenance(event.target.value as Provenance | ''); resetPage(); }}><option value="">All provenance</option>{provenances.map((value) => <option key={value} value={value}>{mediaLabel(value)}</option>)}</Select>
        <Input label="Filter media by tag" value={tagDraft} maxLength={40} onChange={(event) => setTagDraft(event.target.value)} placeholder="e.g. product" />
        <Select label="Archived media" value={archived ? 'true' : 'false'} onChange={(event) => { setArchived(event.target.value === 'true'); resetPage(); }}><option value="false">Active assets</option><option value="true">Archived assets</option></Select>
        <Select label="Filter media by usage" value={usage} onChange={(event) => { setUsage(event.target.value as '' | 'used' | 'unused'); resetPage(); }}><option value="">Used and unused</option><option value="used">In use</option><option value="unused">Unused</option></Select>
      </div>

      {selected.length ? <div className={styles.selectionBar} role="status"><span>{selected.length} approved asset{selected.length === 1 ? '' : 's'} selected</span>
        {selectionBlocked ? <span>Remove unapproved/archived assets before copying URLs.</span> : <Button variant="secondary" size="sm" onClick={() => void copySelected()}><Clipboard size={14} aria-hidden="true" /> {copied ? 'Copied' : 'Copy approved URLs'}</Button>}
        <Button variant="quiet" size="sm" onClick={() => setSelected([])}>Clear selection</Button>
      </div> : null}

      {list.isLoading ? <Skeleton lines={5} /> : null}
      {!list.data && list.error && queryError?.status === 403 ? <NotAllowedState title="Media access denied" requestId={queryError.requestId}>Your role cannot read the media library. Ask an administrator if this is unexpected.</NotAllowedState> : null}
      {!list.data && list.error && isOffline(list.error) ? <OfflineState title="Media service unavailable" requestId={queryError?.requestId} actionLabel="Retry" onAction={() => void list.refetch()}>The library could not reach the backend. No sample files are substituted.</OfflineState> : null}
      {!list.data && list.error && queryError?.status !== 403 && !isOffline(list.error) ? <ErrorState title="Media library could not load" requestId={queryError?.requestId} actionLabel="Retry" onAction={() => void list.refetch()}>The backend response was unavailable or did not match the media contract. No fallback assets are shown.</ErrorState> : null}
      {list.isRefetchError ? <p className={styles.stale} role="alert">Refresh failed. The displayed page may be stale; check the request reference before acting. {queryError?.requestId ? `Request ID: ${queryError.requestId}` : ''}</p> : null}
      {list.data && items.length === 0 ? <EmptyState title="No media matches these filters" actionLabel="Clear filters" onAction={() => { setSearchDraft(''); setSearch(''); setKind(''); setApproval(''); setProvenance(''); setTagDraft(''); setTag(''); setArchived(false); setUsage(''); resetPage(); }}>No sample or placeholder media is shown. Upload an asset or change the server-side filters.</EmptyState> : null}
      {list.data && items.length ? <div className={view === 'grid' ? styles.assets : styles.listView}>
        {items.map((media) => <MediaCard key={media.id} media={media} view={view} canWrite={canWrite} selected={selected.some((item) => item.id === media.id)} onSelect={(checked) => updateSelected(media, checked)} onOpen={() => setDetailId(media.id)} />)}
      </div> : null}
      {list.data ? <nav className={styles.pagination} aria-label="Media pages">
        <Button variant="secondary" disabled={cursorStack.length <= 1 || list.isFetching} onClick={() => { setCursorStack((current) => current.slice(0, -1)); setSelected([]); }}>Previous media page</Button>
        <span>{list.data.nextCursor ? 'More backend results available' : 'End of backend results'}</span>
        <Button variant="secondary" disabled={!list.data.nextCursor || list.isFetching} onClick={() => { setCursorStack((current) => [...current, list.data?.nextCursor ?? null]); setSelected([]); }}>Next media page</Button>
      </nav> : null}
    </Card>

    <MediaDetail id={detailId} canWrite={canWrite} canReview={canReview} onClose={() => setDetailId(null)} />

    <DialogUpload
      open={uploadOpen} dismissible={!uploading} canWrite={canWrite} entries={uploadEntries} setEntry={setEntry}
      onClose={resetUpload} onAddFiles={addFiles} onUpload={() => void runUploads()} uploading={uploading}
      provenance={uploadProvenance} setProvenance={setUploadProvenance} folder={folder} setFolder={setFolder}
      rightsHolder={rightsHolder} setRightsHolder={setRightsHolder} evidence={evidence} setEvidence={setEvidence}
      fontLicense={fontLicense} setFontLicense={setFontLicense} publicRightsConfirmed={publicRightsConfirmed}
      setPublicRightsConfirmed={setPublicRightsConfirmed} error={uploadError} requestId={uploadRequestId}
      onCancelFile={(key) => activeUploads.current.get(key)?.abort()}
      onRemoveFile={(key) => setUploadEntries((current) => current.filter((entry) => entry.key !== key))}
    />
  </div>;
}

function DialogUpload({
  open, dismissible, canWrite, entries, setEntry, onClose, onAddFiles, onUpload, uploading,
  provenance, setProvenance, folder, setFolder, rightsHolder, setRightsHolder, evidence, setEvidence,
  fontLicense, setFontLicense, publicRightsConfirmed, setPublicRightsConfirmed, error, requestId, onCancelFile, onRemoveFile,
}: {
  open: boolean; dismissible: boolean; canWrite: boolean; entries: UploadEntry[]; setEntry: (key: string, update: Partial<UploadEntry>) => void;
  onClose: () => void; onAddFiles: (files: FileList | File[]) => void; onUpload: () => void; uploading: boolean;
  provenance: Provenance; setProvenance: (value: Provenance) => void; folder: string; setFolder: (value: string) => void;
  rightsHolder: string; setRightsHolder: (value: string) => void; evidence: string; setEvidence: (value: string) => void;
  fontLicense: string; setFontLicense: (value: string) => void; publicRightsConfirmed: boolean; setPublicRightsConfirmed: (checked: boolean) => void;
  error: string; requestId: string; onCancelFile: (key: string) => void; onRemoveFile: (key: string) => void;
}): React.ReactNode {
  const inputRef = useRef<HTMLInputElement>(null);
  const composed = composeMediaLicenseEvidence({ rightsHolder, evidence, fontLicense });
  const allowedExtensions = '.jpg,.jpeg,.png,.webp,.mp4,.webm,.woff2,.ttf,.otf';
  const addClipboardOrDrop = (files: FileList | null) => { if (files?.length) onAddFiles(files); };
  return <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }} title="Upload assets" className={styles.uploadDialog ?? ''} dismissible={dismissible} footer={<>
    {dismissible ? <Button variant="secondary" onClick={onClose}>Close</Button> : <span>Uploads are running one at a time. Cancel an active file before closing.</span>}
    <Button onClick={onUpload} loading={uploading} disabled={!canWrite || uploading || !entries.some((entry) => entry.phase === 'queued')}>Upload queued files</Button>
  </>}>
    <div className={styles.uploadForm}>
      <div className={styles.publicWarning}><strong>Drafts stay private until an Admin approves them.</strong><span>Once approved, an asset is public and cached for a year. Do not include customer or confidential material.</span></div>
      <div className={styles.dropzone} role="group" tabIndex={0} aria-label="Choose media files. Focus here to paste files." onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addClipboardOrDrop(event.dataTransfer.files); }} onPaste={(event) => { if (event.clipboardData.files.length) { event.preventDefault(); addClipboardOrDrop(event.clipboardData.files); } }}>
        <UploadCloud size={24} aria-hidden="true" />
        <p>Drop or paste files here, or choose them below.</p>
        <small>JPEG, PNG, WebP, MP4, WebM, WOFF2, TTF, OTF · images/videos ≤15 MiB, fonts ≤2 MiB · up to 10 per batch</small>
        <input ref={inputRef} type="file" multiple accept={allowedExtensions} aria-label="Choose media files" onChange={(event) => { if (event.currentTarget.files) addClipboardOrDrop(event.currentTarget.files); event.currentTarget.value = ''; }} />
      </div>
      {entries.length ? <section className={styles.uploadQueue} aria-label="Upload queue">
        <h3>Files · uploaded sequentially</h3>
        {entries.map((entry) => <article className={styles.uploadItem} key={entry.key}>
          <div><strong>{entry.file.name}</strong><span>{formatBytes(entry.file.size)} · {entry.kind ?? 'checking type'} · {entry.phase}</span>
            {entry.message ? <p role={entry.phase === 'failed' || entry.phase === 'uncertain' ? 'alert' : 'status'}>{entry.message}{entry.requestId ? ` Request ID: ${entry.requestId}` : ''}</p> : null}
          </div>
          {entry.phase === 'uploading' ? <progress aria-label={`Upload progress for ${entry.file.name}`} max={100} value={entry.percent}>{entry.percent}%</progress> : null}
          {entry.phase === 'queued' ? <div className={styles.altFields}><Input label={`Alternative text for ${entry.file.name}`} value={entry.alt} maxLength={200} required={!entry.decorative} onChange={(event) => setEntry(entry.key, { alt: event.target.value })} />
            {entry.kind === 'image' ? <Checkbox label="Decorative image (screen readers will skip it)" checked={entry.decorative} onChange={(decorative) => setEntry(entry.key, { decorative, ...(decorative ? { alt: '' } : {}) })} /> : null}
          </div> : null}
          <div className={styles.fileActions}>{entry.phase === 'uploading' ? <Button variant="danger" size="sm" onClick={() => onCancelFile(entry.key)}>Cancel upload</Button> : entry.phase === 'queued' || entry.phase === 'failed' ? <Button variant="quiet" size="sm" onClick={() => onRemoveFile(entry.key)}>Remove</Button> : null}</div>
        </article>)}
      </section> : null}
      <div className={styles.uploadMetadata}>
        <Select label="Provenance" required value={provenance} onChange={(event) => setProvenance(event.target.value as Provenance)}>{provenances.map((value) => <option key={value} value={value}>{mediaLabel(value)}</option>)}</Select>
        <Input label="Folder" value={folder} maxLength={80} onChange={(event) => setFolder(event.target.value)} placeholder="e.g. catalogue" />
        <Input label="Rights holder" required value={rightsHolder} maxLength={100} onChange={(event) => setRightsHolder(event.target.value)} description="Stored as the structured rights-holder record and summarised in the licence field." />
        <Textarea label="Source / consent evidence" required value={evidence} maxLength={180} onChange={(event) => setEvidence(event.target.value)} description="Use a concise owner permission record or asset provenance note. Avoid personal contact details." />
        <Input label="Font licence (if uploading a font)" value={fontLicense} maxLength={100} onChange={(event) => setFontLicense(event.target.value)} />
        <small className={composed ? styles.valid : styles.invalid}>{composed ? `${composed.length}/300 characters saved in the backend's single license field.` : 'Rights holder and evidence are required; combined metadata must fit 300 characters.'}</small>
      </div>
      <Checkbox label="I confirm the owner has authorized these files for public use once approved." checked={publicRightsConfirmed} onChange={setPublicRightsConfirmed} />
      {error ? <p className={styles.error} role="alert">{error}{requestId ? ` Request ID: ${requestId}` : ''}</p> : null}
    </div>
  </Dialog>;
}
