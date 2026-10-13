'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button, Input, Textarea } from '@/components/ui/core';
import { Dialog } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api/errors';
import { downloadBlob } from '@/lib/api/client';
import { commitCatalogImport, downloadCatalogCsv, dryRunCatalogImport } from '@/lib/api/resources/catalog';
import { queryKeys } from '@/lib/api/query-keys';
import { formatMoney } from '@/lib/format/money';
import type { CatalogCsvImportReport } from '@/lib/api/resources/catalog';

import styles from './catalog-taxonomy.module.css';

const maximumBytes = 2_000_000;
const visibleErrorLimit = 100;

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'The CSV request could not be verified. Check connectivity and the request reference before continuing.';
}

function requestId(error: unknown): string | undefined {
  return error instanceof ApiError ? error.requestId : undefined;
}

function isOffline(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status >= 500 || error.code === 'UNAVAILABLE');
}

function isDenied(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

function readFileBytes(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('The selected file could not be read.'));
    reader.onerror = () => reject(new Error('The selected file could not be read.'));
    reader.onabort = () => reject(new Error('Reading the selected file was cancelled.'));
    reader.readAsArrayBuffer(file);
  });
}

function ErrorMessage({ error, onRetry }: { error: unknown; onRetry?: (() => void) | undefined }): React.ReactNode {
  const title = isDenied(error) ? 'CSV access was denied' : isOffline(error) ? 'CSV service is offline' : 'CSV request failed';
  return <div className={styles.csvError} role="alert">
    <strong>{title}</strong>
    <p>{errorMessage(error)}</p>
    {requestId(error) ? <code>Request ID: {requestId(error)}</code> : null}
    {onRetry ? <Button variant="secondary" size="sm" onClick={onRetry}>Retry export</Button> : null}
  </div>;
}

function ImportReport({ report, reference }: { report: CatalogCsvImportReport; reference?: string }): React.ReactNode {
  const changed = (report.changes ?? []).filter((change) => change.action !== 'unchanged');
  const visibleErrors = report.errors.slice(0, visibleErrorLimit);
  return <section className={styles.csvReport} aria-label="Dry-run report" aria-live="polite">
    <div className={styles.csvReportHead}>
      <div><p className={styles.csvEyebrow}>VALIDATION ONLY</p><h3>Dry-run report</h3></div>
      <span className={styles.csvBadge}>Nothing was applied</span>
    </div>
    {reference ? <code className={styles.csvRequest}>Request ID: <span>{reference}</span></code> : null}
    <p className={styles.csvReportIntro}>{report.rows} data rows checked. This report is a preview only; catalogue records and prices were not changed.</p>
    <dl className={styles.csvCounts}>
      <div><dt>Products to create</dt><dd>{report.products.create}</dd></div>
      <div><dt>Products to update</dt><dd>{report.products.update}</dd></div>
      <div><dt>Variants to create</dt><dd>{report.variants.create}</dd></div>
      <div><dt>Variants to update</dt><dd>{report.variants.update}</dd></div>
      <div><dt>Row errors</dt><dd>{report.errors.length}</dd></div>
    </dl>
    {report.errors.length ? <>
      <h4>Rows to review</h4>
      <ol className={styles.csvErrors}>
        {visibleErrors.map((item, index) => <li key={`${item.row}-${item.field ?? 'row'}-${index}`}>
          <span>Row {item.row}{item.field ? ` · ${item.field}` : ''}</span>
          <p>{item.message}</p>
        </li>)}
      </ol>
      {report.errors.length > visibleErrorLimit ? <p className={styles.csvNote}>{report.errors.length - visibleErrorLimit} additional row errors are not shown.</p> : null}
    </> : <p className={styles.csvSuccess}>No row errors were reported. This is still only a dry run—nothing was applied.</p>}
    {changed.length ? <>
      <h4>Exact changes in this file ({changed.length}{(report.changes ?? []).length >= 500 ? '+' : ''})</h4>
      <ul className={styles.csvErrors} aria-label="Changes in this import">
        {changed.slice(0, visibleErrorLimit).map((change) => <li key={`${change.kind}-${change.id}`}>
          <span>{change.kind === 'product' ? 'Product' : 'Variant'} · {change.id} · {change.action}</span>
          <p>{change.fields.length ? `Changes: ${change.fields.join(', ')}` : 'New record'}{change.priceChange ? ` · price ${change.priceChange.fromPaise === null ? 'not set' : formatMoney(change.priceChange.fromPaise, { showPaise: true })} → ${change.priceChange.toPaise === null ? 'not set' : formatMoney(change.priceChange.toPaise, { showPaise: true })}` : ''}</p>
        </li>)}
      </ul>
    </> : null}
  </section>;
}

