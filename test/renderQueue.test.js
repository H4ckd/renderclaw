const assert = require("node:assert/strict");
const test = require("node:test");

const { QueueFullError, createRenderQueue } = require("../src/rendering/renderQueue");

test("rejects jobs when the pending queue is full", async () => {
  const queue = createRenderQueue(1, 1);
  let releaseFirst;
  const first = queue.enqueue(() => new Promise((resolve) => {
    releaseFirst = resolve;
  }));

  const second = queue.enqueue(() => Promise.resolve("second"));

  await assert.rejects(
    () => queue.enqueue(() => Promise.resolve("third")),
    QueueFullError
  );

  releaseFirst("first");
  assert.equal(await first, "first");
  assert.equal(await second, "second");
});
