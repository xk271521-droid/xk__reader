import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const viteConfigSource = readFileSync(new URL('./vite.config.js', import.meta.url), 'utf8')

test('splits large chart and export dependencies into narrower vendor chunks', () => {
  assert.match(viteConfigSource, /id\.includes\('echarts'\)\) return 'vendor-echarts'/)
  assert.match(viteConfigSource, /id\.includes\('recharts'\)\) return 'vendor-recharts'/)
  assert.match(viteConfigSource, /id\.includes\('jspdf'\)\) return 'vendor-jspdf'/)
  assert.match(viteConfigSource, /id\.includes\('html2canvas'\)\) return 'vendor-html2canvas'/)
  assert.match(viteConfigSource, /id\.includes\('zrender'\)\) return 'vendor-zrender'/)
})
