import { Mail, PackageCheck, RotateCcw, Truck } from 'lucide-react';

import { Card, EmptyState } from '@/components/ui/feedback';
import type { AdminOrderDetail } from '@/lib/api/resources/orders';
import { formatIst } from '@/lib/format/time';

import styles from './order-timeline.module.css';

function label(value: string): string { return value.replaceAll('_', ' '); }
const when = (value: string): string => formatIst(value, { dateStyle: 'medium', timeStyle: 'short' });

const messageTone: Record<string, string> = { sent: 'ok', pending: 'wait', failed: 'bad', suppressed: 'bad' };
const messageNote: Record<string, string> = {
  pending: 'Queued; sends when the outbox next runs.',
  sent: 'Delivered to the mail provider.',
  failed: 'Could not be sent. Check Operations for the dead letter.',
  suppressed: 'Not sent: the address is on the suppression list (bounce or complaint).',
};

/** Everything that happened to an order, from fields the backend records itself: status changes, shipments, returns and customer emails. */
export function OrderTimeline({ order }: { order: AdminOrderDetail }): React.ReactNode {
  const history = order.statusHistory ?? [];
  const shipments = order.shipments ?? [];
  const returns = order.returns ?? [];
  const messages = order.messages ?? [];
  if (!history.length && !shipments.length && !returns.length && !messages.length) return null;
  return <Card title="Order history" className={styles.root!}>
    <div className={styles.columns}>
      <section aria-labelledby="order-history-status">
        <h3 id="order-history-status"><PackageCheck size={15} aria-hidden="true" />Status changes</h3>
        {history.length ? <ol>{history.map((entry, index) => <li key={`${entry.at}-${index}`}>
          <span><strong>{label(entry.to)}</strong>{entry.from ? <small>from {label(entry.from)}</small> : <small>first recorded status</small>}</span>
          <time dateTime={entry.at}>{when(entry.at)} IST</time>
        </li>)}</ol> : <EmptyState title="No status history">This order predates status tracking, so only its current status is known.</EmptyState>}
      </section>
      <section aria-labelledby="order-history-shipments">
        <h3 id="order-history-shipments"><Truck size={15} aria-hidden="true" />Shipments</h3>
        {shipments.length ? <ul>{shipments.map((shipment) => <li key={shipment.id}>
          <span><strong>{shipment.courier || 'Courier not set'}</strong><small>{shipment.trackingNumber || 'No tracking number'} · {label(shipment.status)}</small>
            {shipment.events?.length ? <small>Latest: {shipment.events[shipment.events.length - 1]?.description}</small> : null}</span>
        </li>)}</ul> : <p className={styles.none}>No shipment has been created.</p>}
        <h3 id="order-history-returns"><RotateCcw size={15} aria-hidden="true" />Returns</h3>
        {returns.length ? <ul>{returns.map((entry) => <li key={entry.id}>
          <span><strong>{label(entry.status)}</strong><small>{entry.reason}</small></span><time dateTime={entry.createdAt}>{when(entry.createdAt)} IST</time>
        </li>)}</ul> : <p className={styles.none}>No return has been requested.</p>}
      </section>
      <section aria-labelledby="order-history-messages">
        <h3 id="order-history-messages"><Mail size={15} aria-hidden="true" />Customer emails</h3>
        {messages.length ? <ul>{messages.map((message, index) => <li key={`${message.template}-${message.createdAt}-${index}`} data-tone={messageTone[message.status]}>
          <span><strong>{label(message.template)}</strong><small>{messageNote[message.status]}</small></span>
          <span className={styles.messageState}>{message.status}</span>
        </li>)}</ul> : <p className={styles.none}>No customer email is recorded for this order.</p>}
      </section>
    </div>
  </Card>;
}
