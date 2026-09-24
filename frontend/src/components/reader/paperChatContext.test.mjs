import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildNotebookCitationDigest,
  buildPageMarkedExcerpt,
  buildPaperChatContextPayload,
} from './paperChatContext.js'

test('keeps page markers in current paper excerpts', () => {
  const excerpt = buildPageMarkedExcerpt('[第 1 页]\nIntro text\n[第 2 页]\nMethod text', 80)
  assert.match(excerpt, /\[第 1 页\]/)
  assert.match(excerpt, /\[第 2 页\]/)
})

test('builds note digest with page citations', () => {
  const digest = buildNotebookCitationDigest([
    {
      title: 'Notebook',
      nodes: [
        {
          title: 'Method',
          blocks: [{ type: 'quote', page_number: 5, content: 'important quote' }],
        },
      ],
    },
  ])
  assert.match(digest, /\[第 5 页\]/)
  assert.match(digest, /important quote/)
})

test('builds chat payload that asks for cited answers', () => {
  const payload = buildPaperChatContextPayload({
    paperId: 7,
    fileName: 'paper.pdf',
    fullText: '[第 3 页]\nResult text',
    metadata: { title: 'Paper Title' },
    providerId: 2,
    selectedText: 'selected',
  })
  assert.equal(payload.paper_id, 7)
  assert.equal(payload.paper_title, 'Paper Title')
  assert.equal(payload.provider_id, 2)
  assert.equal(payload.selected_text, 'selected')
  assert.match(payload.summary, /必须尽量附页码/)
  assert.match(payload.summary, /\[第 3 页\]/)
})
