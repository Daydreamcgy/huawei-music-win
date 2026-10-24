export function createSessionEpoch() {
  let value = 0;
  let transitioning = false;
  return {
    capture: () => value,
    advance: () => ++value,
    beginTransition: () => {
      transitioning = true;
      return ++value;
    },
    endTransition: () => {
      const next = ++value;
      transitioning = false;
      return next;
    },
    isTransitioning: () => transitioning,
    isCurrent: captured => !transitioning && captured === value,
  };
}
