// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ManualShipmentEventForm } from '@/features/shipping/manual-shipment-event-form';

afterEach(cleanup);

describe('manual shipment event form', () => {
  it('offers only safe next events and requires acknowledgement before customer-visible tracking changes', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(<ManualShipmentEventForm currentStatus="in_transit" onSubmit={submit} />);

    const status = screen.getByRole('combobox', { name: 'Tracking status event' });
    expect(screen.getByRole('combobox', { name: 'Tracking status event' })).toHaveDisplayValue('Choose a tracking event');
    expect(screen.getByRole('option', { name: 'Out for delivery' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Failed' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Delivered' })).not.toBeInTheDocument();
    expect(screen.getByText(/may appear in the customer tracking timeline/i)).toBeInTheDocument();

    await user.selectOptions(status, 'out_for_delivery');
    await user.type(screen.getByRole('textbox', { name: 'Event note · optional' }), 'Parcel scanned at local hub');
    const submitButton = screen.getByRole('button', { name: 'Record tracking event' });
    expect(submitButton).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('checkbox', { name: /I confirm this tracking update is accurate/i }));
    expect(submitButton).toBeEnabled();
    await user.click(submitButton);

    expect(submit).toHaveBeenCalledWith({ status: 'out_for_delivery', description: 'Parcel scanned at local hub' });
  });

  it('does not allow a new event after the manual shipment is closed', () => {
    render(<ManualShipmentEventForm currentStatus="delivered" onSubmit={vi.fn()} />);

    expect(screen.getByText(/shipment is closed; no further manual events can be recorded/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Tracking status event' })).not.toBeInTheDocument();
  });

  it('does not describe an unrecognized backend status as a terminal state', () => {
    render(<ManualShipmentEventForm currentStatus="picked_up" onSubmit={vi.fn()} />);

    expect(screen.getByText(/no safe next manual event is available from this backend status/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Tracking status event' })).not.toBeInTheDocument();
  });

  it('clears the selected event and acknowledgement when the authoritative shipment status advances', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    const view = render(<ManualShipmentEventForm currentStatus="in_transit" onSubmit={submit} />);
    const status = screen.getByRole('combobox', { name: 'Tracking status event' });

    await user.selectOptions(status, 'out_for_delivery');
    await user.click(screen.getByRole('checkbox', { name: /I confirm this tracking update is accurate/i }));
    view.rerender(<ManualShipmentEventForm currentStatus="out_for_delivery" onSubmit={submit} />);

    expect(screen.getByRole('combobox', { name: 'Tracking status event' })).toHaveDisplayValue('Choose a tracking event');
    expect(screen.getByRole('button', { name: 'Record tracking event' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Delivered' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Out for delivery' })).not.toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });
});
