const DEFAULT_ECHARTS_IMPORTERS = {
  core: () => import('echarts/core'),
  lineChart: () => import('echarts/lib/chart/line/install.js'),
  barChart: () => import('echarts/lib/chart/bar/install.js'),
  pieChart: () => import('echarts/lib/chart/pie/install.js'),
  gridComponent: () => import('echarts/lib/component/grid/install.js'),
  tooltipComponent: () => import('echarts/lib/component/tooltip/install.js'),
  legendComponent: () => import('echarts/lib/component/legend/install.js'),
  graphicComponent: () => import('echarts/lib/component/graphic/install.js'),
  canvasRenderer: () => import('echarts/lib/renderer/installCanvasRenderer.js'),
}

export function createEchartsLoader(importers = DEFAULT_ECHARTS_IMPORTERS) {
  let loadPromise = null

  return function loadEcharts() {
    if (!loadPromise) {
      loadPromise = Promise.all([
        importers.core(),
        importers.lineChart(),
        importers.barChart(),
        importers.pieChart(),
        importers.gridComponent(),
        importers.tooltipComponent(),
        importers.legendComponent(),
        importers.graphicComponent(),
        importers.canvasRenderer(),
      ])
        .then(([echarts, ...modules]) => {
          echarts.use(modules.map((module) => module.install))
          return echarts
        })
        .catch((error) => {
          loadPromise = null
          throw error
        })
    }

    return loadPromise
  }
}

export const loadEcharts = createEchartsLoader()
