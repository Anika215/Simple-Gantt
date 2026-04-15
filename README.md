# Simple Gantt

A lightweight, browser-based Gantt chart tool built with React. Data is stored in Supabase — charts persist across sessions and sync in real time across multiple users.

Built for people who just want to lay out a timeline quickly. No accounts, no onboarding flows, no dragging bars around hoping they snap to the right date.

## Features

- Add and manage tasks with start/end dates
- Organize tasks into color-coded categories (phases)
- Mark tasks as milestones
- Toggle task status between On Track and Delayed
- Adjust the visible date range with zoom controls
- Real-time sync — edits appear live for anyone with the URL
- Data persists in Supabase (survives page reloads, tab closes, etc.)

## Getting Started

**Prerequisites:** Node.js 18+

### 1. Set up Supabase

Create a free project at [supabase.com](https://supabase.com), then run this in the **SQL Editor**:

```sql
create table gantt_data (
  id text primary key default 'main',
  data jsonb not null,
  updated_at timestamptz default now()
);

alter table gantt_data enable row level security;
create policy "Allow all" on gantt_data for all using (true) with check (true);

alter publication supabase_realtime add table gantt_data;
```

### 2. Configure environment

Create a `.env.local` file in the project root:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-key
```

Find these in your Supabase project under **Settings → API Keys**.

### 3. Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Deploy

Build and deploy the static output anywhere (Vercel, Netlify, etc.):

```bash
npm run build
```

For Vercel, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables in the project settings before deploying.

## Usage

- **+ Add Task** — create a task with a name, category, date range, and optional milestone flag
- **⊕ Category** — add a new phase/category with a color
- Click any task bar or name to edit it
- Hover a task row to reveal edit, status toggle, and delete controls
- Use the **View** date pickers in the header to pan the timeline
- Use **−/+** to zoom out/in on the timeline
- **Fit** snaps the view to fit all tasks
