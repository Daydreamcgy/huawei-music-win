export function isTrustedRendererUrl(value, expectedValue) {
  try {
    const actual = new URL(value);
    const expected = new URL(expectedValue);
    return actual.protocol === 'file:' && expected.protocol === 'file:'
      && actual.href === expected.href;
  } catch { return false; }
}
