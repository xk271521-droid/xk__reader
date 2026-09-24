# Single-Paper Reading Focus

## Decision

As of 2026-08-08, the product focuses on helping a user understand and read one paper well. The standalone literature-summary and literature-matrix features are retired.

## Removed

- Frontend entries, pages, preview cards, preload state, notifications, task actions, and membership copy for literature summaries and matrices.
- Backend routes, workers, task-monitor branches, quota entries, model associations, and unused AI full-paper summary endpoint.
- Related admin/task-center status rows and resource-overview metrics.

## Preserved

- Selected-text immediate translation and reading chat.
- "AI 精读" is an entry into reading chat, not an independent explanation feature. Clicking it immediately sends the selected word, sentence, or passage to the reading-chat panel for explanation.
- Every answer request is single-turn and paper-scoped; the current paper is sent as the primary context, while the model may supplement concepts and background with clearly labelled general knowledge:
  - AI 精读 sends the full text of the current paper plus the current selection.
  - A manually entered question sends the full text of the current paper plus the current question.
  - Previous chat messages are display-only and are never sent to the model automatically.
- Chat display history is kept only while the paper tab remains open. Closing the paper clears that paper's messages, input, loading state, and suggestions; reopening it starts a new temporary chat.
- Different open papers keep separate in-memory chat state and never share context.
- Notes, highlights, annotations, page navigation, reading records, paper import, full translation, and ordinary task-center scaffolding.
- Existing database tables and historical summary/matrix records. No data deletion or destructive migration is performed.

## Acceptance

1. No user-facing entry or copy advertises literature summaries or matrices.
2. The retired API routes and workers are no longer registered or started.
3. Clicking "AI 精读" opens reading chat and immediately creates a selection-explanation request; the user does not need to submit the selection again.
4. Both AI 精读 and manual questions send the current paper's extracted full text, with no previous chat messages in the model request. Paper facts must be grounded in that text; general knowledge is allowed only when it is clearly distinguished from paper evidence.
5. Closing a paper clears its temporary chat state. Reopening it does not restore an earlier transcript.
6. Frontend tests and production build pass; backend tests/modules compile and the application imports successfully.

## Deferred Token Optimization

The first implementation deliberately sends the full extracted paper text on every answer request. This prioritizes answer accuracy and gives providers with prompt caching a stable repeated prefix.

Do not introduce chunk retrieval, embeddings, rolling summaries, or chat-history prompting in this phase. Revisit token optimization only after real usage data shows that cost or latency is too high. At that point, evaluate a separate design that preserves full-paper answer quality, such as stable-prefix provider caching plus evidence retrieval and a full-text fallback.

## Implementation Notes

- The browser sends `paper_id`, the current question or selection, request kind, and provider ID. It does not send chat history or a browser-built paper summary.
- The backend verifies that the paper belongs to the current user, extracts every text page from the PDF, adds `[第 N 页]` markers, and places the full paper before the changing question in the model prompt.
- Extracted PDF text is cached for up to eight recent papers inside each backend process. File size and modification time invalidate stale entries.
- The stable paper-first prompt ordering allows compatible providers to reuse prefix caching, but cache availability and billing remain controlled by the provider.
- Text-only extraction cannot read image-only/scanned PDFs without a text layer. Those papers return a clear error instead of silently answering from incomplete context.
- A provider whose model context limit is smaller than the paper may reject the request. The current phase does not truncate the paper silently.

## Verification

- Backend: 77 tests pass; modules compile; the local health endpoint returns 200 after restart.
- Frontend: 100 tests pass; the production Vite build succeeds.
- Runtime: local `/api/health` returns 200; OpenAPI exposes the full-paper ask route and no longer exposes persistent paper-chat or selection-context explanation routes.

The staged design and acceptance criteria are recorded in [paper-ai-token-optimization-plan.md](paper-ai-token-optimization-plan.md). This plan is documentation only until the full-paper baseline has been verified and the user explicitly starts the optimization phase.

## Change Log

- 2026-08-08: User confirmed that only the two large features should be removed. Work completed within that scope; historical database records remain untouched.
- 2026-08-08: Development defaults to the web app only. Do not package the Electron desktop app unless the user explicitly requests a desktop build or release.
- 2026-08-08: Full-paper single-turn AI requests chosen for the first release. Token optimization is explicitly deferred until usage data justifies it.
- 2026-08-08: Persisted paper chat was rejected. Chat is temporary per open paper and is cleared when its tab closes.
- 2026-08-08: The built-in official DeepSeek provider was upgraded in place from `deepseek-chat` to `deepseek-v4-flash`; existing enablement and API keys are preserved.
- 2026-08-09: The built-in official GLM provider was upgraded in place from `glm-4-flash` to `glm-4.7-flash` with a replacement key. GLM thinking is explicitly enabled; the reader renders final content while the model retains its internal reasoning path.
- 2026-08-09: Corrected the paper-QA prompt boundary. AI 精读 and 边读边问 now treat the current paper as primary context rather than the model's only knowledge source; paper evidence and model-supplied general knowledge must be visibly distinguished.
- 2026-08-09: Refined question routing so term/sentence explanations start from the model's general knowledge and reasoning, then return to the paper's context; paper-specific facts still remain grounded in the full text.
