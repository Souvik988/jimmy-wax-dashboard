'use client';

import { useState } from 'react';
import { Bell, Plus } from 'lucide-react';

import { AppShell } from '@/components/layout/app-shell';
import { DataTable, type DataColumn } from '@/components/ui/data-table';
import {
  Card,
  EmptyState,
  ErrorState,
  FilterBar,
  JsonViewer,
  NotAllowedState,
  OfflineState,
  Pagination,
  Skeleton,
  StatCard,
  ToastRegion,
} from '@/components/ui/feedback';
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  Combobox,
  CopyableId,
  DateInput,
  DateRangeInput,
  IconButton,
  Input,
  MoneyInput,
  MultiSelect,
  RadioGroup,
  Select,
  StatusPill,
  Switch,
  Tabs,
  Textarea,
} from '@/components/ui/core';
import {
  ConfirmDialog,
  Dialog,
  Drawer,
  Popover,
  ReasonDialog,
  StepUpDialog,
  Tooltip,
} from '@/components/ui/overlays';
import { authFetch, readError } from '@/lib/auth/client';

type Fixture = { id: string; name: string; status: string; total: string };
const fixtures: Fixture[] = [
  {
    id: 'ORD-2026-0001',
    name: 'Leather Care Complete Set — Walnut',
    status: 'Awaiting fulfilment',
    total: '₹2,450',
  },
  { id: 'ORD-2026-0002', name: 'Suede & Nubuck Care Kit', status: 'Packed', total: '₹1,599' },
];
const columns: DataColumn<Fixture>[] = [
  { id: 'id', header: 'Order', cell: (row) => <CopyableId value={row.id} /> },
  { id: 'name', header: 'Product', cell: (row) => row.name },
  {
    id: 'status',
    header: 'Status',
    cell: (row) => <StatusPill tone="warning">{row.status}</StatusPill>,
  },
  { id: 'total', header: 'Total', cell: (row) => row.total, className: 'numeric' },
];

