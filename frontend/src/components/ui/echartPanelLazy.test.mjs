import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const echartPanelSource = readFileSync(new URL('./echart-panel.jsx', import.meta.url), 'utf8')

test('keeps ECharts out of the EChartPanel module top level', () => {
  assert.doesNotMatch(echartPanelSource, /from ['"]echarts\//)
  assert.doesNotMatch(echartPanelSource, /import \* as echarts/)
  assert.match(echartPanelSource, /loadEcharts/)
})
