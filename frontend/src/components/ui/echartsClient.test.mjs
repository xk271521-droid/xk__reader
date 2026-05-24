import assert from 'node:assert/strict'
import test from 'node:test'

import { createEchartsLoader } from './echartsClient.js'

test('loads and registers ECharts modules once', async () => {
  const calls = { core: 0 }
  let registered = []
  const loadEcharts = createEchartsLoader({
    core: () => {
      calls.core += 1
      return Promise.resolve({
        init() {},
        use(modules) {
          registered = modules
        },
      })
    },
    lineChart: () => Promise.resolve({ install: 'line' }),
    barChart: () => Promise.resolve({ install: 'bar' }),
    pieChart: () => Promise.resolve({ install: 'pie' }),
    gridComponent: () => Promise.resolve({ install: 'grid' }),
    tooltipComponent: () => Promise.resolve({ install: 'tooltip' }),
    legendComponent: () => Promise.resolve({ install: 'legend' }),
    graphicComponent: () => Promise.resolve({ install: 'graphic' }),
    canvasRenderer: () => Promise.resolve({ install: 'canvas' }),
  })

  const firstLoad = loadEcharts()
  const secondLoad = loadEcharts()
  const echarts = await firstLoad

  assert.equal(firstLoad, secondLoad)
  assert.equal(calls.core, 1)
  assert.equal(typeof echarts.init, 'function')
  assert.deepEqual(registered, [
    'line',
    'bar',
    'pie',
    'grid',
    'tooltip',
    'legend',
    'graphic',
    'canvas',
  ])
})

test('clears cached ECharts promise after failure', async () => {
  let attempts = 0
  const loadEcharts = createEchartsLoader({
    core: () => {
      attempts += 1
      return Promise.reject(new Error('load failed'))
    },
    lineChart: () => Promise.resolve({ install: 'line' }),
    barChart: () => Promise.resolve({ install: 'bar' }),
    pieChart: () => Promise.resolve({ install: 'pie' }),
    gridComponent: () => Promise.resolve({ install: 'grid' }),
    tooltipComponent: () => Promise.resolve({ install: 'tooltip' }),
    legendComponent: () => Promise.resolve({ install: 'legend' }),
    graphicComponent: () => Promise.resolve({ install: 'graphic' }),
    canvasRenderer: () => Promise.resolve({ install: 'canvas' }),
  })

  await assert.rejects(loadEcharts(), /load failed/)
  await assert.rejects(loadEcharts(), /load failed/)
  assert.equal(attempts, 2)
})
