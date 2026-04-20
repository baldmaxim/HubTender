# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TenderHUB by SU_10 is a construction tender management portal for Bill of Quantities (BOQ) and bidding workflows.

- **Language Convention**: Russian UI, English code, Russian commit messages
- **Stack**: React 18 + Ant Design + Supabase + Vite + TypeScript
- **Branding**: Design system documented in BRANDING.md

## Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (http://localhost:3000, auto-opens)
npm run build        # TypeScript check + Vite production build
npm run lint         # ESLint with zero-warning enforcement (max-warnings: 0)
npm run preview      # Preview production build

# Database
supabase db push                # Apply migrations
supabase db reset               # Reset local database (destructive)
supabase migration new <name>   # Create new migration file

# Environment: create .env.local with VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
```

## Critical Rules

### Database Single Source of Truth
`supabase/schemas/prod.sql` is the canonical schema. ALWAYS verify it before any database work. NEVER trust TypeScript types over prod.sql definitions. Business tables are defined in `supabase/migrations/`.

### Secrets Must Not Use VITE_ Prefix
Vite inlines every `VITE_*` variable into the client bundle. NEVER prefix a secret with `VITE_`:
- ✅ `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (anon key is public by design)
- ❌ `VITE_SUPABASE_SERVICE_ROLE_KEY`, `VITE_DATABASE_URL`, any JWT signing key, DB password
- Server-side variables (dev scripts in `scripts/`, Go backend) use plain names: `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, etc.
- Template in `.env.example`.

### File Size Limit
**STRICT**: All files MUST be ≤ 600 lines. Split into `components/`, `hooks/`, `utils/`, and `types.ts` as needed.

### Git Conventions
- **Commits**: Russian, imperative mood (e.g., "Добавить валидацию форм", "Исправить ошибку в расчетах")
- **Branches**: `feature/`, `fix/`, `refactor/` prefixes

## Architecture

### Provider Hierarchy (App.tsx)
```
ThemeProvider → AuthProvider → ConfigProvider (Ant Design) → AntApp → Routes
```

### Routing Structure
All authenticated routes are wrapped in `<ProtectedRoute>` inside `<MainLayout>`. Routes are defined in `src/App.tsx`. Public routes: `/login`, `/register`, `/forgot-password`, `/reset-password`. The sidebar menu in MainLayout is filtered by `hasPageAccess()` based on user's `allowed_pages`.

### Authentication & Access Control
- **AuthContext** (`src/contexts/AuthContext.tsx`): Provides `useAuth()` hook with `user`, `loading`, `signOut`, `refreshUser`
- **Auth flow**: Supabase Auth (email/password) → loads user from `public.users` → loads role from `public.roles`
- **Role system**: `roles` table has `code`, `name`, `color`. Users reference `role_code`. Roles: `administrator`, `developer`, `director`, `senior_group`, `engineer`, `general_director`
- **Page access**: `users.allowed_pages` (JSONB array, empty = full access). Check via `hasPageAccess(user, path)` from `src/lib/supabase/types.ts`
- **Access control helpers**: `canManageUsers()`, `isAdmin()`, `isLeader()`, `hasPageAccess()` — all in `src/lib/supabase/types.ts`

### Theme System
- **ThemeContext** (`src/contexts/ThemeContext.tsx`): `useTheme()` provides `theme` ('light'|'dark') and `toggleTheme()`
- **Storage**: localStorage key `tenderHub_theme`, defaults to dark
- **Colors**: Primary `#10b981` (emerald), configured in App.tsx ConfigProvider
- **Ant Design**: Uses `theme.darkAlgorithm` / `theme.defaultAlgorithm`

### State Management
- No Redux/Zustand — only React contexts (Theme, Auth) and local state
- Server state via direct Supabase calls (no React Query)
- Forms use Ant Design Form components

## Key Data Patterns

### Supabase Client
```typescript
import { supabase } from '../lib/supabase';  // barrel export from src/lib/supabase/index.ts
import type { Tender } from '../lib/supabase/types';
```

### Audit Logging (BOQ Items)
Uses RPC-based wrappers in `src/lib/supabaseWithAudit.ts`:
- `insertBoqItemWithAudit(userId, data)`
- `updateBoqItemWithAudit(userId, itemId, data)`
- `deleteBoqItemWithAudit(userId, itemId)`

The old `executeWithAudit()` is **deprecated** — do not use it.

### Real-time Subscriptions
Used for notifications in MainLayout. Pattern:
```typescript
const channel = supabase
  .channel('channel-name')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'table_name' }, callback)
  .subscribe();
// Cleanup: supabase.removeChannel(channel);
```

### Database Conventions
- UUID primary keys with `uuid_generate_v4()`
- `created_at`/`updated_at` timestamps with automatic triggers
- `created_by` FK to `auth.users.id`
- RLS policies on all tables

