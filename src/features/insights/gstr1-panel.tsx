'use client';

import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { Loadable, kit, useNotice } from '@/components/kit/kit';
import { Button, Input } from '@/components/ui/core';
import { downloadBlob } from '@/lib/api/client';
import { type Gstr1Report, downloadGstr1Csv, getGstr1 } from '@/lib/api/resources/admin-ops';
import { formatMoney } from '@/lib/format/money';

/** Current month in India Standard Time as YYYY-MM. */
export function currentIstMonth(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 7);
}
const rate = (bps: number): string => `${(bps / 100).toFixed(2).replace(/\.00$/u, '')}%`;
const money = (paise: number): string => formatMoney(paise, { showPaise: true });

function B2csTable({ report }: { report: Gstr1Report }): ReactNode {
  if (report.b2cs.length === 0) return <p className={kit.notice}>No taxable sales in this month.</p>;
  return <div className="ui-table-wrap" role="region" aria-label="Table 7, B2C small supplies" tabIndex={0}>
    <table className="ui-table ui-table--regular"><caption>Table 7 · B2C (small) by place of supply and rate</caption>
      <thead><tr>{['Place of supply', 'Rate', 'Orders', 'Taxable value', 'IGST', 'CGST', 'SGST/UTGST'].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{report.b2cs.map((row) => <tr key={`${row.placeOfSupply}-${row.rateBps}`}><td>{row.placeOfSupply}</td><td>{rate(row.rateBps)}</td><td>{row.orders}</td><td>{money(row.taxablePaise)}</td><td>{money(row.igstPaise)}</td><td>{money(row.cgstPaise)}</td><td>{money(row.sgstPaise)}</td></tr>)}</tbody>
      <tfoot><tr><th scope="row" colSpan={3}>Total</th><td>{money(report.totals.taxablePaise)}</td><td>{money(report.totals.igstPaise)}</td><td>{money(report.totals.cgstPaise)}</td><td>{money(report.totals.sgstPaise)}</td></tr></tfoot>
    </table></div>;
}

function HsnTable({ report }: { report: Gstr1Report }): ReactNode {
  if (report.hsn.length === 0) return <p className={kit.notice}>No goods lines in this month.</p>;
  return <div className="ui-table-wrap" role="region" aria-label="Table 12, HSN summary" tabIndex={0}>
    <table className="ui-table ui-table--regular"><caption>Table 12 · HSN-wise summary of outward supplies</caption>
      <thead><tr>{['HSN', 'Description', 'Qty', 'Total value', 'Taxable value', 'IGST', 'CGST', 'SGST/UTGST', 'Rate'].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{report.hsn.map((row) => <tr key={`${row.hsn}-${row.rateBps}`}><td>{row.hsn}</td><td>{row.description}</td><td>{row.quantity}</td><td>{money(row.totalValuePaise)}</td><td>{money(row.taxablePaise)}</td><td>{money(row.igstPaise)}</td><td>{money(row.cgstPaise)}</td><td>{money(row.sgstPaise)}</td><td>{rate(row.rateBps)}</td></tr>)}</tbody>
    </table></div>;
}

export function Gstr1Panel(): ReactNode {
  const [month, setMonth] = useState(() => currentIstMonth());
  const [busy, setBusy] = useState<'b2cs' | 'hsn' | null>(null);
  const notice = useNotice();
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/u.test(month);
  const query = useQuery({ queryKey: ['analytics', 'gstr1', month], queryFn: ({ signal }) => getGstr1(month, signal), enabled: valid });

  async function download(table: 'b2cs' | 'hsn'): Promise<void> {
    setBusy(table);
    try { const file = await downloadGstr1Csv(month, table); downloadBlob(file); notice.success(`Downloaded ${file.filename}.`); } catch (error) { notice.failure(error); } finally { setBusy(null); }
  }

  return <section className={kit.stack} aria-label="GSTR-1 working paper">
    <h2>GSTR-1 working paper</h2>
    <p className={kit.muted}>Tables 7 (B2C small) and 12 (HSN) for one month, prepared from stored order tax. Hand the CSVs to your accountant; this is not a filing.</p>
    <div className={kit.actions}>
      <Input label="Month" type="month" value={month} max={currentIstMonth()} onChange={(event) => setMonth(event.target.value)} />
    </div>
    {notice.element}
    {valid ? <Loadable query={query} noun="GSTR-1 working paper">{query.data ? <div className={kit.stack}>
      <ul className={kit.stack} aria-label="Read before using this report">{query.data.warnings.map((warning) => <li key={warning} className={kit.notice}>{warning}</li>)}</ul>
      <p>{query.data.orders} order{query.data.orders === 1 ? '' : 's'} in {query.data.month}{query.data.merchantStateCode ? ` · home state code ${query.data.merchantStateCode}` : ''}.</p>
      <B2csTable report={query.data} />
      <HsnTable report={query.data} />
      <div className={kit.actions}>
        <Button variant="secondary" loading={busy === 'b2cs'} disabled={busy !== null} onClick={() => void download('b2cs')}><Download size={16} aria-hidden="true" />Download table 7 CSV</Button>
        <Button variant="secondary" loading={busy === 'hsn'} disabled={busy !== null} onClick={() => void download('hsn')}><Download size={16} aria-hidden="true" />Download table 12 CSV</Button>
      </div>
    </div> : null}</Loadable> : <p className={kit.notice} role="alert">Choose a month.</p>}
  </section>;
}
