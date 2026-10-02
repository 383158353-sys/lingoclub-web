export function createRequestDeduper() {
  const inFlight = new Map();

  return (key, task) => {
    if (inFlight.has(key)) return inFlight.get(key);

    const request = Promise.resolve().then(task);
    inFlight.set(key, request);
    const clear = () => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    };
    request.then(clear, clear);
    return request;
  };
}
