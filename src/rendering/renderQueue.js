class QueueFullError extends Error {
  constructor(maxQueueSize) {
    super(`Render queue is full (${maxQueueSize} pending jobs)`);
    this.name = "QueueFullError";
    this.statusCode = 503;
  }
}

// Small in-process render queue.
// This protects memory and CPU by limiting concurrent Puppeteer pages. Replace
// this module, not renderer.js, if RenderClaw later gains Redis-backed or
// distributed workers.
function createRenderQueue(concurrency, maxQueueSize = 0) {
  let activeRenders = 0;
  const pendingRenders = [];

  function enqueue(task) {
    return new Promise((resolve, reject) => {
      if (maxQueueSize > 0 && pendingRenders.length >= maxQueueSize) {
        reject(new QueueFullError(maxQueueSize));
        return;
      }

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

module.exports = { QueueFullError, createRenderQueue };
