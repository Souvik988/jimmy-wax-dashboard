'use client';

import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

import { Button, Checkbox, Select, cn } from './core';
import { browserStorage } from '@/lib/api/browser-storage';
import { readSavedView, writeSavedView, type SavedTableView } from '@/lib/api/saved-views';

export type TableDensity = SavedTableView['density'];
export type TableSort = { field: string; direction: 'asc' | 'desc' };
export type DataColumn<Row> = {
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  className?: string;
  /** Only set when the owning endpoint has a documented server-side sort field. */
  sortField?: string;
};

type DataTableProps<Row extends { id: string }> = {
  columns: DataColumn<Row>[];
  rows: Row[];
  density?: TableDensity;
  selectable?: boolean;
  caption: string;
  rowLabel?: (row: Row) => string;
  onSelectionChange?: (ids: string[]) => void;
  renderBulkActions?: (rows: Row[]) => ReactNode;
  operatorId?: string;
  resource?: string;
  filters?: Record<string, string | boolean>;
  onFiltersChange?: (filters: Record<string, string | boolean>) => void;
  selectionScopeKey?: string;
  sort?: TableSort | null;
  onSortChange?: (sort: TableSort) => void;
};

export function DataTable<Row extends { id: string }>({
  columns,
  rows,
  density = 'regular',
  selectable = false,
  caption,
  rowLabel,
  onSelectionChange,
  renderBulkActions,
  operatorId,
  resource,
  filters = {},
  onFiltersChange,
  selectionScopeKey,
  sort,
  onSortChange,
}: DataTableProps<Row>): ReactNode {
  const [selection, setSelection] = useState<{ scope: string | undefined; ids: string[] }>({ scope: selectionScopeKey, ids: [] });
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(columns.map((column) => column.id));
  const [currentDensity, setCurrentDensity] = useState<TableDensity>(density);
  const [viewMessage, setViewMessage] = useState('');
  const hasPreferences = Boolean(operatorId && resource);
  const visibleRows = useMemo(() => rows, [rows]);
  const visibleColumns = useMemo(
    () => columns.filter((column) => visibleColumnIds.includes(column.id)),
    [columns, visibleColumnIds],
  );
  const rowIds = new Set(rows.map((row) => row.id));
  const selected = selection.scope === selectionScopeKey ? selection.ids.filter((id) => rowIds.has(id)) : [];
  const selectedSet = new Set(selected);
  const allSelected = rows.length > 0 && rows.every((row) => selectedSet.has(row.id));
  const selectedRows = rows.filter((row) => selectedSet.has(row.id));

  const updateSelection = (next: string[]) => {
    setSelection({ scope: selectionScopeKey, ids: next });
    onSelectionChange?.(next);
  };

  const saveView = () => {
    if (!operatorId || !resource) return;
    const storage = browserStorage();
    const saved = storage ? writeSavedView(storage, resource, operatorId, {
      version: 1,
      columns: visibleColumnIds,
      density: currentDensity,
      filters,
    }) : false;
    setViewMessage(saved ? 'View saved on this device for your operator account.' : 'This view could not be saved on this device.');
  };

  const loadView = () => {
    if (!operatorId || !resource) return;
    const storage = browserStorage();
    const saved = storage ? readSavedView(storage, resource, operatorId) : null;
    if (!saved) {
      setViewMessage('There is no saved view for this operator on this device.');
      return;
    }
    const validIds = new Set(columns.map((column) => column.id));
    const savedColumns = saved.columns.filter((id) => validIds.has(id));
    setVisibleColumnIds(savedColumns.length > 0 ? savedColumns : columns.map((column) => column.id));
    setCurrentDensity(saved.density);
    onFiltersChange?.(saved.filters);
    setViewMessage('Saved view loaded. Filters are applied through this page’s URL state.');
  };

  const toggleColumn = (id: string, checked: boolean) => {
    setVisibleColumnIds((current) => {
      if (checked) return current.includes(id) ? current : [...current, id];
      if (current.length <= 1) return current;
      return current.filter((columnId) => columnId !== id);
    });
  };

  const changeSort = (field: string) => {
    if (!onSortChange) return;
    const direction = sort?.field === field && sort.direction === 'asc' ? 'desc' : 'asc';
    onSortChange({ field, direction });
  };

  return <>
    {hasPreferences ? <div className="ui-table-toolbar" aria-label={`${caption} view controls`}>
      <details className="ui-table-columns">
        <summary>Columns</summary>
        <div className="ui-table-columns__menu" role="group" aria-label="Visible columns">
          {columns.map((column) => <Checkbox
            key={column.id}
            label={`Show ${column.header} column`}
            checked={visibleColumnIds.includes(column.id)}
            disabled={visibleColumnIds.includes(column.id) && visibleColumnIds.length === 1}
            onChange={(checked) => toggleColumn(column.id, checked)}
          />)}
        </div>
      </details>
      <Select label="Row density" value={currentDensity} onChange={(event) => setCurrentDensity(event.target.value as TableDensity)}>
        <option value="compact">Compact</option>
        <option value="regular">Regular</option>
        <option value="comfortable">Comfortable</option>
      </Select>
      <Button variant="quiet" onClick={saveView}>Save view</Button>
      <Button variant="secondary" onClick={loadView}>Load saved view</Button>
      <span className="sr-only" role="status" aria-live="polite">{viewMessage}</span>
    </div> : null}
    <div className="ui-table-wrap" role="region" aria-label={`${caption} table`} tabIndex={0}>
      <table className={cn('ui-table', `ui-table--${currentDensity}`)}>
        <caption>{caption}</caption>
        <thead><tr>
          {selectable ? <th scope="col"><Checkbox label={<span className="sr-only">Select all visible rows</span>} checked={allSelected} onChange={(checked) => updateSelection(checked ? rows.map((row) => row.id) : [])} /></th> : null}
          {visibleColumns.map((column) => {
            const activeSort = sort?.field === column.sortField;
            const ariaSort = activeSort && sort ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none';
            return <th key={column.id} scope="col" className={column.className} aria-sort={column.sortField && onSortChange ? ariaSort : undefined}>
              {column.sortField && onSortChange ? <button type="button" onClick={() => changeSort(column.sortField!)}>
                {column.header}
                {activeSort ? sort?.direction === 'asc' ? <ArrowUp size={14} aria-label="ascending" /> : <ArrowDown size={14} aria-label="descending" /> : <ArrowUpDown size={14} aria-hidden="true" />}
              </button> : column.header}
            </th>;
          })}
        </tr></thead>
        <tbody>{visibleRows.map((row, index) => <tr key={row.id}>
          {selectable ? <td><Checkbox label={<span className="sr-only">Select {rowLabel?.(row) ?? `row ${index + 1}`}</span>} checked={selectedSet.has(row.id)} onChange={(checked) => updateSelection(checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))} /></td> : null}
          {visibleColumns.map((column) => <td key={column.id} className={column.className}>{column.cell(row)}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
    {selectable && selected.length ? <div className="ui-table-bulkbar" role="region" aria-label="Selected row actions">
      <p role="status">{selected.length} {selected.length === 1 ? 'row' : 'rows'} selected</p>
      {renderBulkActions?.(selectedRows)}
      <Button variant="quiet" onClick={() => updateSelection([])}>Clear selection</Button>
    </div> : null}
  </>;
}
