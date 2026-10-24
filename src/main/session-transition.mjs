export function sessionSaveOutcome(hasPreviousSession, persisted) {
  if (persisted) return 'replace';
  return hasPreviousSession ? 'preserve' : 'memory-only';
}
