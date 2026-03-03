# Simple Gantt

A lightweight, browser-based Gantt chart tool built with React. No backend required — everything runs in the browser and persists to localStorage.

Built for people who just want to lay out a timeline quickly. No accounts, no onboarding flows, no dragging bars around hoping they snap to the right date.

## Features

- Add and manage tasks with start/end dates
- Organize tasks into color-coded categories (phases)
- Mark tasks as milestones
- Toggle task status between On Track and Delayed
- Adjust the visible date range
- Auto-saves to localStorage

## Getting Started

**Prerequisites:** Node.js 18+

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Build

```bash
npm run build
```

Output is in the `dist/` folder — deploy anywhere that serves static files.

## Usage

- **Add Task** — create a task with a name, category, date range, and optional milestone flag
- **⊕ Category** — add a new phase/category with a color
- Click any task bar or name to edit it
- Hover a task row to reveal edit, status toggle, and delete controls
- Use the **View** date pickers in the header to zoom in or out on the timeline
