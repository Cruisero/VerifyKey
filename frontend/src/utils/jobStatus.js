// The upstream state is authoritative even when queue position is missing or stale.
export function isQueuedJob(result) {
    if (result.status !== 'processing') return false;
    if (result.upstreamStatus) return result.upstreamStatus === 'queued';
    return result.queuePosition >= 0;
}

export function canCancelPixelJob(result) {
    const source = result.source || 'pixel';
    return Boolean(result.jobId) && (source === 'pixel' || source.startsWith('pixel_')) && isQueuedJob(result);
}
