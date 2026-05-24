import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildLibraryBulkSummary,
  createBulkOperationPlan,
  getLibraryAdvancedFilterOptions,
  getPaperYear,
  matchesLibraryAdvancedFilters,
} from './libraryWorkflowModel.js'

const papers = [
  {
    id: 'a',
    folderId: 'f1',
    title: 'CNN classification',
    fileName: 'cnn.pdf',
    metadata: { author: 'Kaiming He', creationDate: '2017-02-01' },
  },
  {
    id: 'b',
    folderId: 'f1',
    title: 'Transformer survey',
    fileName: 'transformer.pdf',
    metadata: { author: 'Vaswani', publicationYear: '2021' },
  },
  {
    id: 'c',
    folderId: 'f2',
    title: 'Graph model',
    fileName: 'graph.pdf',
    metadata: { author: 'Kumar', year: 2020 },
  },
]

test('extracts years and advanced filter options for the selected folder', () => {
  assert.equal(getPaperYear(papers[0]), '2017')
  assert.deepEqual(getLibraryAdvancedFilterOptions(papers, 'f1').years, ['2021', '2017'])
  assert.deepEqual(getLibraryAdvancedFilterOptions(papers, 'f1').authors, ['Kaiming He', 'Vaswani'])
})

test('matches author, year and keyword filters together', () => {
  assert.equal(matchesLibraryAdvancedFilters(papers[0], { author: 'he', year: '2017', keyword: 'cnn' }), true)
  assert.equal(matchesLibraryAdvancedFilters(papers[0], { author: 'he', year: '2021', keyword: 'cnn' }), false)
  assert.equal(matchesLibraryAdvancedFilters(papers[1], { keyword: 'survey' }), true)
})

test('builds bulk operation summaries and validates move target', () => {
  assert.deepEqual(buildLibraryBulkSummary(['a', 'c'], papers), {
    count: 2,
    folderCount: 2,
    hasSelection: true,
    paperIds: ['a', 'c'],
  })
  assert.equal(createBulkOperationPlan('move', ['a'], '').canRun, false)
  assert.equal(createBulkOperationPlan('move', ['a'], 'f2').canRun, true)
  assert.equal(createBulkOperationPlan('refresh-metadata', ['a']).canRun, true)
})
