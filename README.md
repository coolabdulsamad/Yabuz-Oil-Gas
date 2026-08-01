# Yabuz Oil & Gas — Distributor Management Suite

A full-stack web application for **Yabuz Oil and Gas Ltd**, a Nigerian lubricants
distribution company that buys from Polar Petrochemicals Limited at producer
price and resells at marketer price. It replaces manual Excel sheets with a
role-based, approval-driven system.

## Features

- **Roles & permissions** — SUPER_ADMIN, ADMIN, MANAGER, SALES with per-role
  permissions and per-user overrides; sidebar modules follow permissions.
- **Approval workflows** — configurable multi-step chains for sales, payments,
  purchases, stock adjustments, price lists and settings changes.
- **Inventory** — products with images (Cloudinary), pack/unit tracking, stock
  movements, purchases, stock counts, low-stock alerts.
- **Sales** — detailed sale forms, pack-vs-unit selling, discounts, order
  numbers, sale detail pages.
- **Payments** — payment recording with allocation, advance deposits, credit
  (debtor) management, payment proofs with image upload and confirmation.
- **Customers** — profiles, credit limits, balances, account actions.
- **Expenses** — categorized operating expenses with approval.
- **Reports & analytics** — sales/profit/COGS reports, dashboards with charts.
- **Price lists** — producer vs marketer pricing, cost visibility is
  permission-gated.
- **Team chat** — direct messages, groups, an auto-created "Yabuz Team" group,
  unread badges, entity references (products/customers/sales) resolved
  server-side with permission checks.
- **AI assistant** — a built-in deterministic data engine that answers business
  questions from live database facts (stock, prices, debtors, best sellers,
  profit, payments), permission-aware; optional LLM polish via an
  OpenAI-compatible endpoint configured in Settings.
- **Audit log** — every sensitive action recorded with before/after snapshots,
  actor, IP and user agent; filterable viewer with stats.

## Tech stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui, Recharts
- **Backend**: Hono + tRPC 11 (superjson), Node.js
- **Database**: MySQL-compatible (TiDB Cloud) via Drizzle ORM
- **Images**: Cloudinary
- **Auth**: session/JWT-based login with seeded roles

## Getting started

```bash
npm install
cp .env.example .env   # fill in APP_ID, APP_SECRET, DATABASE_URL
npm run dev            # serves API + Vite dev server on port 3000
```

Database schema is managed with Drizzle (`db/schema.ts`); seed data (roles,
permissions, demo users, settings) is in `db/seed.ts`.

> **Note**: `.env` is never committed — it contains live credentials.
> Default seeded users share the password `Yabuz@123`; change it after first login.
