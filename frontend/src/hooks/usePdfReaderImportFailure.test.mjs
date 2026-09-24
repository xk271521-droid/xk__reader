import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), 'usePdfReader.js')
const source = readFileSync(sourcePath, 'utf8')

test('does not summarize a temporary paper when server import fails after local parse', () => {
  assert.match(
    source,
    /function handleImportUploadFailure\(\{[\s\S]*?paperId,[\s\S]*?uploadError,[\s\S]*?\}\)/,
  )
  assert.match(
    source,
    /persistPaperToServer\(paperId, file, targetFolderId, metadata\)[\s\S]*?\.catch\(\(uploadError\) => \{[\s\S]*?handleImportUploadFailure\(\{/,
  )
  assert.doesNotMatch(
    source,
    /\.catch\(\(\) => \{\s*scheduleSummarization\(paperId, documentProxy\)\s*\}\)/,
  )
})
