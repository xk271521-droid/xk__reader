import assert from 'node:assert/strict'
import test from 'node:test'

import {
  RESEARCH_MATRIX_TEMPLATES,
  buildResearchMatrixCreatePayload,
  getResearchMatrixTemplate,
} from './researchMatrixTemplates.js'

test('provides the expected matrix workflow templates', () => {
  assert.deepEqual(
    RESEARCH_MATRIX_TEMPLATES.map((template) => template.id),
    ['review_draft', 'method_compare', 'experiment_results', 'innovation_limits'],
  )
})

test('falls back to the default template', () => {
  assert.equal(getResearchMatrixTemplate('missing').id, 'review_draft')
})

test('builds create payload from the selected template', () => {
  assert.deepEqual(buildResearchMatrixCreatePayload({
    paperIds: [1, 2],
    templateId: 'method_compare',
  }), {
    title: '方法对比 · 2 篇',
    paper_ids: [1, 2],
    include_reproduction: true,
    grouping_mode: 'method_first',
  })
})
