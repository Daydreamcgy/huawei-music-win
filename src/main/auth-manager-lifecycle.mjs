export function createAuthManagerLifecycle(createManager) {
  let managerPromise;
  return {
    get() {
      if (!managerPromise) {
        managerPromise = Promise.resolve().then(createManager).catch(error => {
          managerPromise = undefined;
          throw error;
        });
      }
      return managerPromise;
    },
  };
}