## Core Database Tables

- `users` — accounts with `role_code`, `access_status`, `allowed_pages`, `access_enabled`
- `roles` — role definitions with `code`, `name`, `color`, `allowed_pages`
- `tenders` — main tender records with currency rates, housing_class, construction_scope
- `tender_registry` — tender listing with chronology, statuses, archival
- `material_names`, `work_names` — name libraries with units
- `materials_library`, `works_library` — full material/work definitions with rates
- `client_positions` — BOQ positions per tender
- `boq_items` — detailed BOQ items (materials & works) per position
- `templates`, `template_items` — reusable BOQ templates
- `cost_categories`, `detail_cost_categories` — cost structure hierarchy
- `construction_cost_volumes` — volumes per tender per detail category
- `markup_tactics` — pricing strategies with sequences (JSONB)
- `markup_parameters`, `tender_markup_percentages` — markup config per tender
- `tender_pricing_distribution` — how costs distribute to material/work columns
- `tasks` (`user_tasks`) — task management linked to users and tenders
- `notifications` — system notifications with real-time subscriptions
- `audit_log` — change tracking
- **ENUMs**: `unit_type`, `material_type`, `boq_item_type`, `currency_type`, `housing_class_type`, `construction_scope_type`, `access_status_type`

## Type System

Types are centralized in `src/lib/supabase/`:
- `types.ts` — all entity types, enums, role constants, page access helpers, mapping functions
- `types/tasks.ts` — task-related types
- `index.ts` — barrel re-export of client + all types

Naming convention: `FooInsert` (for creation), `Foo` (full entity), `FooFull` (with JOIN data).

Key mapped types:
- `BoqItemType` = `'мат' | 'суб-мат' | 'мат-комп.' | 'раб' | 'суб-раб' | 'раб-комп.'`
- `TabKey` ↔ `BoqItemType` mappings via `TAB_TO_BOQ_TYPE` and `BOQ_TYPE_TO_TAB`
- `MarkupStep` — complex formula structure for pricing calculations (up to 5 chained operations)

## File Organization

Pages follow this structure:
```
src/pages/PageName/
├── PageName.tsx           # Main component
├── components/            # Page-specific components with index.ts barrel
├── hooks/                 # Custom hooks (usePageLogic, useDataFetching, etc.)
├── utils/                 # Helper functions
└── types.ts               # Page-specific types
```

Shared code:
- `src/components/` — reusable components (Auth, Icons, Layout)
- `src/contexts/` — React contexts (AuthContext, ThemeContext)
- `src/lib/supabase/` — Supabase client, types, barrel exports
- `src/lib/supabaseWithAudit.ts` — audited CRUD wrappers

## Key Domain Concepts

### BOQ Hierarchy
Tenders → Client Positions → BOQ Items (materials & works per position)

### Item Types
- Materials: `мат` (basic), `суб-мат` (subcontract), `мат-комп.` (component)
- Works: `раб` (basic), `суб-раб` (subcontract), `раб-комп.` (component)
- `material_type`: `основн.` (primary) or `вспомогат.` (auxiliary)

### Cost Calculation Flow
1. Detail cost categories define cost structure per location
2. Markup tactics define formula sequences per item type
3. Markup percentages are set per tender per parameter
4. Pricing distribution controls which column (material/work) receives costs
5. Cost redistribution moves amounts between categories

### Excel Import/Export
- `xlsx` for reading, `xlsx-js-style` for writing with formatting
- Used in: Tenders (BOQ import), Nomenclatures (bulk import), Library (export)

## Common Workflows

### Adding a New Page
1. Create `src/pages/PageName/PageName.tsx`
2. Add route in `src/App.tsx` under the ProtectedRoute layout
3. Add menu item in `MainLayout.tsx` menuItems array
4. Add page path to `ALL_PAGES` and `PAGE_LABELS` in `src/lib/supabase/types.ts`
5. Add types to `src/lib/supabase/types.ts` if using new tables

### Creating a New Database Table
1. `supabase migration new table_name`
2. Write SQL with UUID PK, timestamps, created_by FK, RLS policies
3. `supabase db push`
4. Add TypeScript types to `src/lib/supabase/types.ts`
5. Update `supabase/schemas/prod.sql`

## Tech Stack

Core dependencies are in `package.json`. Notable libraries:
- **UI**: `antd` + `@ant-design/icons` + `@ant-design/charts`
- **Charts**: `chart.js` + `react-chartjs-2` + `chartjs-plugin-datalabels`
- **Excel**: `xlsx` (read) + `xlsx-js-style` (write with styling)
- **Drag & Drop**: `@dnd-kit/core` + `@dnd-kit/sortable`
- **Dates**: `dayjs`
- **Routing**: `react-router-dom` v7
- **TypeScript**: strict mode disabled, target ES2020
