'use client';

import { useMutation } from '@tanstack/react-query';
import { Printer, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/core';
import { Card } from '@/components/ui/feedback';
import { ReasonDialog } from '@/components/ui/overlays';
import { ApiError } from '@/lib/api/errors';
import { getOrderInvoice, issueOrderInvoice, type InvoiceSnapshot } from '@/lib/api/resources/orders';
import { formatMoney } from '@/lib/format/money';
import { formatIst } from '@/lib/format/time';

import styles from './order-invoice.module.css';

const invoiceEligibleStatuses = ['confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'returned'];

function InvoiceDocument({ invoice }: { invoice: InvoiceSnapshot }): React.ReactNode {
  return <article className={`${styles.document} invoice-print-document`} aria-label={`GST tax invoice ${invoice.invoiceNumber}`}>
    <header className={styles.documentHeader}>
      <div><p className={styles.kicker}>JIMMY &amp; WAX · TAX INVOICE</p><h2>{invoice.invoiceNumber}</h2><p>Issued {formatIst(invoice.issuedAt, { dateStyle: 'medium', timeStyle: 'short' })} · Order {invoice.orderNumber}</p></div>
      <Button className={styles.print!} variant="secondary" onClick={() => window.print()}><Printer size={16} aria-hidden="true" />Print invoice</Button>
    </header>
    <div className={styles.parties}>
      <section><h3>Sold by</h3><strong>{invoice.seller.legalName}</strong><p>{invoice.seller.address}<br />{invoice.seller.state}<br />GSTIN: {invoice.seller.gstin}</p></section>
      <section><h3>Billed to</h3><strong>{invoice.buyer.name}</strong><p>{invoice.buyer.address}<br />{invoice.buyer.state} · {invoice.buyer.pin}<br />Place of supply: {invoice.placeOfSupply}</p></section>
    </div>
    <p className={styles.taxContext}>{invoice.supply.replace('_', ' ')} supply · GST {invoice.gstRatePercent}% · Prices {invoice.priceBasis === 'inclusive' ? 'include GST' : 'exclude GST'} · {invoice.hsnIncluded ? 'HSN codes are shown per line.' : 'HSN codes were not recorded for every line when this invoice was issued.'}</p>
    <div className={styles.tableWrap}><table><thead><tr><th>Item</th><th>Qty</th><th>Taxable</th><th>GST</th><th>Amount</th></tr></thead><tbody>
      {invoice.lines.map((line, index) => <tr key={`${line.sku}-${index}`}><td><strong>{line.description}</strong><small>{line.sku}{line.hsn ? ` · HSN ${line.hsn}` : ''}</small></td><td>{line.quantity}</td><td>{formatMoney(line.taxablePaise)}</td><td>{formatMoney(line.gstPaise)}</td><td>{formatMoney(line.totalPaise)}</td></tr>)}
      {invoice.shipping.totalPaise > 0 ? <tr><td>Delivery charge</td><td>1</td><td>{formatMoney(invoice.shipping.taxablePaise)}</td><td>{formatMoney(invoice.shipping.gstPaise)}</td><td>{formatMoney(invoice.shipping.totalPaise)}</td></tr> : null}
      {invoice.codFee.totalPaise > 0 ? <tr><td>Cash on delivery handling</td><td>1</td><td>{formatMoney(invoice.codFee.taxablePaise)}</td><td>{formatMoney(invoice.codFee.gstPaise)}</td><td>{formatMoney(invoice.codFee.totalPaise)}</td></tr> : null}
    </tbody></table></div>
    <dl className={styles.totals}>
      <div><dt>Total taxable value</dt><dd>{formatMoney(invoice.totals.taxablePaise)}</dd></div>
      {invoice.supply === 'intra_state' ? <><div><dt>CGST ({invoice.gstRatePercent / 2}%)</dt><dd>{formatMoney(invoice.totals.cgstPaise)}</dd></div><div><dt>SGST ({invoice.gstRatePercent / 2}%)</dt><dd>{formatMoney(invoice.totals.sgstPaise)}</dd></div></> : <div><dt>IGST ({invoice.gstRatePercent}%)</dt><dd>{formatMoney(invoice.totals.igstPaise)}</dd></div>}
      <div><dt>Total GST</dt><dd>{formatMoney(invoice.totals.gstPaise)}</dd></div>
      <div className={styles.grandTotal}><dt>Grand total · {invoice.priceBasis === 'inclusive' ? 'GST included' : 'GST added'}</dt><dd>{formatMoney(invoice.totals.grandTotalPaise)}</dd></div>
    </dl>
    <footer>Computer-generated invoice · immutable backend snapshot</footer>
  </article>;
}

export function OrderInvoiceAction({ id, status, canIssue }: { id: string; status: string; canIssue: boolean }): React.ReactNode {
  const [reasonOpen, setReasonOpen] = useState(false);
  const [issued, setIssued] = useState<InvoiceSnapshot | null>(null);
  const view = useMutation({ mutationFn: () => getOrderInvoice(id) });
  const issue = useMutation({ mutationFn: (reason: string) => issueOrderInvoice(id, reason), onSuccess: (invoice) => { setIssued(invoice); setReasonOpen(false); }, onError: () => setReasonOpen(false) });
  if (!invoiceEligibleStatuses.includes(status)) return null;

  const invoice = issued ?? view.data ?? null;
  if (invoice) return <InvoiceDocument invoice={invoice} />;
  const notIssued = view.isSuccess && view.data === null;
  const error = issue.error ?? view.error;
  return <>
    <Card title="GST invoice" className={styles.actionCard!}>
      <p>{notIssued ? 'No invoice has been issued for this order yet.' : 'Viewing never creates anything. An invoice is issued once, with a consecutive number, and cannot be edited afterwards.'}{canIssue ? '' : ' Roles without fulfilment access see the invoice without the buyer’s street address.'}</p>
      {notIssued ? (canIssue
        ? <Button loading={issue.isPending} onClick={() => { issue.reset(); setReasonOpen(true); }}>Issue GST invoice</Button>
        : <p>Only fulfilment operators with verified identity can issue it.</p>)
        : <Button variant="secondary" loading={view.isPending} onClick={() => { issue.reset(); view.mutate(); }}>View GST invoice</Button>}
      {error ? <p className={styles.error} role="alert">{error instanceof ApiError ? error.message : 'The invoice was not available.'}{error instanceof ApiError && error.requestId ? <span>Reference: {error.requestId}</span> : null}</p> : null}
    </Card>
    <ReasonDialog open={reasonOpen} onOpenChange={setReasonOpen} title="Issue this GST invoice" pending={issue.isPending} onConfirm={(reason) => issue.mutate(reason)}>
      <span className={styles.confirmNotice}><ShieldCheck size={18} aria-hidden="true" />This creates the immutable financial record once and uses the next invoice number. If the seller’s GST details are missing, the backend refuses without issuing a number. Your reason is stored in the audit log.</span>
    </ReasonDialog>
  </>;
}