export function CatalogCsvTools({ canWrite }: { canWrite: boolean }): React.ReactNode {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [exportError, setExportError] = useState<unknown>(null);
  const [exportMessage, setExportMessage] = useState('');
  const [exporting, setExporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);
  const queryClient = useQueryClient();
  // The exact bytes that were previewed are kept in memory so the commit sends the same file the operator reviewed.
  const previewTextRef = useRef<string | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitReason, setCommitReason] = useState('');
  const [appliedMessage, setAppliedMessage] = useState('');
  const [previewReady, setPreviewReady] = useState(false);

  const dryRun = useMutation({
    mutationFn: async () => {
      const file = fileRef.current;
      if (!file) throw new Error('Choose a CSV file before running its dry run.');
      const bytes = await readFileBytes(file);
      let csvText: string;
      try {
        csvText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new Error('Choose a valid UTF-8 CSV file. It was not sent to the backend.');
      }
      if (!csvText.trim()) throw new Error('Choose a non-empty CSV file.');
      previewTextRef.current = null;
      setPreviewReady(false);
      setAppliedMessage('');
      const result = await dryRunCatalogImport(csvText);
      const usable = Boolean(result.report.previewHash) && result.report.errors.length === 0;
      previewTextRef.current = usable ? csvText : null;
      setPreviewReady(usable);
      return result;
    },
    retry: false,
    onSettled: () => {
      fileRef.current = null;
      setSelectedFile(null);
      if (inputRef.current) inputRef.current.value = '';
    },
  });

  const commit = useMutation({
    mutationFn: async () => {
      const text = previewTextRef.current;
      const hash = dryRun.data?.report.previewHash;
      if (!text || !hash) throw new Error('Run a dry run with no row errors first; the file is kept only until you apply or discard it.');
      return commitCatalogImport(text, { previewHash: hash, reason: commitReason.trim() });
    },
    retry: false,
    onSuccess: async (result) => {
      setCommitOpen(false);
      setCommitReason('');
      previewTextRef.current = null;
      setPreviewReady(false);
      dryRun.reset();
      setAppliedMessage(`Import applied: ${result.report.products.create} product(s) created, ${result.report.products.update} updated, ${result.report.variants.create} variant(s) created, ${result.report.variants.update} updated.${result.requestId ? ` Request ID ${result.requestId}.` : ''}`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.catalog.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
    },
    onError: () => setCommitOpen(false),
  });
  const reasonValid = commitReason.trim().length >= 3 && commitReason.trim().length <= 300;
  const applicable = canWrite && Boolean(dryRun.data?.report.previewHash) && dryRun.data?.report.errors.length === 0 && previewReady && (dryRun.data?.report.changes?.some((change) => change.action !== 'unchanged') ?? false);

  const handleExport = async () => {
    setExportError(null);
    setExportMessage('');
    setExporting(true);
    try {
      const result = await downloadCatalogCsv();
      downloadBlob(result);
      setExportMessage(`Download started: ${result.filename}${result.requestId ? ` · Request ID ${result.requestId}` : ''}`);
    } catch (error) {
      setExportError(error);
    } finally {
      setExporting(false);
    }
  };

  const chooseFile = (file: File | null) => {
    dryRun.reset();
    commit.reset();
    previewTextRef.current = null;
    setPreviewReady(false);
    setAppliedMessage('');
    setFileError('');
    fileRef.current = null;
    setSelectedFile(null);
    if (!file) return;
    if (!file.name.toLocaleLowerCase('en-IN').endsWith('.csv')) {
      setFileError('Choose a file with the .csv extension.');
      return;
    }
    if (file.size === 0) {
      setFileError('Choose a non-empty CSV file.');
      return;
    }
    if (file.size > maximumBytes) {
      setFileError('CSV files must be no larger than 2 MB. This file was not read or sent.');
      return;
    }
    fileRef.current = file;
    setSelectedFile(file);
  };

  const runDryRun = async () => {
    try {
      await dryRun.mutateAsync();
    } catch {
      // The mutation error is rendered below; do not log or expose the CSV body.
    }
  };

  return <details className={styles.csvTools}>
    <summary><FileSpreadsheet size={18} aria-hidden="true" />Catalogue CSV tools</summary>
    <div className={styles.csvBody}>
      <section className={styles.csvBlock} aria-labelledby="catalog-csv-export-title">
        <div><h2 id="catalog-csv-export-title">Export the full catalogue</h2>
          <p>The backend returns the complete, unpaged catalogue CSV. It has no export-size cap and is buffered for download; use this only on a trusted device with enough available memory.</p>
        </div>
        <Button variant="secondary" onClick={() => void handleExport()} loading={exporting} disabled={exporting}>
          <Download size={16} aria-hidden="true" />Export complete catalogue CSV
        </Button>
        {exportMessage ? <p className={styles.csvSuccess} role="status">{exportMessage}</p> : null}
          {exportError ? <ErrorMessage error={exportError} {...(!isDenied(exportError) ? { onRetry: () => void handleExport() } : {})} /> : null}
      </section>

      <section className={styles.csvBlock} aria-labelledby="catalog-csv-import-title">
        <div><h2 id="catalog-csv-import-title">Validate an import file</h2>
          <p>The dashboard first sends a UTF-8 CSV in dry-run mode and shows the exact records and price changes. Only that previewed file can then be applied, with a reason; a changed catalogue or a different file is refused.</p>
        </div>
        {canWrite ? <>
          <Input ref={inputRef} label="Choose catalogue CSV" type="file" accept=".csv,text/csv" onChange={(event) => chooseFile(event.currentTarget.files?.[0] ?? null)} disabled={dryRun.isPending} />
          {selectedFile ? <p className={styles.csvFile} aria-live="polite">Selected file: <span>{selectedFile.name}</span> · {selectedFile.size.toLocaleString('en-IN')} bytes</p> : null}
          {fileError ? <p className={styles.csvErrorText} role="alert">{fileError}</p> : null}
          <div className={styles.csvActions}>
            <Button onClick={() => void runDryRun()} disabled={!selectedFile || Boolean(fileError) || dryRun.isPending} loading={dryRun.isPending}>
              <Upload size={16} aria-hidden="true" />Run dry-run, apply nothing
            </Button>
            {dryRun.isError && dryRun.error instanceof ApiError && dryRun.error.status === 403 ? <p className={styles.csvErrorText} role="alert">This operator is not permitted to validate catalogue imports.</p> : null}
          </div>
          {dryRun.isError && !(dryRun.error instanceof ApiError && dryRun.error.status === 403) ? <ErrorMessage error={dryRun.error} /> : null}
          {dryRun.isSuccess ? <ImportReport report={dryRun.data.report} {...(dryRun.data.requestId ? { reference: dryRun.data.requestId } : {})} /> : null}
          {appliedMessage ? <p className={styles.csvSuccess} role="status">{appliedMessage}</p> : null}
          {applicable ? <div className={styles.csvActions}>
            <Button onClick={() => setCommitOpen(true)}>Apply this exact import…</Button>
          </div> : null}
          {commit.isError ? <ErrorMessage error={commit.error} /> : null}
          <Dialog open={commitOpen} onOpenChange={(open) => { if (!commit.isPending) setCommitOpen(open); }} title="Apply this import" footer={<>
            <Button variant="secondary" disabled={commit.isPending} onClick={() => setCommitOpen(false)}>Cancel</Button>
            <Button loading={commit.isPending} disabled={!reasonValid} onClick={() => commit.mutate()}>Apply import</Button>
          </>}>
            <p>This changes live catalogue records and prices exactly as listed in the preview. If the catalogue or the file differs from the preview, the backend refuses it and nothing is written. Your reason is stored in the audit log.</p>
            <Textarea label="Reason for this import" value={commitReason} minLength={3} maxLength={300} onChange={(event) => setCommitReason(event.target.value)} error={commitReason && !reasonValid ? 'Enter 3–300 characters.' : undefined} />
          </Dialog>
        </> : <p className={styles.csvNote}>Dry-run import requires catalog:write. Your role can export if it has catalog:read, but cannot send an import file.</p>}
      </section>
    </div>
  </details>;
}
