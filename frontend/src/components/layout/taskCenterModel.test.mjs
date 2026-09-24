import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildTaskFailureCopyText,
  canClearFinishedTasks,
  filterTaskItems,
  getTaskFilterCounts,
  isTaskArchivable,
  normalizeTaskSummary,
} from './taskCenterModel.js'

test('normalizes summary counts defensively', () => {
  assert.deepEqual(normalizeTaskSummary({ active_count: '2', failed_count: null }), {
    active_count: 2,
    failed_count: 0,
    completed_count: 0,
    total_count: 0,
    attention_count: 0,
  })
})

test('filters tasks by status group and reports tab counts', () => {
  const items = [
    { id: 'a', status_group: 'active' },
    { id: 'b', status_group: 'failed' },
  ]
  assert.deepEqual(filterTaskItems(items, 'failed'), [items[1]])
  assert.deepEqual(getTaskFilterCounts(items, { active_count: 1, failed_count: 1, completed_count: 0 }), {
    all: 2,
    active: 1,
    failed: 1,
    completed: 0,
  })
})

test('builds detailed failure copy text', () => {
  const text = buildTaskFailureCopyText({
    title: 'Matrix',
    status_label: '失败',
    stage_label: '生成',
    error_message: 'provider timeout',
  })
  assert.match(text, /Matrix/)
  assert.match(text, /provider timeout/)
})

test('treats failed and completed task records as clearable history', () => {
  assert.equal(isTaskArchivable({ status_group: 'failed' }), true)
  assert.equal(isTaskArchivable({ status_group: 'completed' }), true)
  assert.equal(isTaskArchivable({ status_group: 'active' }), false)
  assert.equal(canClearFinishedTasks({ failed_count: 1, completed_count: 0 }), true)
  assert.equal(canClearFinishedTasks({ failed_count: 0, completed_count: 0 }), false)
})
