'use client';

import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';

import { Button } from '@/components/ui/core';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { getPackingSlip } from '@/lib/api/resources/orders';
import { formatMoney } from '@/lib/format/money';
import { formatIst } from '@/lib/format/time';

import styles from './packing-slip.module.css';

export function PackingSlipView({ id }: { id: string }): React.ReactNode {
  const query = useQuery({ queryKey: ['orders', 'packing-slip', id], queryFn: () => getPackingSlip(id), retry: 1 });
  if (query.isPending) return <Skeleton lines={10} />;
  if (query.isError) return <ErrorState title="Packing slip could not load" actionLabel="Retry" onAction={() => void query.refetch()}>The backend did not provide a printable packing slip.</ErrorState>;
  const slip = query.data;
  return <article className={`${styles.sheet} packing-slip-document`}><header><div><p>JIMMY &amp; WAX · PACKING SLIP</p><h1>{slip.orderNumber}</h1><span>Placed {formatIst(slip.placedAt, { dateStyle: 'medium', timeStyle: 'short' })}</span></div><Button className={styles.print!} onClick={() => window.print()}><Printer size={16} aria-hidden="true" />Print slip</Button></header><section><h2>Ship to</h2><strong>{slip.shipTo.name}</strong><p>{slip.shipTo.address}{slip.shipTo.landmark ? `, ${slip.shipTo.landmark}` : ''}<br />{slip.shipTo.city}, {slip.shipTo.state} · {slip.shipTo.pin}<br />Phone: {slip.shipTo.phone}</p></section><section><h2>Items</h2><table><thead><tr><th>SKU</th><th>Item</th><th>Qty</th></tr></thead><tbody>{slip.items.map((item) => <tr key={item.sku}><td>{item.sku}</td><td>{item.name}</td><td>{item.quantity}</td></tr>)}</tbody></table></section><footer><span>{slip.paymentMethod === 'cod' ? `Collect ${formatMoney(slip.collectOnDeliveryPaise)} on delivery` : 'Prepaid order'}</span><span>{slip.from.brand}</span></footer></article>;
}
