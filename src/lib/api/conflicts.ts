export type ConcurrencyStrategy = 'if-match' | 'expected-version' | 'none';
export type ConflictAction = 'reload' | 'merge';

export function conflictActions(strategy: ConcurrencyStrategy): readonly ConflictAction[] {
  if (strategy === 'none') return ['reload'];
  return ['reload', 'merge'];
}

export function shouldAutoRetryConflict(_strategy: ConcurrencyStrategy): false {
  return false;
}
