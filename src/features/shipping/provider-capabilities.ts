import type { ShippingProvider } from '@/lib/api/resources/shipping';

/**
 * Single place that decides which provider (courier-aggregator) actions the dashboard offers.
 * Manual courier entry is always available. Provider actions switch on only when the BACKEND reports a configured,
 * reachable provider with a pickup location, so connecting Shiprocket later needs backend configuration only (see PROVIDER_SETUP_STEPS).
 */
export type ProviderMode = 'manual' | 'provider' | 'provider-unreachable';

export type ProviderCapabilities = {
  mode: ProviderMode;
  providerName: string;
  /** Plan, ship, bulk ship, label download. */
  canDispatch: boolean;
  /** Always true: manual entry never depends on a provider. */
  canEnterManually: boolean;
  /** Shown instead of the provider buttons when `canDispatch` is false. */
  blockers: string[];
  /** The provider is a local stand-in, not a real courier account. */
  isSimulated: boolean;
};

export function providerCapabilities(provider: ShippingProvider | null): ProviderCapabilities {
  if (!provider) return { mode: 'manual', providerName: 'manual', canDispatch: false, canEnterManually: true, blockers: ['Provider status has not loaded.'], isSimulated: false };
  const name = provider.provider.toLowerCase();
  if (!provider.configured || name === 'manual') {
    return { mode: 'manual', providerName: 'manual', canDispatch: false, canEnterManually: true, blockers: ['No courier provider is connected on the backend.'], isSimulated: false };
  }
  const blockers: string[] = [];
  if (provider.reachable !== true) blockers.push(`${provider.provider} did not answer the last connection check.`);
  if (!provider.settings.pickupLocation) blockers.push('Choose a pickup location in shipping settings.');
  if (!provider.settings.pickupPin) blockers.push('Set the pickup PIN in shipping settings.');
  return {
    mode: provider.reachable === true ? 'provider' : 'provider-unreachable',
    providerName: provider.provider,
    canDispatch: blockers.length === 0,
    canEnterManually: true,
    blockers,
    isSimulated: name === 'fake',
  };
}

/** Wallet check shown in the plan dialog; null balance means the provider did not report one. */
export function walletShortfallPaise(walletBalancePaise: number | null, courier: { freightPaise: number; codChargesPaise: number } | undefined): number | null {
  if (walletBalancePaise === null || !courier) return null;
  const need = courier.freightPaise + courier.codChargesPaise;
  return walletBalancePaise < need ? need - walletBalancePaise : 0;
}

/** Ordered checklist for whoever connects the real provider. Backend-side only; the dashboard needs no code change. */
export const PROVIDER_SETUP_STEPS: ReadonlyArray<{ title: string; detail: string }> = [
  { title: 'Create a Shiprocket API user', detail: 'A dedicated API user (not your login) with access to orders, couriers, labels and pickups.' },
  { title: 'Set the backend environment', detail: 'When ready, set SHIPPING_PROVIDER=shiprocket and SHIPROCKET_WEBHOOK_TOKEN, with either a dedicated SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD pair or SHIPROCKET_API_TOKEN. API-user credentials support automatic token refresh. Keep secrets in the commerce and worker environments; the dashboard never stores them.' },
  { title: 'Register the tracking webhook', detail: 'Point Shiprocket’s webhook at the backend with the same token so shipment status updates arrive automatically.' },
  { title: 'Restart the commerce API and workers', detail: 'The Shipping centre then shows “Provider reachable” and the dispatch controls appear on ready orders.' },
  { title: 'Set the pickup location and PIN', detail: 'Use the Shipping settings panel. The location must match one registered in Shiprocket.' },
  { title: 'Run one test order', detail: 'Plan and ship a single low-value order, check the label and tracking, then enable bulk shipping.' },
];
