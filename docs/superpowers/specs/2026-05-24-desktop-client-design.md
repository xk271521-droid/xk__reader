# Paper Reader Desktop Client Design

Date: 2026-05-24

## Context

The existing project is the web version of Paper Reader: a React/Vite frontend and a FastAPI backend for paper reading, notes, summaries, research matrices, format checks, membership, notifications, and task workflows.

The desktop client must not be implemented by modifying the existing web frontend. The web app remains the browser product. The desktop app is a separate Windows-first client that reuses the same server backend and the same user account data.

## Product Positioning

Build a Windows desktop-enhanced paper workspace, not a simple web wrapper. The desktop client should make long reading and research sessions feel native by adding local file entry, system task feedback, medium offline support, and an integrated literature discovery workspace.

The desktop client and web client share the same backend:

- Accounts, memberships, paper library, task records, notifications, AI outputs, and canonical paper data live on the server.
- The desktop client stores local cache, offline drafts, sync queue entries, recent files, and desktop-specific preferences.
- Server-side AI and heavy document tasks remain server tasks.

## Architecture

Use a separate project, for example `paper-reader-desktop`, outside the current web app code.

Recommended stack:

- Electron + React for the Windows first version.
- Electron main process for native capabilities: file dialogs, drag-and-drop ingestion, file association, system notifications, tray behavior, background sync, local storage, and desktop lifecycle.
- React renderer for the desktop workspace UI.
- A preload bridge with `contextIsolation` enabled for controlled native APIs.
- Existing FastAPI backend as the shared remote API.

This keeps the desktop code independent while still allowing the desktop UI to follow the existing product language and API model.

## Core Desktop Features

### Local PDF Entry

The desktop app supports:

- Dragging PDF files into the app.
- Choosing local PDFs from Windows file dialogs.
- Opening recent files.
- Associating imported local files with server paper records.
- Uploading or binding files to the shared server library when online.

If metadata is missing, the app should offer metadata completion through DOI, title search, or PDF text extraction.

### Background Task Experience

Server tasks still run on the shared backend, including translation, format checking, import parsing, summaries, and other AI workflows.

The desktop client improves the task experience by:

- Keeping a desktop task center in sync with server task records.
- Showing Windows notifications when long tasks complete or fail.
- Allowing retry, cancel, and open-result actions from the desktop task center.
- Preserving pending task submissions when offline, then submitting them when connectivity returns.

### Medium Offline Support

Offline support is scoped to reading and user-authored work:

- Cached papers can be opened while offline.
- Notes, annotations, and reading progress can be edited offline.
- Offline edits are stored locally in a sync queue.
- When online, the app syncs local edits back to the server.

Heavy server tasks do not run offline. When the user starts one while offline, it becomes a pending submission.

Conflict policy:

- Server data is canonical for synced records.
- Unsynced local annotations, notes, and reading progress must not be discarded silently.
- If the same entity changed both locally and remotely, the app should preserve the local draft and ask the user to resolve or merge.

## Literature Discovery Workspace

The desktop client should include a built-in literature discovery hub inspired by dedicated paper-reading desktop tools, but with a cleaner data model.

It has two modes:

### Aggregated Search

The shared backend exposes a literature search API that aggregates and normalizes results from:

- OpenAlex
- Crossref
- arXiv
- Semantic Scholar

The backend handles source requests, caching, rate limiting, deduplication, and normalization. The desktop client receives standardized paper result cards with title, authors, year, venue, DOI, abstract, source, citation hints, and available PDF links.

Desktop UI capabilities:

- Keyword, title, author, and DOI search.
- Result preview.
- One-click import into the user's paper library.
- Import status display.
- Opening an imported result directly in the reader.
- Recent searches stored locally and synced when useful.

The web app can later reuse the same backend search API without sharing desktop UI code.

### Built-In Academic Site Browser

For sources that are better handled as websites, the desktop client includes an internal WebView-like academic browser rather than opening the system browser.

Initial source list:

- CNKI / 知网
- 万方
- Web of Science
- PubMed
- Semantic Scholar website view when needed
- arXiv website view when needed
- Custom user-added search engines

The browser shell includes:

- Search engine sidebar.
- Multi-tab browsing.
- Back, forward, refresh, and address/search controls.
- A right-side assistant panel for detected papers.

When the app can identify a paper page, the assistant panel offers:

- Capture metadata.
- Save to my library.
- Associate a local PDF.
- Add to a research matrix.
- Start reading after import.

This browser mode is a supplement to aggregated search, not the primary data pipeline.

## Backend Additions

The shared backend should add desktop-friendly, reusable APIs:

- Literature search aggregation endpoint.
- Search result normalization and deduplication.
- Search result cache.
- Import-from-search endpoint.
- Desktop sync endpoints for offline notes, annotations, and reading progress.
- Task status streaming or polling optimized for desktop notifications.
- Optional endpoint for desktop client version and update metadata.

These changes are backend additions, not changes to the existing web frontend.

## Local Data

The desktop app should keep a local store for:

- Cached paper metadata.
- Cached PDFs or file references.
- Notes and annotations pending sync.
- Reading progress pending sync.
- Recent files.
- Recent searches.
- User preferences.
- Task submission queue.

The local store should be designed so it can be cleared or repaired without corrupting canonical server data.

## UX Direction

The desktop interface should feel like a focused research workstation:

- Left rail for major areas: home, library, search, tags, tasks, settings.
- Search engine/sidebar inside the discovery hub.
- Tabbed internal browsing for academic websites.
- Main content area for aggregated results, reader, or internal webpages.
- Right assistant panel for metadata, import actions, related papers, task status, and context actions.
- Windows notifications for task outcomes.

Avoid copying the reference app directly. Use it as validation that users expect built-in academic browsing, but keep the UI quieter and more integrated with Paper Reader's existing workflows.

## Non-Goals For First Version

- Do not move the backend into the desktop app.
- Do not rewrite the existing web frontend.
- Do not build full offline library management for all entities.
- Do not scrape restricted academic sites aggressively.
- Do not support macOS or Linux in the first release.
- Do not build a separate desktop-only account system.

## First-Version Success Criteria

- A Windows desktop app can log in to the shared server.
- Users can drag in or choose local PDFs and import them into the shared library.
- Users can search literature inside the app without opening the system browser.
- Aggregated search results can be previewed and imported.
- CNKI/万方/Web of Science/PubMed style workflows can happen in an internal browser tab.
- Cached papers can be read offline.
- Offline notes, annotations, and reading progress sync when connectivity returns.
- Server task completions trigger desktop notifications.

## Implementation Boundary

Desktop implementation should happen in a new independent project. The current repository may be used as read-only reference for API behavior and product workflow, but the existing web frontend must not be modified for desktop-client work.
