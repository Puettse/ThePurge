import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveFeed } from '../src/services/liveFeed.js';

test('live feed publishes to subscribers and stores recent history', () => {
  const feed = createLiveFeed();
  const received = [];
  const unsubscribe = feed.subscribe((event) => received.push(event));

  const event = feed.publish('test.event', { ok: true });
  unsubscribe();
  feed.publish('test.after_unsubscribe');

  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'test.event');
  assert.equal(event.payload.ok, true);
  assert.equal(feed.getHistory(10).length, 2);
});
