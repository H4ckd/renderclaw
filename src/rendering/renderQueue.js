function createRenderQueue(concurrency) {
  let activeRenders = 0;
  const pendingRenders = [];

  function enqueue(task) {
    return new Promise((resolve, reject) => {
      pendingRenders.push({ task, resolve, reject });
      drain();
    });
  }

  function drain() {
    while (activeRenders < concurrency && pendingRenders.length) {
      const item = pendingRenders.shift();
      activeRenders++;
      item.task()
        .then(item.resolve, item.reject)
        .finally(() => {
          activeRenders--;
          drain();
        });
    }
  }

  function stats() {
    return {
      activeRenders,
      queuedRenders: pendingRenders.length,
    };
  }

  return { enqueue, stats };
}

module.exports = { createRenderQueue };
