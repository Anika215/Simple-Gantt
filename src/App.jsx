import React, { useState, useRef, useEffect } from "react";
import { supabase } from "./supabase";

const COLORS = [
  { name: "Emerald", bar: "#059669", light: "#d1fae5", text: "#065f46", border: "#6ee7b7" },
  { name: "Blue",    bar: "#2563eb", light: "#dbeafe", text: "#1e3a8a", border: "#93c5fd" },
  { name: "Violet",  bar: "#7c3aed", light: "#ede9fe", text: "#4c1d95", border: "#c4b5fd" },
  { name: "Rose",    bar: "#e11d48", light: "#ffe4e6", text: "#9f1239", border: "#fda4af" },
  { name: "Amber",   bar: "#d97706", light: "#fef3c7", text: "#92400e", border: "#fcd34d" },
  { name: "Cyan",    bar: "#0891b2", light: "#cffafe", text: "#164e63", border: "#67e8f9" },
];

const DEFAULT_CATEGORIES = [
  { id: "phase-a",  name: "Phase A",  colorIdx: 0 },
  { id: "phase-b",  name: "Phase B",  colorIdx: 2 },
  { id: "phase-c",  name: "Phase C",  colorIdx: 1 },
];

const DEFAULT_TASKS = [
  { id: 1, name: "Kickoff",          categoryId: "phase-a", start: "2026-03-03", end: "2026-03-03", status: "on-track", milestone: true  },
  { id: 2, name: "Task A1",          categoryId: "phase-a", start: "2026-03-03", end: "2026-03-14", status: "on-track", milestone: false },
  { id: 3, name: "Task A2",          categoryId: "phase-a", start: "2026-03-15", end: "2026-03-31", status: "on-track", milestone: false },
  { id: 4, name: "Task B1",          categoryId: "phase-b", start: "2026-04-01", end: "2026-04-30", status: "on-track", milestone: false },
  { id: 5, name: "Task B2",          categoryId: "phase-b", start: "2026-04-01", end: "2026-04-30", status: "on-track", milestone: false },
  { id: 6, name: "Task B3",          categoryId: "phase-b", start: "2026-04-01", end: "2026-05-31", status: "on-track", milestone: false },
  { id: 7, name: "Task C1",          categoryId: "phase-c", start: "2026-04-15", end: "2026-05-31", status: "on-track", milestone: false },
];

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
function formatDate(str) {
  const d = new Date(str + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function taskRangeView(tasks) {
  if (!tasks.length) {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0],
      end:   new Date(now.getFullYear(), now.getMonth() + 3, 0).toISOString().split("T")[0],
    };
  }
  const sorted = [...tasks].map(t => t.start).sort();
  const sortedE = [...tasks].map(t => t.end).sort();
  const s = new Date(sorted[0] + "T00:00:00");
  const e = new Date(sortedE[sortedE.length - 1] + "T00:00:00");
  return {
    start: new Date(s.getFullYear(), s.getMonth(), 1).toISOString().split("T")[0],
    end:   new Date(e.getFullYear(), e.getMonth() + 1, 0).toISOString().split("T")[0],
  };
}

function todayStr() { return new Date().toISOString().split("T")[0]; }
function todayPlusMonthStr() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, d.getDate()).toISOString().split("T")[0];
}

