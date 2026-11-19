import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OutboxService} from '../src/mail';

test('an email enqueued while a batch is in progress triggers a follow-up pass', async () => {
  const previous = process.env.OUTBOX_WORKER;
  process.env.OUTBOX_WORKER = 'on';
  let calls = 0;
  let release!: () => void;
  let started!: () => void;
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  const firstReleased = new Promise<void>(resolve => { release = resolve; });
  const db = {emailOutbox: {
    findMany: async () => { calls++; if (calls === 1) { started(); await firstReleased; } return []; },
    create: async () => ({id: 'fixture'}),
  }};
  const mail = {mode: () => 'capture'};
  const service = new OutboxService(db as never, mail as never);
  try {
    const first = service.drain();
    await firstStarted;
    await service.enqueue({to: 'fixture@example.invalid', template: 'login_link'});
    release();
    await first;
    for (let i = 0; i < 20 && calls < 2; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(calls, 2, 'newly queued mail must not wait for the periodic worker');
  } finally {
    if (previous === undefined) delete process.env.OUTBOX_WORKER; else process.env.OUTBOX_WORKER = previous;
  }
});