export default function ComponentLab(): React.ReactNode {
  const [checked, setChecked] = useState(true);
  const [switchOn, setSwitchOn] = useState(false);
  const [tab, setTab] = useState('overview');
  const [money, setMoney] = useState<number | null>(245000);
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState(false);
  const [stepUp, setStepUp] = useState(false);
  const [toastVisible, setToastVisible] = useState(true);
  const [mfaProbeResult, setMfaProbeResult] = useState<string | null>(null);
  const runMfaProbe = async () => {
    setMfaProbeResult('Checking the live MFA gate…');
    try {
      const response = await authFetch('/api/backend/admin/app-versions/not-a-platform', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (response.ok) {
        setMfaProbeResult('Unexpectedly accepted. No change should have occurred.');
        return;
      }
      const error = await readError(response);
      setMfaProbeResult(
        `${response.status}: ${error.code}. The invalid platform is rejected before any setting can change.`,
      );
    } catch {
      setMfaProbeResult('The live backend could not be reached. No setting was changed.');
    }
  };
  if (process.env.NODE_ENV === 'production')
    return (
      <main>
        <NotAllowedState title="This internal component lab is unavailable in production." />
      </main>
    );
  return (
    <AppShell breadcrumbs={['Development', 'Components']}>
      <div className="component-lab">
        <header>
          <p className="eyebrow">DEVELOPMENT ONLY</p>
          <h1>Component inventory</h1>
          <p>
            Fixtures below are isolated visual-test data only. No operational data is fabricated in
            application workflows.
          </p>
        </header>
        <section>
          <h2>Actions and identity</h2>
          <div className="component-grid">
            <Card title="Buttons">
              <div className="demo-row">
                <Button>
                  <Plus size={16} /> Primary
                </Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="quiet">Quiet</Button>
                <Button variant="danger">Danger</Button>
                <Button loading>Saving</Button>
                <IconButton label="Notifications">
                  <Bell size={18} />
                </IconButton>
              </div>
            </Card>
            <Card title="Status">
              <div className="demo-row">
                <Badge>LOCAL</Badge>
                <StatusPill tone="positive">Connected</StatusPill>
                <StatusPill tone="warning">Needs review</StatusPill>
                <StatusPill tone="negative">Unavailable</StatusPill>
                <Avatar name="Jimmy Wax" />
                <CopyableId value="ORD-2026-0001" />
              </div>
            </Card>
          </div>
        </section>
        <section>
          <h2>Fields and choices</h2>
          <div className="component-grid component-grid--three">
            <Input
              label="Product title"
              defaultValue="Leather Balm"
              description="Plain, customer-ready product name."
            />
            <Input
              label="Invalid field"
              defaultValue=""
              error="A product title is required."
              required
            />
            <Textarea label="Internal note" placeholder="Visible only to operators" />
            <Select label="Order status" defaultValue="new">
              <option value="new">New</option>
              <option value="packed">Packed</option>
            </Select>
            <Combobox
              label="Find a product"
              options={['Leather Balm']}
              value=""
              onChange={() => undefined}
            />
            <MultiSelect
              label="Channels"
              options={['App', 'Website']}
              values={['Website']}
              onChange={() => undefined}
            />
            <Checkbox label="Send packing update" checked={checked} onChange={setChecked} />
            <Switch label="Include COD fee" checked={switchOn} onChange={setSwitchOn} />
            <RadioGroup
              label="Refund method"
              value="original"
              onChange={() => undefined}
              options={[
                { value: 'original', label: 'Original payment method' },
                { value: 'manual', label: 'Manual adjustment' },
              ]}
            />
            <MoneyInput label="Final price (GST included)" paise={money} onChange={setMoney} />
            <DateInput label="Dispatch date (IST)" value="2026-10-06" onChange={() => undefined} />
            <DateRangeInput
              label="Reporting range (IST)"
              start="2026-10-01"
              end="2026-10-06"
              onChange={() => undefined}
            />
          </div>
        </section>
        <section>
          <h2>Navigation, feedback and display</h2>
          <div className="component-grid">
            <Card title="Tabs">
              <Tabs
                value={tab}
                onChange={setTab}
                tabs={[
                  { id: 'overview', label: 'Overview' },
                  { id: 'activity', label: 'Activity' },
                ]}
              />
              <p>Selected: {tab}</p>
            </Card>
            <Card title="Popover and tooltip">
              <div className="demo-row">
                <Popover
                  label="Shipping note"
                  content="Provider tools appear only when a provider is configured."
                >
                  Show shipping note
                </Popover>
                <Tooltip label="Tooltips supplement, never replace, visible labels.">
                  <IconButton label="More information">i</IconButton>
                </Tooltip>
              </div>
            </Card>
            <Card title="Skeleton">
              <Skeleton lines={3} />
            </Card>
            <StatCard
              label="Verified policy value"
              value="₹2,000"
              detail="Free shipping threshold"
              tone="positive"
            />
          </div>
          <FilterBar>
            <Badge>Open orders</Badge>
            <Button size="sm" variant="secondary">
              Clear filters
            </Button>
          </FilterBar>
          <DataTable
            caption="Component-lab fixture table"
            columns={columns}
            rows={fixtures}
            selectable
            density="regular"
          />
          <Pagination
            nextCursor={null}
            hasPrevious
            onPrevious={() => undefined}
            onNext={() => undefined}
          />
        </section>
        <section>
          <h2>Reusable states</h2>
          <div className="component-grid component-grid--two">
            <EmptyState title="No matching orders">
              Try changing or clearing the filters.
            </EmptyState>
            <ErrorState title="Could not load orders" requestId="req_example">
              The server did not return a safe response.
            </ErrorState>
            <OfflineState title="You are offline">
              Reconnect before attempting a change.
            </OfflineState>
            <NotAllowedState />
          </div>
        </section>
        <section>
          <h2>Dialogs and safe inspection</h2>
          <div className="demo-row">
            <Button onClick={() => setDialog(true)}>Open dialog</Button>
            <Button variant="secondary" onClick={() => setDrawer(true)}>
              Open drawer
            </Button>
            <Button variant="danger" onClick={() => setConfirm(true)}>
              Confirm dialog
            </Button>
            <Button variant="secondary" onClick={() => setReason(true)}>
              Reason dialog
            </Button>
            <Button variant="secondary" onClick={() => setStepUp(true)}>
              Step-up placeholder
            </Button>
          </div>
          <JsonViewer
            value={{ status: 'sample-only', secret: 'redacted at presentation' }}
            redactedKeys={['secret']}
          />
        </section>
        <section>
          <h2>Backend security controls · development only</h2>
          <Card title="Step-up boundary probe">
            <p>
              Calls the documented app-version write with an invalid platform. The backend rejects
              it before any setting can change; an MFA response exercises the real verification
              boundary.
            </p>
            <Button variant="secondary" onClick={() => void runMfaProbe()}>
              Request real MFA-gated validation
            </Button>
            {mfaProbeResult ? <p role="status">{mfaProbeResult}</p> : null}
          </Card>
        </section>
      </div>
      <Dialog
        open={dialog}
        onOpenChange={setDialog}
        title="A labelled dialog"
        footer={<Button onClick={() => setDialog(false)}>Done</Button>}
      >
        <p>Focus remains in this native modal and returns to its trigger after close.</p>
      </Dialog>
      <Drawer open={drawer} onOpenChange={setDrawer} title="Responsive drawer">
        <p>Navigation uses the same modal pattern below 1024px.</p>
      </Drawer>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        phrase="REMOVE"
        onConfirm={() => setConfirm(false)}
      >
        This example demonstrates typed confirmation; it sends no request.
      </ConfirmDialog>
      <ReasonDialog open={reason} onOpenChange={setReason} onConfirm={() => setReason(false)}>
        Sensitive backend mutations need a 3–300 character reason.
      </ReasonDialog>
      <StepUpDialog open={stepUp} onOpenChange={setStepUp} />
      {toastVisible ? (
        <ToastRegion
          toasts={[
            {
              id: 'lab',
              title: 'Component lab ready',
              detail: 'This is a development-only toast.',
              tone: 'success',
              action: { label: 'Undo', onClick: () => setToastVisible(false) },
            },
          ]}
          onDismiss={() => setToastVisible(false)}
        />
      ) : null}
    </AppShell>
  );
}
