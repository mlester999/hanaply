export const phaseOneAccountStatuses = Object.freeze([
  'active',
  'suspended',
  'disabled',
  'pending_deletion',
] as const);

export type PhaseOneAccountStatus = (typeof phaseOneAccountStatuses)[number];

export interface AccountAccessDecision {
  mayAuthenticate: boolean;
  mayAccessProduct: boolean;
  route: '/dashboard' | '/account-suspended' | '/account-unavailable';
}

export function evaluateAccountAccess(status: PhaseOneAccountStatus): AccountAccessDecision {
  if (status === 'active') {
    return { mayAuthenticate: true, mayAccessProduct: true, route: '/dashboard' };
  }
  if (status === 'suspended') {
    return {
      mayAuthenticate: true,
      mayAccessProduct: false,
      route: '/account-suspended',
    };
  }
  return {
    mayAuthenticate: false,
    mayAccessProduct: false,
    route: '/account-unavailable',
  };
}
