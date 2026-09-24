---
target: 阅读记录首页（HomePage）
total_score: 20
p0_count: 0
p1_count: 4
timestamp: 2026-08-08T15-33-45Z
slug: frontend-src-components-home-homepage-jsx
---
## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3 | Current section and reading state are visible, but task priority is not obvious. |
| 2 | Match with real world | 3 | Research-reading vocabulary is natural. |
| 3 | User control and freedom | 2 | Main routes are visible; clearing and recovery states are not evident on this screen. |
| 4 | Consistency and standards | 2 | Repeated override layers produce inconsistent cards, radii, and emphasis. |
| 5 | Error prevention | 2 | Cannot verify prevention states from this screen. |
| 6 | Recognition rather than recall | 3 | Labeled navigation, recent papers, and search reduce recall. |
| 7 | Flexibility and efficiency | 2 | Search exists, but a dense research workspace needs clearer accelerators and more direct row actions. |
| 8 | Aesthetic and minimalist design | 1 | Four equal-weight modules, repeated borders, and low-contrast metadata create visual noise. |
| 9 | Error recovery | 1 | Recovery guidance cannot be verified on this screen. |
| 10 | Help and documentation | 1 | Support exists in global navigation but no contextual help is visible. |
| **Total** | | **20/40** | **Acceptable: significant refinement needed** |

## Anti-Patterns Verdict

The page does not look like a generic marketing dashboard, but it does look assembled through several styling passes rather than governed by one coherent desktop-workspace system. The visual problem is structural: most modules are framed as bordered surfaces, headers repeat, and information with different urgency is given similar weight.

The deterministic scan on `HomePage.jsx` returned no automatic findings. This is not a clean bill of health: the main issues live in the visual composition and in the large CSS cascade, which the JSX-only scan does not inspect.

## Overall Impression

The functional model is sound: continue reading, resolve a pending item, inspect recent work. The page needs to behave like a quiet research desk rather than a vertical stack of unrelated dashboard widgets.

## What Is Working

- The continuation card gives the user a credible return point into a paper.
- The navigation labels are direct and domain-appropriate.
- Recent records are grouped by time, which supports resuming research work.

## Priority Issues

### P1: The first viewport has no single visual job

Continue reading, pending work, weekly statistics, and reading history all compete in the same visual register. The user has to decide where to look before starting work.

Fix: retain one primary continuation surface; place pending work and a compact weekly summary in a single secondary band; make recent records the uninterrupted working list below.

### P1: Borders and containers are doing too much work

The continuation card, task list, statistics strip, recent-list frame, day header, row dividers, metadata chips, and buttons all add outlines. This creates a pale grid instead of hierarchy.

Fix: reserve a complete border for only two surfaces: the continuation surface and the data table/list. Use spacing and dividers for all other grouping. Remove decorative gradients and most chips.

### P1: Typography and metadata are difficult to scan

Long English titles, author strings, tag rows, counts, and timestamps share a narrow visual range. Several secondary labels are too light, while the primary task count is visually separated from its meaning.

Fix: use a fixed product type scale (12, 13, 14, 16, 20, 24px), one sans family, 600-700 maximum heading weights, one-line author metadata with truncation, and a single textual status next to each paper title.

### P1: Styling is being maintained through override accumulation

`app.css` defines the same home rules in the base section and again around lines 23k, 29k, 32k. The final continuation-card override even reintroduces a blue radial gradient after a flatter desktop pass. This makes future visual changes unpredictable.

Fix: extract a dedicated home-workspace stylesheet or consolidate the final source of truth for `.home-*` rules; remove superseded declarations rather than appending another EOF override.

### P2: Contrast and action affordance need a targeted pass

Pale metadata, placeholder text, and secondary actions risk reading as disabled. Screenshot evidence alone cannot establish WCAG compliance.

Fix: raise secondary text to a tested ink value, preserve a visible focus ring, and turn row actions into a consistent primary/secondary/quiet action vocabulary.

## Persona Red Flags

**Alex (Power User):** The top-level decision space is noisy: continuation, task triage, weekly counts, and history are all visible before a first action. The large author strings make scanning a known paper slower than necessary.

**Sam (Accessibility-Dependent User):** Low-contrast metadata and button labels may be hard to distinguish from disabled states. Keyboard focus, semantic table/list structure, and screen-reader feedback cannot be verified from the screenshot.

## Minor Observations

- The search field is visually detached from the pending-task heading. It belongs in the workspace utility row, not in a content header.
- The green task number says little without the adjacent title; make the whole row carry the semantic status instead.
- The weekly statistics are useful, but they are subordinate context. They should not occupy the same visual weight as the current reading task.

## Questions To Consider

- Should the home page optimize for resuming one paper, or for monitoring an entire reading queue? It cannot lead equally with both.
- Does a reading record need to expose every author on the home page, or only enough identity to choose the right paper?
- Which information should still be present when a researcher opens the app for only 15 seconds between tasks?
