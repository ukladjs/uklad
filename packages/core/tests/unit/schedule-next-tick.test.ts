/**
 * The browser tick path for `scheduleNextTick`.
 *
 * Browsers have no `setImmediate`, so the event queue advances through a
 * `MessageChannel`. One channel is shared across calls, so ordering depends on
 * the pending-callback FIFO rather than on each call owning its own ports —
 * worth pinning, because Node takes the `setImmediate` branch and would never
 * reach this code.
 *
 * The scheduler is built with an injected channel factory rather than by
 * deleting `globalThis.setImmediate`: the test runner depends on that global,
 * and removing it hangs the suite.
 */
import { createMessageChannelScheduler } from '../../src/core/scheduling';

const openChannels: MessageChannel[] = [];

function createScheduler() {
  let channelsCreated = 0;
  const schedule = createMessageChannelScheduler(() => {
    channelsCreated++;
    const channel = new MessageChannel();
    // An open port keeps Node's loop alive; a browser page owns that lifetime,
    // this suite has to close what it opens.
    openChannels.push(channel);
    return channel;
  });
  return { schedule, channelCount: () => channelsCreated };
}

afterEach(() => {
  for (const channel of openChannels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

describe('scheduleNextTick browser path', () => {
  it('runs callbacks in the order they were scheduled', async () => {
    const { schedule } = createScheduler();
    const order: number[] = [];

    await new Promise<void>((resolve) => {
      schedule(() => order.push(1));
      schedule(() => order.push(2));
      schedule(() => order.push(3));
      schedule(() => {
        order.push(4);
        resolve();
      });
    });

    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('reuses one channel across many scheduling rounds', async () => {
    const { schedule, channelCount } = createScheduler();

    for (let round = 0; round < 5; round++) {
      await new Promise<void>((resolve) => schedule(resolve));
    }

    expect(channelCount()).toBe(1);
  });

  it('delivers a callback scheduled from inside a draining callback', async () => {
    const { schedule } = createScheduler();
    const order: string[] = [];

    await new Promise<void>((resolve) => {
      schedule(() => {
        order.push('first');
        schedule(() => {
          order.push('nested');
          resolve();
        });
      });
      schedule(() => order.push('second'));
    });

    expect(order).toEqual(['first', 'second', 'nested']);
  });
});
