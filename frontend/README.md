# Frontend Foundation

This frontend now uses a shared `shadcn/ui` foundation on top of `Vite + React + Tailwind v4`.

## UI Rules

- New pages and new shared UI should prefer `@/components/ui/*`.
- Do not introduce `Ant Design` or `MUI`.
- Keep business logic out of shared primitives under `src/components/ui`.
- Prefer semantic theme tokens like `bg-background`, `text-foreground`, `border-border`.
- Do not hardcode new brand colors when a semantic token already exists.
- Keep icons on `lucide-react`.
- Keep charts on `recharts`, wrapped with `@/components/ui/chart` when useful.

## Project Conventions

- Import aliases are available through `@/*`.
- Shared helpers live in `@/lib`.
- Theme infrastructure is provided by `src/components/theme-provider.jsx`.
- Light and dark tokens are both defined, but the app currently defaults to light mode.

## Common Paths

- Theme tokens: `src/styles/index.css`
- Shared UI primitives: `src/components/ui`
- Utility helpers: `src/lib/utils.js`
- shadcn config: `components.json`
