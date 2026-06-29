export function createLiveFeed() {
  const subscribers = new Set();
  const history = [];
  let nextId = 1;

  function publish(type, payload = {}, severity = 'info') {
    const event = {
      id: nextId++,
      type,
      severity,
      payload,
      createdAt: new Date().toISOString(),
    };

    history.unshift(event);
    if (history.length > 200) history.pop();

    for (const subscriber of subscribers) {
      subscriber(event);
    }

    return event;
  }

  function subscribe(callback) {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  }

  function getHistory(limit = 50) {
    return history.slice(0, limit);
  }

  return { publish, subscribe, getHistory };
}
