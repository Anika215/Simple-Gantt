import { useState, useRef, useEffect } from "react";
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
  const [loaded, setLoaded] = useState(false);
  const [pxPerDay, setPxPerDay] = useState(8);
  const skipNextSave = useRef(false);
  const saveTimer = useRef(null);

  // ── Load from Supabase on mount + subscribe to real-time changes ─────────
  useEffect(() => {
    async function loadData() {
      const { data, error } = await supabase
        .from("gantt_data")
        .select("data")
        .eq("id", "main")
        .single();
      if (!error && data?.data) {
        applyRemoteData(data.data);
      }
      setLoaded(true);
    }
    loadData();

    const channel = supabase
      .channel("gantt-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "gantt_data" }, (payload) => {
        if (skipNextSave.current) return;
        const remote = payload.new?.data;
        if (remote) applyRemoteData(remote);
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  function applyRemoteData(d) {
    if (d.tasks)      setTasks(d.tasks);
    if (d.categories) setCategories(d.categories);
    if (d.viewStart)  setViewStart(d.viewStart);
    if (d.viewEnd)    setViewEnd(d.viewEnd);
    if (d.nextId)     setNextId(d.nextId);
  }

  // ── Debounced save to Supabase on every change ───────────────────────────
  useEffect(() => {
    if (!loaded) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      skipNextSave.current = true;
      await supabase
        .from("gantt_data")
        .upsert({ id: "main", data: { tasks, categories, viewStart, viewEnd, nextId }, updated_at: new Date().toISOString() });
      skipNextSave.current = false;
    }, 800);
  }, [tasks, categories, viewStart, viewEnd, nextId, loaded]);

  const [newTask, setNewTask] = useState({
    name: "", categoryId: DEFAULT_CATEGORIES[0].id,
    start: todayStr(), end: todayPlusMonthStr(),
    status: "on-track", milestone: false,
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
    setNewTask({ name: "", categoryId: categories[0]?.id || "", start: todayStr(), end: todayPlusMonthStr(), status: "on-track", milestone: false });
    setShowAddTask(false);
  }
  function addCategory() {
    if (!newCat.name.trim()) return;
    const id = newCat.name.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
    setCategories(c => [...c, { id, name: newCat.name, colorIdx: newCat.colorIdx }]);
    setNewCat({ name: "", colorIdx: 0 });
    setShowAddCat(false);
  }
  function deleteTask(id)     { setTasks(t => t.filter(x => x.id !== id)); }
  function deleteCategory(id) { setCategories(c => c.filter(x => x.id !== id)); setTasks(t => t.filter(x => x.categoryId !== id)); }
  function saveEditTask()     { setTasks(t => t.map(x => x.id === editingTask.id ? editingTask : x)); setEditingTask(null); }
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
    <div style={{ fontFamily: "'DM Sans',system-ui,sans-serif", background: "#f9fafb", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        body, #root { margin: 0; padding: 0; width: 100%; }
        input:focus, select:focus, button:focus { outline: 2px solid #059669; outline-offset: 1px; }
        ::-webkit-scrollbar { height: 5px; width: 5px; }
        ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
      `}</style>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "10px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: "#9ca3af", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 2 }}>Project</div>
          <h1 style={{ fontSize: 21, fontWeight: 700, color: "#111827", margin: 0 }}>Project Timeline</h1>
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
            <span key={cat.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, color: "#374151", marginRight: 4 }}>
              <span style={{ width: 12, height: 12, borderRadius: 2, background: color.bar, flexShrink: 0 }} />
              {cat.name}
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
      <div style={{ flex: 1, overflowX: "auto", overflowY: "auto", padding: "12px 24px 20px" }}>
        {/* We use a table-like layout: fixed left column + fixed-pixel right area */}
        <div style={{ display: "flex", flexDirection: "column", width: LABEL_W + chartW }}>

          {/* Month header */}
          <div style={{ display: "flex", marginBottom: 0 }}>
            <div style={{ width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 20, background: "#f9fafb" }} />
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
          <div style={{ display: "flex", marginBottom: 8, borderBottom: "2px solid #e5e7eb" }}>
            <div style={{ width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 20, background: "#f9fafb" }} />
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
          {categories.map(cat => {
            const color    = COLORS[cat.colorIdx % COLORS.length];
            const catTasks = tasks.filter(t => t.categoryId === cat.id);

            return (
              <div key={cat.id} style={{ display: "flex", marginBottom: 6 }}>

                {/* Tall phase label — spans all task rows */}
                <div style={{ width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 20, background: "#f9fafb", display: "flex", alignItems: "center", justifyContent: "center", padding: "4px 8px" }}>
                  <div style={{
                    width: "100%", borderRadius: 10,
                    background: color.light,
                    border: `1px solid ${color.border}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    minHeight: catTasks.length === 0 ? 40 : catTasks.length * 46,
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
                    <div key={task.id} style={{ display: "flex", alignItems: "center", marginBottom: 4, minHeight: 40 }}
                      onMouseEnter={e => e.currentTarget.querySelector(".task-actions").style.opacity = "1"}
                      onMouseLeave={e => e.currentTarget.querySelector(".task-actions").style.opacity = "0"}>

                      {/* Bar track */}
                      <div style={{ width: chartW, flexShrink: 0, position: "relative", height: 40, zIndex: 11 }}>
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
                          /* Milestone dot */
                          <div title={task.name} style={{
                            position: "absolute",
                            left: `${left}%`,
                            top: "50%", transform: "translate(-50%,-50%)",
                            width: 20, height: 20, borderRadius: "50%",
                            background: delayed ? "#ef4444" : color.bar,
                            border: "2px solid #fff",
                            boxShadow: `0 0 0 2px ${delayed ? "#ef4444" : color.bar}`,
                            zIndex: 3, cursor: "pointer",
                          }} onClick={() => setEditingTask({ ...task })} />
                        ) : (
                          /* Regular bar */
                          <div onClick={() => setEditingTask({ ...task })} style={{
                            position: "absolute",
                            left: `${left}%`,
                            width: `${Math.max(width, 0.5)}%`,
                            top: "50%", transform: "translateY(-50%)",
                            height: 34, borderRadius: 6,
                            background: barBg,
                            border: `1px solid ${barBorder}`,
                            display: "flex", alignItems: "center",
                            padding: "0 8px", gap: 5,
                            zIndex: 3, cursor: "pointer",
                            transition: "filter 0.15s",
                            overflow: "hidden",
                            minWidth: 6,
                          }}
                          onMouseEnter={e => e.currentTarget.style.filter = "brightness(0.93)"}
                          onMouseLeave={e => e.currentTarget.style.filter = "none"}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: delayed ? "#ef4444" : color.bar, flexShrink: 0 }} />
                            <span style={{ fontSize: 13, fontWeight: 500, color: barText, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {delayed && "⚠ "}{task.name}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>
            );
          })}

          {/* Today label */}
          {showToday && (
            <div style={{ display: "flex", marginTop: 4 }}>
              <div style={{ width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 20, background: "#f9fafb" }} />
              <div style={{ width: chartW, flexShrink: 0, position: "relative", height: 22 }}>
                <div style={{ position: "absolute", left: `${todayLeftPct}%`, transform: "translateX(-50%)", fontSize: 12, color: "#f59e0b", fontFamily: "'DM Mono',monospace", fontWeight: 600, whiteSpace: "nowrap" }}>
                  ▲ Today
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Contingency note */}
      <div style={{ margin: "0 28px 28px", padding: "14px 18px", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, fontSize: 14, color: "#78350f", lineHeight: 1.6 }}>
        <strong>⚠ Note:</strong> Add any important notes or contingency plans here.
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Start Date"><input type="date" value={newTask.start} onChange={e => setNewTask(t => ({ ...t, start: e.target.value }))} style={inputSt} /></Field>
            <Field label="End Date"><input type="date" value={newTask.end} onChange={e => setNewTask(t => ({ ...t, end: e.target.value }))} style={inputSt} /></Field>
          </div>
          <StatusToggle value={newTask.status} onChange={s => setNewTask(t => ({ ...t, status: s }))} />
          <MilestoneCheck value={newTask.milestone} onChange={v => setNewTask(t => ({ ...t, milestone: v }))} />
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Start Date"><input type="date" value={editingTask.start} onChange={e => setEditingTask(t => ({ ...t, start: e.target.value }))} style={inputSt} /></Field>
            <Field label="End Date"><input type="date" value={editingTask.end} onChange={e => setEditingTask(t => ({ ...t, end: e.target.value }))} style={inputSt} /></Field>
          </div>
          <StatusToggle value={editingTask.status} onChange={s => setEditingTask(t => ({ ...t, status: s }))} />
          <MilestoneCheck value={editingTask.milestone} onChange={v => setEditingTask(t => ({ ...t, milestone: v }))} />
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
      <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 500, boxShadow: "0 24px 60px rgba(0,0,0,0.18)" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "#111827" }}>{title}</h2>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 20, cursor: "pointer", color: "#9ca3af", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>
        <div style={{ padding: "16px 24px", borderTop: "1px solid #f3f4f6", display: "flex", justifyContent: "flex-end", gap: 8 }}>
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