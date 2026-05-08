function getBlockKind(text, fontSize, pageHeight, top) {
  const normalized = String(text || '').trim()
  if (!normalized) return 'paragraph'
  if (top < pageHeight * 0.09 || top > pageHeight * 0.92) return 'footer'
  if (/^(references|参考文献)\b/i.test(normalized)) return 'reference'
  if (fontSize >= 17 || (fontSize >= 14 && normalized.length < 140 && !/[.!?。！？]$/.test(normalized))) {
    return 'title'
  }
  if (/^\d+(\.\d+)*\s+\S+/.test(normalized) && normalized.length < 120) return 'heading'
  if (/^(fig\.|figure|table)\s*\d+/i.test(normalized)) return 'caption'
  return 'paragraph'
}

function shouldSkipTranslate(text, kind) {
  const value = String(text || '').trim()
  if (!value) return true
  if (kind === 'footer') return true
  if (/^(https?:\/\/|doi:|www\.)/i.test(value)) return true
  if (/^(\[\d+\]|\d+\.)\s/.test(value) && value.length < 80) return true
  if (/^[\d\s()[\].,;:/\\+\-=<>%°]+$/.test(value)) return true
  if (value.length < 3) return true
  return false
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function shouldJoinTextItems(previous, current, lineHeight) {
  if (!previous || !current) return false
  const gap = current.x - previous.right
  if (gap < -Math.max(3, lineHeight * 0.35)) return false
  if (gap > Math.max(18, lineHeight * 1.8)) return false
  return Math.abs(current.fontSize - previous.fontSize) < 2.5
}

function lineFromTextItem(item, pageWidth, pageHeight, index) {
  const text = normalizeText(item.str)
  if (!text) return null

  const transform = item.transform || []
  const x = Number(transform[4]) || 0
  const y = Number(transform[5]) || 0
  const fontSize = Math.max(8, Math.abs(Number(transform[3]) || Number(item.height) || 12))
  const width = Math.max(4, Number(item.width) || text.length * fontSize * 0.45)
  const height = Math.max(fontSize * 1.15, Number(item.height) || fontSize)
  const top = Math.max(0, Math.min(pageHeight, pageHeight - y - height))

  return {
    id: `item-${index}`,
    text,
    x: Math.max(0, Math.min(pageWidth, x)),
    y: top,
    right: Math.max(0, Math.min(pageWidth, x + width)),
    bottom: Math.max(0, Math.min(pageHeight, top + height)),
    fontSize,
  }
}

function mergeTextItemsToLines(items, pageWidth, pageHeight) {
  const fragments = items
    .map((item, index) => lineFromTextItem(item, pageWidth, pageHeight, index))
    .filter(Boolean)
    .sort((a, b) => (Math.abs(a.y - b.y) > 3 ? a.y - b.y : a.x - b.x))
  const rows = []

  for (const fragment of fragments) {
    const row = rows.find((candidate) => {
      const rowHeight = Math.max(10, candidate.bottom - candidate.y)
      return Math.abs(fragment.y - candidate.y) < Math.max(3, rowHeight * 0.45)
    })
    if (row) {
      row.items.push(fragment)
      row.y = Math.min(row.y, fragment.y)
      row.bottom = Math.max(row.bottom, fragment.bottom)
      row.fontSize = Math.max(row.fontSize, fragment.fontSize)
    } else {
      rows.push({
        y: fragment.y,
        bottom: fragment.bottom,
        fontSize: fragment.fontSize,
        items: [fragment],
      })
    }
  }

  return rows
    .sort((a, b) => a.y - b.y)
    .flatMap((row) => {
      const sorted = row.items.sort((a, b) => a.x - b.x)
      const lineHeight = Math.max(10, row.bottom - row.y)
      const groups = []
      for (const item of sorted) {
        const last = groups[groups.length - 1]
        const previous = last?.items[last.items.length - 1]
        if (last && shouldJoinTextItems(previous, item, lineHeight)) {
          const needsSpace = item.x - previous.right > Math.max(1.5, item.fontSize * 0.18)
          last.text += `${needsSpace ? ' ' : ''}${item.text}`
          last.items.push(item)
          last.right = Math.max(last.right, item.right)
          last.bottom = Math.max(last.bottom, item.bottom)
          last.fontSize = Math.max(last.fontSize, item.fontSize)
        } else {
          groups.push({
            text: item.text,
            items: [item],
            x: item.x,
            y: item.y,
            right: item.right,
            bottom: item.bottom,
            fontSize: item.fontSize,
          })
        }
      }
      return groups.map((group) => ({
        id: group.items.map((item) => item.id).join('-'),
        text: normalizeText(group.text),
        x: group.x,
        y: group.y,
        right: group.right,
        bottom: group.bottom,
        fontSize: group.fontSize,
      }))
    })
}

function mergeLinesToBlocks(lines, pageNumber, pageWidth, pageHeight) {
  const sorted = lines
    .filter(Boolean)
    .sort((a, b) => (Math.abs(a.y - b.y) > 3 ? a.y - b.y : a.x - b.x))
  const blocks = []

  for (const line of sorted) {
    const last = blocks[blocks.length - 1]
    const lineHeight = Math.max(10, line.bottom - line.y)
    const paragraphIndentOk = last && Math.abs(line.x - last.x) < Math.max(46, lineHeight * 3.2)
    const lineSpacingOk = last && line.y - last.bottom < Math.max(18, lineHeight * 1.8)
    const fontOk = last && Math.abs(line.fontSize - last.fontSize) < 2.5
    const previousLooksOpen = last && (!/[.!?。！？]$/.test(last.text.trim()) || line.x >= last.x - Math.max(12, lineHeight))
    const canMerge = last
      && paragraphIndentOk
      && lineSpacingOk
      && fontOk
      && previousLooksOpen
      && last.text.length < 1600
      && !/^(abstract|摘要|references|参考文献)$/i.test(last.text.trim())

    if (canMerge) {
      last.text = `${last.text} ${line.text}`.trim()
      last.right = Math.max(last.right, line.right)
      last.bottom = Math.max(last.bottom, line.bottom)
      last.fontSize = Math.max(last.fontSize, line.fontSize)
    } else {
      blocks.push({
        text: line.text,
        x: line.x,
        y: line.y,
        right: line.right,
        bottom: line.bottom,
        fontSize: line.fontSize,
      })
    }
  }

  return blocks.map((block, index) => {
    const text = normalizeText(block.text)
    const kind = getBlockKind(text, block.fontSize, pageHeight, block.y)
    return {
      id: `p${pageNumber}-b${index + 1}`,
      kind,
      source_text: text,
      translated_text: '',
      bbox: [
        Math.max(0, block.x),
        Math.max(0, block.y),
        Math.min(pageWidth, Math.max(block.right, block.x + 16)),
        Math.min(pageHeight, Math.max(block.bottom, block.y + block.fontSize * 1.4)),
      ],
      font_size: block.fontSize,
      font_weight: kind === 'title' || kind === 'heading' ? 700 : 400,
      align: 'left',
      skip_translate: shouldSkipTranslate(text, kind),
    }
  })
}

export function hashTranslationPages(pages) {
  const source = JSON.stringify(pages.map((page) => ({
    page_number: page.page_number,
    width: Math.round(page.width),
    height: Math.round(page.height),
    blocks: page.blocks.map((block) => ({
      id: block.id,
      text: block.source_text,
      bbox: block.bbox.map((value) => Math.round(value * 100) / 100),
      skip: block.skip_translate,
    })),
  })))
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `ft${(hash >>> 0).toString(16).padStart(8, '0')}${source.length.toString(16)}`
}

export async function buildFullTranslationPages(pdfDocument, pageMetrics) {
  if (!pdfDocument) return []
  const pageCount = Math.min(pdfDocument.numPages || pageMetrics?.length || 0, 200)
  const pages = []

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const width = pageMetrics?.[pageNumber - 1]?.width || viewport.width
    const height = pageMetrics?.[pageNumber - 1]?.height || viewport.height
    const textContent = await page.getTextContent()
    const lines = mergeTextItemsToLines(textContent.items, width, height)

    pages.push({
      page_number: pageNumber,
      width,
      height,
      blocks: mergeLinesToBlocks(lines, pageNumber, width, height),
    })
  }

  return pages
}
