// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ManualShipmentForm } from '@/features/shipping/manual-shipment-form';

afterEach(cleanup);

describe('manual shipment form', () => {
  it('blocks insecure tracking links before they can change an order', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(<ManualShipmentForm onSubmit={submit} />);

    await user.type(screen.getByRole('textbox', { name: 'Courier' }), 'Blue Dart');
    await user.type(screen.getByRole('textbox', { name: 'Tracking number' }), 'BD12345');
    await user.type(screen.getByRole('textbox', { name: /Tracking URL · optional/ }), 'http://track.example/BD12345');
    await user.click(screen.getByRole('button', { name: 'Record shipment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/HTTPS tracking link/i);
    expect(submit).not.toHaveBeenCalled();
  });

  it('normalizes courier details and explains that order status and customer messaging will change', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(<ManualShipmentForm onSubmit={submit} />);

    await user.type(screen.getByRole('textbox', { name: 'Courier' }), '  Blue Dart  ');
    await user.type(screen.getByRole('textbox', { name: 'Tracking number' }), ' BD12345 ');
    await user.type(screen.getByRole('textbox', { name: /Tracking URL · optional/ }), 'https://track.example/BD12345');
    expect(screen.getByText(/marks this order as shipped/i)).toBeInTheDocument();
    expect(screen.getByText(/tracking message for the customer/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Record shipment' }));

    expect(submit).toHaveBeenCalledWith({ courier: 'Blue Dart', trackingNumber: 'BD12345', trackingUrl: 'https://track.example/BD12345' });
  });
});
