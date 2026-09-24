import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPaperAnswerRequest } from './paperChatRequest.js'

test('manual question sends only the current question and paper identity', () => {
  const payload = buildPaperAnswerRequest({
    paperId: 12,
    question: '  这篇论文的主要结论是什么？  ',
    selectedText: 'a stale selection',
    providerId: 3,
  })

  assert.deepEqual(payload, {
    paper_id: 12,
    question: '这篇论文的主要结论是什么？',
    selected_text: '',
    request_kind: 'question',
    provider_id: 3,
  })
  assert.equal('messages' in payload, false)
  assert.equal('summary' in payload, false)
})

test('AI deep read sends the current selection as a single-turn task', () => {
  const payload = buildPaperAnswerRequest({
    paperId: 12,
    question: 'spatial transcriptomics',
    requestKind: 'deep_read',
    selectedText: ' spatial transcriptomics ',
  })

  assert.equal(payload.request_kind, 'deep_read')
  assert.equal(payload.selected_text, 'spatial transcriptomics')
  assert.equal(payload.question, 'spatial transcriptomics')
  assert.equal('messages' in payload, false)
})
