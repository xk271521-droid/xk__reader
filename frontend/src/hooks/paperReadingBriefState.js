export function isPaperReadingBriefInProgress(status) {
  return status === 'queued' || status === 'running'
}
