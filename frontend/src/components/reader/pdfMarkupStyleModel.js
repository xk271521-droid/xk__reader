export const MARKUP_TOOL_IDS = ['highlight', 'strikeout', 'underline', 'squiggly', 'ink_highlighter']

export const MARKUP_COLOR_PALETTE = [
  '#FACC15',
  '#22C55E',
  '#3B82F6',
  '#DB2777',
  '#DC2626',
  '#7C3AED',
  '#0F766E',
  '#111827',
]

// The selection popover is intentionally compact. The full eight-color palette
// remains available in the ribbon style panel for less common colors.
export const QUICK_MARKUP_COLOR_PALETTE = MARKUP_COLOR_PALETTE.slice(0, 4)

export const DEFAULT_MARKUP_OPTIONS = {
  color: '#FACC15',
  opacity: 0.72,
  strokeWidth: 18,
}
