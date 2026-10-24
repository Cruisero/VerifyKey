import test from 'node:test';
import assert from 'node:assert/strict';
import { isQueuedJob, canCancelPixelJob } from './jobStatus.js';

const task = { status: 'processing', jobId: 'job1', source: 'pixel_sheerid' };

test('queued SheerID tasks can be cancelled without position or Chinese messages', () => {
    for (const queuePosition of [undefined, -1, 0, 5]) {
        assert.equal(canCancelPixelJob({ ...task, upstreamStatus: 'queued', queuePosition, message: 'Waiting' }), true);
    }
});

test('running and terminal state overrides stale queue data', () => {
    for (const upstreamStatus of ['running', 'success', 'failed', 'cancelled']) {
        assert.equal(canCancelPixelJob({ ...task, upstreamStatus, queuePosition: 5, message: '排队中' }), false);
    }
    assert.equal(canCancelPixelJob({ ...task, status: 'failed', upstreamStatus: 'queued' }), false);
});

test('unknown state is not guessed from translated messages', () => {
    assert.equal(isQueuedJob({ ...task, queuePosition: -1, message: '排队中' }), false);
    assert.equal(isQueuedJob({ ...task, queuePosition: 0 }), true);
});

test('other providers cannot use the Pixel cancellation endpoint', () => {
    for (const source of ['kpixel', 'vpixel', 'ypixel', 'gpt']) {
        assert.equal(canCancelPixelJob({ ...task, upstreamStatus: 'queued', source }), false);
    }
    assert.equal(canCancelPixelJob({ ...task, upstreamStatus: 'queued', jobId: '' }), false);
});