export default function GanttTool() {
  const [tasks,      setTasks]      = useState(DEFAULT_TASKS);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [viewStart,  setViewStart]  = useState(() => taskRangeView(DEFAULT_TASKS).start);
  const [viewEnd,    setViewEnd]    = useState(() => taskRangeView(DEFAULT_TASKS).end);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showAddCat,  setShowAddCat]  = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [editingCat,  setEditingCat]  = useState(null);
  const [nextId, setNextId] = useState(100);
  const [hiddenCats, setHiddenCats] = useState({});
  const [expandedTasks, setExpandedTasks] = useState({});
  const [note, setNote] = useState("Add any important notes or contingency plans here.");
  const [loaded, setLoaded] = useState(false);
  const [pxPerDay, setPxPerDay] = useState(8);
  const isSaving = useRef(false);
  const deletedTaskIds = useRef(new Set());
  const deletedCatIds  = useRef(new Set());
  const saveTimer = useRef(null);
  // Always-current refs so async callbacks never read stale closure values
  const tasksRef = useRef(tasks);
  const categoriesRef = useRef(categories);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { categoriesRef.current = categories; }, [categories]);

  // Merge remote data into local — never drop IDs we have locally
  function mergeRemote(remote) {
    const localTaskIds = new Set(tasksRef.current.map(t => t.id));
    const extraTasks = (remote.tasks || []).filter(t => !localTaskIds.has(t.id) && !deletedTaskIds.current.has(t.id));
    if (extraTasks.length) setTasks(prev => [...prev, ...extraTasks]);

    const localCatIds = new Set(categoriesRef.current.map(c => c.id));
    const extraCats = (remote.categories || []).filter(c => !localCatIds.has(c.id) && !deletedCatIds.current.has(c.id));
    if (extraCats.length) setCategories(prev => [...prev, ...extraCats]);

    if (remote.viewStart) setViewStart(remote.viewStart);
    if (remote.viewEnd)   setViewEnd(remote.viewEnd);
    if (remote.nextId)    setNextId(remote.nextId);
    if (remote.note !== undefined) setNote(remote.note);
  }

  // ── Load from Supabase on mount + subscribe to real-time changes ─────────
  useEffect(() => {
    async function loadData() {
      const { data, error } = await supabase
        .from("gantt_data")
        .select("data")
        .eq("id", "main")
        .single();
      if (!error && data?.data) {
        const d = data.data;
        if (d.tasks)      setTasks(d.tasks);
        if (d.categories) setCategories(d.categories);
        if (d.viewStart)  setViewStart(d.viewStart);
        if (d.viewEnd)    setViewEnd(d.viewEnd);
        if (d.nextId)     setNextId(d.nextId);
        if (d.note !== undefined) setNote(d.note);
      }
      setLoaded(true);
    }
    loadData();

    const channel = supabase
      .channel("gantt-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "gantt_data" }, (payload) => {
        if (isSaving.current) return;
        const remote = payload.new?.data;
        if (remote) mergeRemote(remote);
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  // ── Debounced save to Supabase on every change ───────────────────────────
  useEffect(() => {
    if (!loaded) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      isSaving.current = true;
      const ts = new Date().toISOString();

      // Fetch server state and merge before writing — never clobber concurrent additions
      const { data: serverRow } = await supabase
        .from("gantt_data").select("data").eq("id", "main").single();

      const currentTasks = tasksRef.current;
      const currentCats  = categoriesRef.current;
      let finalTasks = currentTasks;
      let finalCats  = currentCats;

      if (serverRow?.data) {
        const serverTaskIds = new Set((serverRow.data.tasks || []).map(t => t.id));
        const serverCatIds  = new Set((serverRow.data.categories || []).map(c => c.id));
        // Their tasks/cats that we don't have locally
        const theirTasks = (serverRow.data.tasks || []).filter(t => !currentTasks.find(x => x.id === t.id) && !deletedTaskIds.current.has(t.id));
        const theirCats  = (serverRow.data.categories || []).filter(c => !currentCats.find(x => x.id === c.id) && !deletedCatIds.current.has(c.id));
        if (theirTasks.length) finalTasks = [...currentTasks, ...theirTasks];
        if (theirCats.length)  finalCats  = [...currentCats,  ...theirCats];
      }

      const { error: upsertError } = await supabase
        .from("gantt_data")
        .upsert({ id: "main", data: { tasks: finalTasks, categories: finalCats, viewStart, viewEnd, nextId, note }, updated_at: ts });

      if (upsertError) console.error("[gantt] save failed:", upsertError);

      if (finalTasks !== currentTasks) setTasks(finalTasks);
      if (finalCats  !== currentCats)  setCategories(finalCats);

      deletedTaskIds.current.clear();
      deletedCatIds.current.clear();
      isSaving.current = false;
    }, 800);
  }, [tasks, categories, viewStart, viewEnd, nextId, note, loaded]);

  const [newTask, setNewTask] = useState({
    name: "", categoryId: DEFAULT_CATEGORIES[0].id,
    start: todayStr(), end: todayPlusMonthStr(),
    status: "on-track", milestone: false, milestoneId: "", description: "",
  });
  const [newCat, setNewCat] = useState({ name: "", colorIdx: 0 });

  const totalDays = daysBetween(viewStart, viewEnd) + 1;

  // ── month header data ──────────────────────────────────────────────────────
  function getMonths() {
    const months = [];
    let cur = new Date(viewStart + "T00:00:00");
    const end = new Date(viewEnd + "T00:00:00");
    while (cur <= end) {
      const mStart = new Date(cur.getFullYear(), cur.getMonth(), 1);
      const mEnd   = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
      const visS = new Date(Math.max(mStart, new Date(viewStart + "T00:00:00")));
      const visE = new Date(Math.min(mEnd, end));
      const days   = Math.round((visE - visS) / 86400000) + 1;
      const offset = Math.round((visS - new Date(viewStart + "T00:00:00")) / 86400000);
      months.push({
        label: cur.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        days, offset,
      });
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
    return months;
  }

  // ── bar geometry (returns percentages 0-100) ───────────────────────────────
  function barGeometry(task) {
    const vs = new Date(viewStart + "T00:00:00");
    const ve = new Date(viewEnd   + "T00:00:00");
    const ts = new Date(task.start + "T00:00:00");
    const te = new Date(task.end   + "T00:00:00");
    const leftDays  = clamp(Math.round((ts - vs) / 86400000), 0, totalDays);
    const rightDays = clamp(Math.round((te - vs) / 86400000), 0, totalDays - 1);
    const widthDays = Math.max(1, rightDays - leftDays + 1);
    return {
      left:  (leftDays  / totalDays) * 100,
      width: (widthDays / totalDays) * 100,
    };
  }

  function getCatColor(categoryId) {
    const cat = categories.find(c => c.id === categoryId);
    return COLORS[(cat?.colorIdx ?? 0) % COLORS.length];
  }

  // ── mutations ──────────────────────────────────────────────────────────────
  function addTask() {
    if (!newTask.name.trim()) return;
    setTasks(t => [...t, { ...newTask, id: nextId }]);
    setNextId(n => n + 1);
    setNewTask({ name: "", categoryId: categories[0]?.id || "", start: todayStr(), end: todayPlusMonthStr(), status: "on-track", milestone: false, milestoneId: "", description: "" });
    setShowAddTask(false);
  }
  function addCategory() {
    if (!newCat.name.trim()) return;
    const id = newCat.name.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
    setCategories(c => [...c, { id, name: newCat.name, colorIdx: newCat.colorIdx }]);
    setNewCat({ name: "", colorIdx: 0 });
    setShowAddCat(false);
  }
  function toggleCatVisibility(id) { setHiddenCats(h => ({ ...h, [id]: !h[id] })); }
  function toggleExpanded(id) { setExpandedTasks(e => ({ ...e, [id]: !e[id] })); }
  function addSubtask(taskId) {
    setTasks(t => t.map(x => x.id === taskId ? {
      ...x,
      subtasks: [...(x.subtasks || []), { id: Date.now(), name: "New subtask", done: false }]
    } : x));
    setExpandedTasks(e => ({ ...e, [taskId]: true }));
  }
  function updateSubtask(taskId, subtaskId, patch) {
    setTasks(t => t.map(x => x.id === taskId ? {
      ...x,
      subtasks: x.subtasks.map(s => s.id === subtaskId ? { ...s, ...patch } : s)
    } : x));
  }
  function deleteSubtask(taskId, subtaskId) {
    setTasks(t => t.map(x => x.id === taskId ? {
      ...x,
      subtasks: (x.subtasks || []).filter(s => s.id !== subtaskId)
    } : x));
  }
  function deleteTask(id) {
    deletedTaskIds.current.add(id);
    setTasks(t => t.filter(x => x.id !== id).map(x => String(x.milestoneId) === String(id) ? { ...x, milestoneId: "" } : x));
  }
  function deleteCategory(id) { deletedCatIds.current.add(id); setCategories(c => c.filter(x => x.id !== id)); setTasks(t => t.filter(x => x.categoryId !== id)); }
  function saveEditTask() {
    setTasks(t => t.map(x => {
      if (x.id === editingTask.id) return editingTask;
      if (!editingTask.milestone && String(x.milestoneId) === String(editingTask.id)) return { ...x, milestoneId: "" };
      return x;
    }));
    setEditingTask(null);
  }
  function saveEditCat()      { setCategories(c => c.map(x => x.id === editingCat.id ? editingCat : x)); setEditingCat(null); }
  function toggleStatus(id)   { setTasks(t => t.map(x => x.id === id ? { ...x, status: x.status === "on-track" ? "delayed" : "on-track" } : x)); }
  function fitView()          { const r = taskRangeView(tasks); setViewStart(r.start); setViewEnd(r.end); }

  // ── today marker ───────────────────────────────────────────────────────────
  const today        = new Date().toISOString().split("T")[0];
  const todayOffset  = daysBetween(viewStart, today);
  const showToday    = todayOffset >= 0 && todayOffset < totalDays;
  const todayLeftPct = showToday ? (todayOffset / totalDays) * 100 : null;

  const months = getMonths();
  const LABEL_W = 260; // px — left label column
  const chartW  = totalDays * pxPerDay; // px — scrollable chart area

  // ── week tick marks ────────────────────────────────────────────────────────
  function getWeekTicks() {
    const ticks = [];
    for (let d = 0; d < totalDays; d += 7) {
      const dateStr = new Date(new Date(viewStart + "T00:00:00").getTime() + d * 86400000)
        .toISOString().split("T")[0];
      ticks.push({ pct: (d / totalDays) * 100, label: formatDate(dateStr) });
    }
    return ticks;
  }

  return (
    <div style={{ fontFamily: "'DM Sans',system-ui,sans-serif", background: "#f9fafb", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        body, #root { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
        input:focus, select:focus, button:focus { outline: 2px solid #059669; outline-offset: 1px; }
        ::-webkit-scrollbar { height: 5px; width: 5px; }
        ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
      `}</style>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "10px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: "#9ca3af", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 2 }}>Project</div>
          <h1 style={{ fontSize: 21, fontWeight: 700, color: "#111827", margin: 0 }}>Telesto Timeline</h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "7px 12px" }}>
            <span style={{ fontSize: 12, color: "#6b7280", fontFamily: "'DM Mono',monospace" }}>View:</span>
            <input type="date" value={viewStart} onChange={e => setViewStart(e.target.value)}
              style={{ border: "none", background: "transparent", fontSize: 13, color: "#374151", fontFamily: "'DM Mono',monospace" }} />
            <span style={{ fontSize: 12, color: "#9ca3af" }}>→</span>
            <input type="date" value={viewEnd} onChange={e => setViewEnd(e.target.value)}
              style={{ border: "none", background: "transparent", fontSize: 13, color: "#374151", fontFamily: "'DM Mono',monospace" }} />
          </div>
          <Btn ghost onClick={fitView}>Fit</Btn>
          <div style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
            <button onClick={() => setPxPerDay(p => Math.max(2, Math.round(p / 1.4)))}
              title="Zoom out"
              style={{ border: "none", borderRight: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: 17, cursor: "pointer", padding: "7px 14px", lineHeight: 1, fontWeight: 600 }}>−</button>
            <span style={{ fontSize: 12, fontFamily: "'DM Mono',monospace", color: "#6b7280", padding: "0 10px", userSelect: "none" }}>{pxPerDay}px/d</span>
            <button onClick={() => setPxPerDay(p => Math.min(60, Math.round(p * 1.4)))}
              title="Zoom in"
              style={{ border: "none", borderLeft: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: 17, cursor: "pointer", padding: "7px 14px", lineHeight: 1, fontWeight: 600 }}>+</button>
          </div>
          <Btn ghost onClick={() => setShowAddCat(true)}>⊕ Category</Btn>
          <Btn primary onClick={() => setShowAddTask(true)}>+ Add Task</Btn>
        </div>
      </div>

      {/* ── Legend bar ───────────────────────────────────────────────────── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #f3f4f6", padding: "6px 28px", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        {categories.map(cat => {
          const color = COLORS[cat.colorIdx % COLORS.length];
          return (
            <span key={cat.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, color: hiddenCats[cat.id] ? "#9ca3af" : "#374151", marginRight: 4 }}>
              <span style={{ width: 12, height: 12, borderRadius: 2, background: hiddenCats[cat.id] ? "#d1d5db" : color.bar, flexShrink: 0 }} />
              {cat.name}
              <button onClick={() => toggleCatVisibility(cat.id)} title={hiddenCats[cat.id] ? "Show" : "Hide"} style={{ ...iconBtn, color: hiddenCats[cat.id] ? "#059669" : "#9ca3af" }}>
                {hiddenCats[cat.id] ? "◉" : "◎"}
              </button>
              <button onClick={() => setEditingCat({ ...cat })} style={iconBtn}>✎</button>
              <button onClick={() => deleteCategory(cat.id)} style={{ ...iconBtn, color: "#d1d5db" }}>✕</button>
            </span>
          );
        })}
        <div style={{ marginLeft: "auto", display: "flex", gap: 14, alignItems: "center" }}>
          {[["#059669","On Track"],["#ef4444","Delayed"]].map(([c,l]) => (
            <span key={l} style={{ display:"flex",alignItems:"center",gap:5,fontSize:12,color:"#6b7280" }}>
              <span style={{ width:12,height:12,borderRadius:2,background:c }} />{l}
            </span>
          ))}
          <span style={{ display:"flex",alignItems:"center",gap:5,fontSize:12,color:"#6b7280" }}>
            <span style={{ width:14,height:14,borderRadius:"50%",background:"#fff",border:"2px solid #059669",display:"inline-block" }} />Milestone
          </span>
        </div>
      </div>

      {/* ── Gantt body ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowX: "auto", overflowY: "auto", padding: "0 24px 20px 0" }}>
        {/* We use a table-like layout: fixed left column + fixed-pixel right area */}
        <div style={{ display: "flex", flexDirection: "column", width: LABEL_W + chartW }}>

          {/* Month header */}
          <div style={{ display: "flex", marginBottom: 0, position: "sticky", top: 0, zIndex: 30, background: "#f9fafb" }}>
            <div style={{ width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 31, background: "#f9fafb" }} />
            <div style={{ width: chartW, flexShrink: 0, display: "flex" }}>
              {months.map((m, i) => (
                <div key={i} style={{
                  width: (m.days / totalDays) * chartW,
                  flexShrink: 0,
                  borderLeft: i > 0 ? "2px solid #e5e7eb" : "none",
                  padding: "3px 10px",
                  fontSize: 12, fontWeight: 700, color: "#374151",
                  background: "#f3f4f6",
                  fontFamily: "'DM Mono',monospace",
                  textTransform: "uppercase", letterSpacing: "0.06em",
                  whiteSpace: "nowrap", overflow: "hidden",
                }}>
                  {m.label}
                </div>
              ))}
            </div>
          </div>

          {/* Week ticks */}
          <div style={{ display: "flex", marginBottom: 8, borderBottom: "2px solid #e5e7eb", position: "sticky", top: 24, zIndex: 30, background: "#f9fafb" }}>
            <div style={{ width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 31, background: "#f9fafb" }} />
            <div style={{ width: chartW, flexShrink: 0, position: "relative", height: 20 }}>
              {getWeekTicks().map((t, i) => (
                <div key={i} style={{
                  position: "absolute", left: `${t.pct}%`,
                  fontSize: 11, color: "#9ca3af", fontFamily: "'DM Mono',monospace",
                  whiteSpace: "nowrap", transform: "translateX(-2px)",
                  bottom: 3,
                }}>
                  {t.label}
                </div>
              ))}
            </div>
          </div>

          {/* Categories + tasks */}
          <div style={{ position: "relative" }}>
          {/* Milestone vertical lines — rendered over all swimlanes */}
          {tasks.filter(t => t.milestone).map(t => {
            const { left } = barGeometry(t);
            const color = getCatColor(t.categoryId);
            return (
              <div key={`ml-${t.id}`} style={{ position: "absolute", left: LABEL_W + (left / 100) * chartW, top: 0, bottom: 0, width: 2, background: color.bar, opacity: 0.5, zIndex: 15, pointerEvents: "none" }}>
                <div style={{ position: "absolute", top: 2, left: 6, fontSize: 11, fontWeight: 700, color: color.bar, whiteSpace: "nowrap", fontFamily: "'DM Mono',monospace", letterSpacing: "0.04em" }}>
                  {t.name}
                </div>
              </div>
            );
          })}
          {categories.filter(cat => !hiddenCats[cat.id]).map(cat => {
            const color    = COLORS[cat.colorIdx % COLORS.length];
            const catTasks = tasks.filter(t => t.categoryId === cat.id).sort((a, b) => a.start.localeCompare(b.start));

            return (
              <div key={cat.id} style={{ display: "flex", marginBottom: 6 }}>

                {/* Tall phase label — spans all task rows */}
                <div style={{ width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 50, background: "#f9fafb", display: "flex", alignItems: "center", justifyContent: "center", padding: "4px 8px" }}>
                  <div style={{
                    width: "100%", borderRadius: 10,
                    background: color.light,
                    border: `1px solid ${color.border}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    minHeight: catTasks.length === 0 ? 40 : catTasks.reduce((sum, t) => {
                      const subRows = expandedTasks[t.id] ? (t.subtasks?.length || 0) : 0;
                      return sum + 44 + subRows * 33;
                    }, 0),
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: color.text, textTransform: "uppercase", letterSpacing: "0.08em", textAlign: "center", wordBreak: "break-word", padding: "0 8px" }}>{cat.name}</span>
                  </div>
                </div>

                {/* Task rows */}
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                {catTasks.length === 0 && (
                  <div style={{ display: "flex", height: 52 }}>
                    <div style={{ width: chartW, flexShrink: 0, display: "flex", alignItems: "center", paddingLeft: 8 }}>
                      <span style={{ fontSize: 13, color: "#d1d5db", fontStyle: "italic" }}>No tasks — click + Add Task</span>
                    </div>
                  </div>
                )}

                {catTasks.map(task => {
                  const { left, width } = barGeometry(task);
                  const delayed = task.status === "delayed";
                  const barBg     = delayed ? "#fee2e2" : color.light;
                  const barBorder = delayed ? "#fca5a5" : color.border;
                  const barText   = delayed ? "#991b1b" : color.text;

                  return (
                    <React.Fragment key={task.id}>
                    <div style={{ display: "flex", alignItems: "center", marginBottom: 4, minHeight: 40 }}
                      onMouseEnter={e => e.currentTarget.querySelector(".task-actions").style.opacity = "1"}
                      onMouseLeave={e => e.currentTarget.querySelector(".task-actions").style.opacity = "0"}>

                      {/* Bar track */}
                      <div style={{ width: chartW, flexShrink: 0, position: "relative", height: 40, zIndex: 11, overflow: "hidden" }}>
                        {/* subtle month dividers */}
                        {months.slice(1).map((m, i) => (
                          <div key={i} style={{ position: "absolute", left: `${(m.offset / totalDays) * 100}%`, top: 0, bottom: 0, width: 1, background: "#f0f0f0", pointerEvents: "none" }} />
                        ))}

                        {/* today line */}
                        {showToday && (
                          <div style={{ position: "absolute", left: `${todayLeftPct}%`, top: 0, bottom: 0, width: 2, background: "#f59e0b", opacity: 0.7, zIndex: 5, pointerEvents: "none" }} />
                        )}

                        {/* Action buttons — just right of the bar */}
                        <div className="task-actions" style={{
                          position: "absolute",
                          left: `calc(${left}% + ${Math.max(width, 0.5)}%)`,
                          top: "50%",
                          transform: "translate(6px, -50%)",
                          display: "flex", gap: 2, alignItems: "center",
                          opacity: 0, transition: "opacity 0.15s",
                          zIndex: 6,
                        }}>
                          <button onClick={() => setEditingTask({ ...task })} title="Edit" style={iconBtn}>✎</button>
                          <button onClick={() => toggleStatus(task.id)} title="Toggle status"
                            style={{ ...iconBtn, background: delayed ? "#fee2e2" : "#d1fae5", color: delayed ? "#991b1b" : "#065f46" }}>
                            {delayed ? "⚠" : "✓"}
                          </button>
                          <button onClick={() => deleteTask(task.id)} title="Delete" style={{ ...iconBtn, color: "#9ca3af" }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                            </svg>
                          </button>
                        </div>

                        {task.milestone ? (
                          /* Milestone diamond on the line */
                          <div title={task.name} onClick={() => setEditingTask({ ...task })} style={{
                            position: "absolute",
                            left: `${left}%`,
                            top: "50%", transform: "translate(-50%,-50%) rotate(45deg)",
                            width: 12, height: 12,
                            background: delayed ? "#ef4444" : color.bar,
                            border: "2px solid #fff",
                            boxShadow: `0 0 0 2px ${delayed ? "#ef4444" : color.bar}`,
                            zIndex: 16, cursor: "pointer",
                          }} />
                        ) : (
                          /* Regular bar */
                          <div style={{
                            position: "absolute",
                            left: `${left}%`,
                            width: `${Math.max(width, 0.5)}%`,
                            top: "50%", transform: "translateY(-50%)",
                            height: 34, borderRadius: 6,
                            background: barBg,
                            border: `1px solid ${barBorder}`,
                            display: "flex", alignItems: "center",
                            padding: "0 6px 0 8px", gap: 5,
                            zIndex: 3, cursor: "pointer",
                            transition: "filter 0.15s",
                            overflow: "hidden",
                            minWidth: 6,
                          }}
                          onMouseEnter={e => e.currentTarget.style.filter = "brightness(0.93)"}
                          onMouseLeave={e => e.currentTarget.style.filter = "none"}
                          onClick={() => toggleExpanded(task.id)}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: delayed ? "#ef4444" : color.bar, flexShrink: 0 }} />
                            <span style={{ fontSize: 13, fontWeight: 500, color: barText, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                              {delayed && "⚠ "}{task.name}
                            </span>
                            {task.milestoneId && (() => {
                              const ms = tasks.find(t => String(t.id) === String(task.milestoneId));
                              const msColor = ms ? getCatColor(ms.categoryId) : null;
                              return ms ? (
                                <span title={`Milestone: ${ms.name}`} style={{ width: 8, height: 8, display: "inline-block", background: msColor.bar, transform: "rotate(45deg)", flexShrink: 0, opacity: 0.85 }} />
                              ) : null;
                            })()}
                            {(task.subtasks?.length > 0) && (
                              <span style={{ fontSize: 10, color: barText, opacity: 0.6, flexShrink: 0 }}>
                                {expandedTasks[task.id] ? "▲" : "▼"} {task.subtasks.length}
                              </span>
                            )}
                            <button
                              onClick={e => { e.stopPropagation(); addSubtask(task.id); }}
                              title="Add subtask"
                              style={{ border: "none", background: "transparent", color: barText, opacity: 0.6, cursor: "pointer", padding: "0 2px", fontSize: 14, lineHeight: 1, flexShrink: 0 }}>
                              +
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Subtask rows */}
                    {expandedTasks[task.id] && (task.subtasks || []).map(sub => (
                      <div key={sub.id} style={{ display: "flex", alignItems: "center", marginBottom: 3, minHeight: 30 }}>
                        <div style={{ width: chartW, flexShrink: 0, position: "relative", height: 30, zIndex: 11, overflow: "hidden" }}>
                          {months.slice(1).map((m, i) => (
                            <div key={i} style={{ position: "absolute", left: `${(m.offset / totalDays) * 100}%`, top: 0, bottom: 0, width: 1, background: "#f0f0f0", pointerEvents: "none" }} />
                          ))}
                          <div style={{
                            position: "absolute",
                            left: `${left}%`,
                            width: `${Math.max(width, 0.5)}%`,
                            top: "50%", transform: "translateY(-50%)",
                            height: 24, borderRadius: 4,
                            background: sub.done ? "#f3f4f6" : color.light,
                            border: `1px dashed ${sub.done ? "#d1d5db" : color.border}`,
                            display: "flex", alignItems: "center",
                            padding: "0 8px", gap: 6,
                            overflow: "hidden",
                          }}>
                            <input type="checkbox" checked={sub.done} onChange={e => updateSubtask(task.id, sub.id, { done: e.target.checked })}
                              style={{ flexShrink: 0, cursor: "pointer", accentColor: color.bar }} />
                            <span
                              contentEditable
                              suppressContentEditableWarning
                              onBlur={e => updateSubtask(task.id, sub.id, { name: e.currentTarget.textContent })}
                              style={{ fontSize: 12, color: sub.done ? "#9ca3af" : color.text, textDecoration: sub.done ? "line-through" : "none", flex: 1, outline: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "text" }}>
                              {sub.name}
                            </span>
                            <button onClick={() => deleteSubtask(task.id, sub.id)}
                              style={{ border: "none", background: "transparent", color: "#d1d5db", cursor: "pointer", padding: 0, fontSize: 11, lineHeight: 1, flexShrink: 0 }}>✕</button>
                          </div>
                        </div>
                      </div>
                    ))}
                    </React.Fragment>
                  );
                })}
                </div>
              </div>
            );
          })}

          </div>{/* end milestone wrapper */}

          {/* Today label */}
          {showToday && (
            <div style={{ display: "flex", marginTop: 4 }}>
              <div style={{ width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 50, background: "#f9fafb" }} />
              <div style={{ width: chartW, flexShrink: 0, position: "relative", height: 22 }}>
                <div style={{ position: "absolute", left: `${todayLeftPct}%`, transform: "translateX(-50%)", fontSize: 12, color: "#f59e0b", fontFamily: "'DM Mono',monospace", fontWeight: 600, whiteSpace: "nowrap" }}>
                  ▲ Today
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Contingency note */}
        <div style={{ margin: "16px 0 8px", padding: "14px 18px", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, width: LABEL_W + chartW }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>⚠ Note</div>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            style={{ width: "100%", border: "none", background: "transparent", resize: "vertical", fontSize: 14, color: "#78350f", lineHeight: 1.6, fontFamily: "inherit", outline: "none", padding: 0 }}
          />
        </div>
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {showAddTask && (
        <Modal title="Add Task" onClose={() => setShowAddTask(false)} onSave={addTask} saveLabel="Add Task">
          <Field label="Task Name">
            <input value={newTask.name} onChange={e => setNewTask(t => ({ ...t, name: e.target.value }))} placeholder="e.g. Task name" style={inputSt} />
          </Field>
          <Field label="Category">
            <select value={newTask.categoryId} onChange={e => setNewTask(t => ({ ...t, categoryId: e.target.value }))} style={inputSt}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <MilestoneCheck value={newTask.milestone} onChange={v => setNewTask(t => ({ ...t, milestone: v, end: v ? t.start : t.end }))} />
          <Field label="Associated Milestone">
            <select value={newTask.milestoneId || ""} onChange={e => setNewTask(t => ({ ...t, milestoneId: e.target.value }))} style={inputSt}>
              <option value="">— None —</option>
              {tasks.filter(t => t.milestone).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Start Date"><input type="date" value={newTask.start} onChange={e => setNewTask(t => ({ ...t, start: e.target.value, end: t.milestone ? e.target.value : t.end }))} style={inputSt} /></Field>
            <Field label="End Date"><input type="date" value={newTask.end} disabled={newTask.milestone} onChange={e => setNewTask(t => ({ ...t, end: e.target.value }))} style={{ ...inputSt, opacity: newTask.milestone ? 0.4 : 1, cursor: newTask.milestone ? "not-allowed" : "auto" }} /></Field>
          </div>
          <StatusToggle value={newTask.status} onChange={s => setNewTask(t => ({ ...t, status: s }))} />
          <Field label="Description">
            <textarea value={newTask.description} onChange={e => setNewTask(t => ({ ...t, description: e.target.value }))} rows={3} placeholder="Optional notes or details..." style={{ ...inputSt, resize: "vertical" }} />
          </Field>
        </Modal>
      )}

      {editingTask && (
        <Modal title="Edit Task" onClose={() => setEditingTask(null)} onSave={saveEditTask} saveLabel="Save">
          <Field label="Task Name">
            <input value={editingTask.name} onChange={e => setEditingTask(t => ({ ...t, name: e.target.value }))} style={inputSt} />
          </Field>
          <Field label="Category">
            <select value={editingTask.categoryId} onChange={e => setEditingTask(t => ({ ...t, categoryId: e.target.value }))} style={inputSt}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <MilestoneCheck value={editingTask.milestone} onChange={v => setEditingTask(t => ({ ...t, milestone: v, end: v ? t.start : t.end }))} />
          <Field label="Associated Milestone">
            <select value={editingTask.milestoneId || ""} onChange={e => setEditingTask(t => ({ ...t, milestoneId: e.target.value }))} style={inputSt}>
              <option value="">— None —</option>
              {tasks.filter(t => t.milestone && t.id !== editingTask.id).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Start Date"><input type="date" value={editingTask.start} onChange={e => setEditingTask(t => ({ ...t, start: e.target.value, end: t.milestone ? e.target.value : t.end }))} style={inputSt} /></Field>
            <Field label="End Date"><input type="date" value={editingTask.end} disabled={editingTask.milestone} onChange={e => setEditingTask(t => ({ ...t, end: e.target.value }))} style={{ ...inputSt, opacity: editingTask.milestone ? 0.4 : 1, cursor: editingTask.milestone ? "not-allowed" : "auto" }} /></Field>
          </div>
          <StatusToggle value={editingTask.status} onChange={s => setEditingTask(t => ({ ...t, status: s }))} />
          <Field label="Description">
            <textarea value={editingTask.description || ""} onChange={e => setEditingTask(t => ({ ...t, description: e.target.value }))} rows={3} placeholder="Optional notes or details..." style={{ ...inputSt, resize: "vertical" }} />
          </Field>
        </Modal>
      )}

      {showAddCat && (
        <Modal title="Add Category" onClose={() => setShowAddCat(false)} onSave={addCategory} saveLabel="Add Category">
          <Field label="Category Name">
            <input value={newCat.name} onChange={e => setNewCat(c => ({ ...c, name: e.target.value }))} placeholder="e.g. Phase D" style={inputSt} />
          </Field>
          <ColorPicker value={newCat.colorIdx} onChange={i => setNewCat(c => ({ ...c, colorIdx: i }))} />
        </Modal>
      )}

      {editingCat && (
        <Modal title="Edit Category" onClose={() => setEditingCat(null)} onSave={saveEditCat} saveLabel="Save">
          <Field label="Category Name">
            <input value={editingCat.name} onChange={e => setEditingCat(c => ({ ...c, name: e.target.value }))} style={inputSt} />
          </Field>
          <ColorPicker value={editingCat.colorIdx} onChange={i => setEditingCat(c => ({ ...c, colorIdx: i }))} />
        </Modal>
      )}
    </div>
  );
}

// ── Shared sub-components ──────────────────────────────────────────────────

function Modal({ title, children, onClose, onSave, saveLabel }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 500, boxShadow: "0 24px 60px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 40px)" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "#111827" }}>{title}</h2>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: "#9ca3af", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>{children}</div>
        <div style={{ padding: "16px 24px", borderTop: "1px solid #f3f4f6", display: "flex", justifyContent: "flex-end", gap: 8, flexShrink: 0 }}>
          <Btn ghost onClick={onClose}>Cancel</Btn>
          <Btn primary onClick={onSave}>{saveLabel}</Btn>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {label && <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</label>}
      {children}
    </div>
  );
}

function StatusToggle({ value, onChange }) {
  return (
    <Field label="Status">
      <div style={{ display: "flex", gap: 8 }}>
        {[["on-track", "✓ On Track", "#d1fae5", "#065f46", "#6ee7b7"], ["delayed", "⚠ Delayed", "#fee2e2", "#991b1b", "#fca5a5"]].map(([s, label, bg, col, border]) => (
          <button key={s} onClick={() => onChange(s)}
            style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${value === s ? border : "#e5e7eb"}`, background: value === s ? bg : "#f9fafb", color: value === s ? col : "#6b7280", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>
            {label}
          </button>
        ))}
      </div>
    </Field>
  );
}

function MilestoneCheck({ value, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 15, color: "#374151" }}>
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
      Mark as Milestone
    </label>
  );
}

function ColorPicker({ value, onChange }) {
  return (
    <Field label="Color">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {COLORS.map((c, i) => (
          <button key={i} onClick={() => onChange(i)} title={c.name}
            style={{ width: 32, height: 32, borderRadius: 6, background: c.bar, border: value === i ? "2px solid #111827" : "2px solid transparent", cursor: "pointer" }} />
        ))}
      </div>
    </Field>
  );
}

function Btn({ primary, ghost, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
      border: primary ? "none" : "1px solid #e5e7eb",
      background: primary ? "#059669" : "#fff",
      color: primary ? "#fff" : "#374151",
    }}>
      {children}
    </button>
  );
}

const inputSt = {
  width: "100%", padding: "10px 12px",
  border: "1px solid #e5e7eb", borderRadius: 8,
  fontSize: 14, color: "#111827", background: "#fafafa",
  fontFamily: "inherit",
};

const iconBtn = {
  border: "none", background: "#f3f4f6", borderRadius: 4,
  cursor: "pointer", padding: "4px 6px", fontSize: 13, color: "#6b7280",
  lineHeight: 1,
};