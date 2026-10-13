// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DataTable, type DataColumn } from '@/components/ui/data-table';

type Row = { id: string; orderNumber: string; status: string };
const columns: DataColumn<Row>[] = [
  { id: 'order', header: 'Order', cell: (row) => row.orderNumber },
  { id: 'status', header: 'Status', cell: (row) => row.status },
];

afterEach(() => { cleanup(); window.localStorage.clear(); });

describe('DataTable', () => {
  it('provides distinct keyboard-operable selection names and reports selection', () => {
    const onSelectionChange = vi.fn();
    render(<DataTable columns={columns} rows={[{ id: '1', orderNumber: 'JW-1', status: 'placed' }, { id: '2', orderNumber: 'JW-2', status: 'paid' }]} selectable rowLabel={(row) => row.orderNumber} onSelectionChange={onSelectionChange} caption="Orders" />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select JW-2' }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(['2']);
    expect(screen.getByRole('region', { name: 'Orders table' })).toBeTruthy();
  });

  it('does not expose a fake sort button when a column has no server sort contract', () => {
    render(<DataTable columns={columns} rows={[{ id: '1', orderNumber: 'JW-1', status: 'placed' }]} caption="Orders" />);
    expect(screen.getByRole('columnheader', { name: 'Order' }).querySelector('button')).toBeNull();
  });

  it('saves non-sensitive per-operator view preferences and applies them explicitly', () => {
    const onFiltersChange = vi.fn();
    render(<DataTable
      columns={columns}
      rows={[{ id: '1', orderNumber: 'JW-1', status: 'placed' }]}
      caption="Orders"
      operatorId="operator-1"
      resource="orders"
      filters={{ status: 'placed', q: 'JW-CUSTOMER-ORDER' }}
      onFiltersChange={onFiltersChange}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
    const stored = window.localStorage.getItem('jw:data-table:v1:orders:operator-1');
    expect(stored).toContain('placed');
    expect(stored).not.toContain('JW-CUSTOMER-ORDER');

    fireEvent.click(screen.getByText('Columns'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Status column' }));
    fireEvent.change(screen.getByLabelText('Row density'), { target: { value: 'compact' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
    expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Load saved view' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ status: 'placed' });
    expect(screen.getByRole('table').className).toContain('ui-table--compact');
  });

  it('sorts only when the owner supplies a documented server sort field', () => {
    const onSortChange = vi.fn();
    const sortableColumns: DataColumn<Row>[] = [
      { id: 'order', header: 'Order', cell: (row) => row.orderNumber, sortField: 'createdAt' },
      columns[1]!,
    ];
    render(<DataTable columns={sortableColumns} rows={[{ id: '1', orderNumber: 'JW-1', status: 'placed' }]} caption="Orders" onSortChange={onSortChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Order' }));
    expect(onSortChange).toHaveBeenCalledWith({ field: 'createdAt', direction: 'asc' });
    expect(screen.getByRole('columnheader', { name: 'Order' }).getAttribute('aria-sort')).toBe('none');
  });

  it('shows a sticky selection action region and clears selection accessibly', () => {
    render(<DataTable columns={columns} rows={[{ id: '1', orderNumber: 'JW-1', status: 'placed' }]} caption="Orders" selectable rowLabel={(row) => row.orderNumber} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select JW-1' }));
    expect(screen.getByRole('region', { name: 'Selected row actions' }).className).toContain('ui-table-bulkbar');
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('region', { name: 'Selected row actions' })).toBeNull();
  });
});
