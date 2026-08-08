// src/App.jsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Plus, X, Trash2, Search, Calendar, Clipboard, RotateCcw,
  Settings2, ChevronDown, ChevronLeft, ChevronRight, Cloud,
  CloudOff, Loader2, Lock
} from "lucide-react";
import { db } from "./firebase.js";
import {
  doc, onSnapshot, setDoc, getDoc
} from "firebase/firestore";
import { encrypt, decrypt, hashPin } from "./crypto.js";
import LockScreen from "./components/LockScreen.jsx";

// ─────────── constants ───────────
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAYS_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const ROW_H = 56;
const FIRESTORE_DOC = "timetable-db85b/main";
const SESSION_KEY = "tt-unlocked";
const CORRECT_HASH = hashPin("2310"); // pre-hashed; pin never stored plaintext

const PALETTE = [
  { name: "Teal",       hex: "#4FA8A0" },
  { name: "Coral",      hex: "#E4674F" },
  { name: "Sage",       hex: "#7FA37A" },
  { name: "Periwinkle", hex: "#8686D8" },
  { name: "Rose",       hex: "#C97B9A" },
  { name: "Ochre",      hex: "#D9A441" },
  { name: "Slate",      hex: "#7C8FA6" },
  { name: "Plum",       hex: "#9B6BA6" },
];

const DEFAULT_CATEGORIES = [
  { id: "work",     name: "Work",     color: "#4FA8A0" },
  { id: "study",    name: "Study",    color: "#8686D8" },
  { id: "health",   name: "Health",   color: "#7FA37A" },
  { id: "personal", name: "Personal", color: "#E4674F" },
  { id: "social",   name: "Social",   color: "#C97B9A" },
  { id: "other",    name: "Other",    color: "#D9A441" },
];

const DEFAULT_STATE = {
  blocks: [],
  categories: DEFAULT_CATEGORIES,
  rangeStart: 6,
  rangeEnd: 22,
  showWeekend: true,
};

// ─────────── helpers ───────────
function pad2(n) { return n.toString().padStart(2, "0"); }
function fmtHour(h) { const hh = ((h % 24) + 24) % 24; return `${pad2(hh)}:00`; }
function uid() { return Math.random().toString(36).slice(2, 10); }
function todayIndex() { return (new Date().getDay() + 6) % 7; }
function isMobile() { return window.innerWidth <= 768; }

function layoutDay(dayBlocks) {
  const sorted = [...dayBlocks].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const clusters = []; let current = []; let clusterEnd = -Infinity;
  for (const b of sorted) {
    if (current.length === 0 || b.start < clusterEnd) { current.push(b); clusterEnd = Math.max(clusterEnd, b.end); }
    else { clusters.push(current); current = [b]; clusterEnd = b.end; }
  }
  if (current.length) clusters.push(current);
  const result = {};
  for (const cluster of clusters) {
    const colEnds = []; const assigned = [];
    for (const b of cluster) {
      let col = colEnds.findIndex((end) => end <= b.start);
      if (col === -1) { col = colEnds.length; colEnds.push(b.end); } else { colEnds[col] = b.end; }
      assigned.push({ b, col });
    }
    const totalCols = colEnds.length;
    for (const { b, col } of assigned) result[b.id] = { col, totalCols };
  }
  return result;
}

// ─────────── component ───────────
export default function App() {
  // Lock state
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(SESSION_KEY) === "1");
  const [lockError, setLockError] = useState(false);
  const [pin, setPin] = useState(null); // AES key (the raw pin string)

  // App state
  const [appData, setAppData] = useState(DEFAULT_STATE);
  const { blocks, categories, rangeStart, rangeEnd, showWeekend } = appData;

  // UI state
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [showCategoryPanel, setShowCategoryPanel] = useState(false);
  const [toast, setToast] = useState(null);
  const [now, setNow] = useState(new Date());
  const [pendingDelete, setPendingDelete] = useState(null);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | syncing | synced | error
  const [mobile, setMobile] = useState(isMobile);
  const [mobileDay, setMobileDay] = useState(todayIndex);
  const [openColorPicker, setOpenColorPicker] = useState(null); // category id

  // Drag state
  const creatingRef = useRef(null);
  const [creatingPreview, setCreatingPreview] = useState(null);
  const draggingRef = useRef(null);
  const [, forceTick] = useState(0);

  // Refs
  const toastTimer = useRef(null);
  const saveTimer = useRef(null);
  const unsubRef = useRef(null);
  const pinRef = useRef(null); // keep pin accessible in Firestore callbacks

  // ── resize listener ──
  useEffect(() => {
    const onResize = () => setMobile(isMobile());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── clock ──
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // ── unlock ──
  const handleUnlock = useCallback((enteredPin) => {
    if (hashPin(enteredPin) === CORRECT_HASH) {
      setUnlocked(true);
      setLockError(false);
      setPin(enteredPin);
      pinRef.current = enteredPin;
      sessionStorage.setItem(SESSION_KEY, "1");
    } else {
      setLockError(true);
      setTimeout(() => setLockError(false), 2000);
    }
  }, []);

  // ── Firestore listener (after unlock) ──
  useEffect(() => {
    if (!unlocked || !pin) return;
    const [col, docId] = FIRESTORE_DOC.split("/");
    const ref = doc(db, col, docId);

    setSyncStatus("syncing");
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const raw = snap.data();
        if (raw.payload) {
          const decrypted = decrypt(raw.payload, pin);
          if (decrypted) {
            setAppData((prev) => ({ ...DEFAULT_STATE, ...decrypted }));
          }
        }
      }
      setSyncStatus("synced");
    }, (err) => {
      console.error(err);
      setSyncStatus("error");
    });

    unsubRef.current = unsub;
    return () => unsub();
  }, [unlocked, pin]);

  // ── Save to Firestore (debounced) ──
  const saveToFirestore = useCallback((data) => {
    if (!pinRef.current) return;
    clearTimeout(saveTimer.current);
    setSyncStatus("syncing");
    saveTimer.current = setTimeout(async () => {
      try {
        const [col, docId] = FIRESTORE_DOC.split("/");
        const ref = doc(db, col, docId);
        const payload = encrypt(data, pinRef.current);
        await setDoc(ref, { payload, updatedAt: Date.now() });
        setSyncStatus("synced");
      } catch (e) {
        console.error(e);
        setSyncStatus("error");
        showToast("⚠️ Sync failed — check your connection");
      }
    }, 600);
  }, []);

  // ── Patch helper ──
  const patchData = useCallback((patch) => {
    setAppData((prev) => {
      const next = { ...prev, ...patch };
      saveToFirestore(next);
      return next;
    });
  }, [saveToFirestore]);

  // ── Toast ──
  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  // ── Drag to create ──
  const onCellMouseDown = (day, hour, e) => {
    if (e.button !== 0) return;
    creatingRef.current = { day, anchor: hour };
    setCreatingPreview({ day, start: hour, end: hour + 1 });
  };

  const onCellMouseEnter = (day, hour) => {
    if (creatingRef.current && creatingRef.current.day === day) {
      const anchor = creatingRef.current.anchor;
      setCreatingPreview({ day, start: Math.min(anchor, hour), end: Math.max(anchor, hour) + 1 });
    }
    if (draggingRef.current && draggingRef.current.mode === "move") {
      const { id, grabOffset, duration } = draggingRef.current;
      let newStart = hour - grabOffset;
      newStart = Math.max(rangeStart, Math.min(newStart, rangeEnd - duration));
      patchData({ blocks: blocks.map((b) => b.id === id ? { ...b, day, start: newStart, end: newStart + duration } : b) });
    }
    if (draggingRef.current && draggingRef.current.mode === "resize") {
      const { id, day: bDay, start } = draggingRef.current;
      if (day !== bDay) return;
      const newEnd = Math.max(start + 1, Math.min(hour + 1, rangeEnd));
      patchData({ blocks: blocks.map((b) => b.id === id ? { ...b, end: newEnd } : b) });
    }
  };

  useEffect(() => {
    const onUp = () => {
      if (creatingRef.current && creatingPreview) {
        const draft = {
          id: uid(), day: creatingPreview.day, start: creatingPreview.start, end: creatingPreview.end,
          title: "", categoryId: categories[0]?.id || "other", notes: "", isNew: true,
        };
        setEditing(draft);
      }
      creatingRef.current = null;
      setCreatingPreview(null);
      draggingRef.current = null;
      forceTick((x) => x + 1);
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [creatingPreview, categories]);

  const startMoveBlock = (block, e) => {
    e.stopPropagation();
    draggingRef.current = { id: block.id, mode: "move", grabOffset: 0, duration: block.end - block.start };
  };
  const startResizeBlock = (block, e) => {
    e.stopPropagation();
    draggingRef.current = { id: block.id, mode: "resize", day: block.day, start: block.start };
  };

  // ── Editing ──
  const openExisting = (block, e) => { e.stopPropagation(); setEditing({ ...block, isNew: false }); };

  const saveEditing = () => {
    if (!editing.title.trim()) { showToast("Give the block a title first"); return; }
    const saved = { ...editing, title: editing.title.trim() };
    delete saved.isNew;
    if (editing.isNew) {
      patchData({ blocks: [...blocks, saved] });
    } else {
      patchData({ blocks: blocks.map((b) => b.id === editing.id ? saved : b) });
    }
    setEditing(null);
  };

  const deleteEditing = () => {
    if (!editing.isNew) {
      const removed = blocks.find((b) => b.id === editing.id);
      patchData({ blocks: blocks.filter((b) => b.id !== editing.id) });
      setPendingDelete(removed);
      showToast("Block deleted — undo?");
    }
    setEditing(null);
  };

  const undoDelete = () => {
    if (pendingDelete) {
      patchData({ blocks: [...blocks, pendingDelete] });
      setPendingDelete(null);
      setToast(null);
    }
  };

  // ── Categories ──
  const addCategory = () => {
    const used = new Set(categories.map((c) => c.color));
    const color = PALETTE.find((p) => !used.has(p.hex))?.hex || PALETTE[categories.length % PALETTE.length].hex;
    patchData({ categories: [...categories, { id: uid(), name: "New category", color }] });
  };
  const updateCategory = (id, patch) => {
    patchData({ categories: categories.map((c) => c.id === id ? { ...c, ...patch } : c) });
  };
  const removeCategory = (id) => {
    if (categories.length <= 1) return;
    const fallback = categories.find((c) => c.id !== id)?.id;
    patchData({
      categories: categories.filter((c) => c.id !== id),
      blocks: blocks.map((b) => b.categoryId === id ? { ...b, categoryId: fallback } : b),
    });
  };

  // ── Stats ──
  const stats = useMemo(() => {
    const byCategory = {}; let total = 0;
    for (const b of blocks) { const dur = b.end - b.start; total += dur; byCategory[b.categoryId] = (byCategory[b.categoryId] || 0) + dur; }
    const rows = categories.map((c) => ({ ...c, hours: byCategory[c.id] || 0 })).filter((c) => c.hours > 0).sort((a, b) => b.hours - a.hours);
    return { total, rows, maxHours: rows[0]?.hours || 1 };
  }, [blocks, categories]);

  // ── Export ──
  const exportSummary = async () => {
    const lines = [];
    const vdays = showWeekend ? [0,1,2,3,4,5,6] : [0,1,2,3,4];
    vdays.forEach((d) => {
      const dayBlocks = blocks.filter((b) => b.day === d).sort((a, b) => a.start - b.start);
      if (!dayBlocks.length) return;
      lines.push(DAYS_FULL[d]);
      dayBlocks.forEach((b) => {
        const cat = categories.find((c) => c.id === b.categoryId);
        lines.push(`  ${fmtHour(b.start)}–${fmtHour(b.end)}  ${b.title}${cat ? ` (${cat.name})` : ""}`);
        if (b.notes) lines.push(`    ↳ ${b.notes}`);
      });
    });
    const text = lines.length ? lines.join("\n") : "No blocks scheduled yet.";
    try { await navigator.clipboard.writeText(text); showToast("📋 Week summary copied!"); }
    catch { showToast("Couldn't access clipboard"); }
  };

  const clearWeek = () => {
    if (confirm("Clear every block? This can't be undone.")) {
      patchData({ blocks: [] });
      showToast("Timetable cleared");
    }
  };

  // ── Derived ──
  const visibleDays = showWeekend ? [0,1,2,3,4,5,6] : [0,1,2,3,4];
  const hours = useMemo(() => { const a = []; for (let h = rangeStart; h < rangeEnd; h++) a.push(h); return a; }, [rangeStart, rangeEnd]);
  const categoryOf = (id) => categories.find((c) => c.id === id);
  const nowHourFrac = now.getHours() + now.getMinutes() / 60;
  const todayIdx = todayIndex();
  const showNowLine = visibleDays.includes(todayIdx) && nowHourFrac >= rangeStart && nowHourFrac <= rangeEnd;
  const searchActive = search.trim().length > 0;
  const matches = (b) => b.title.toLowerCase().includes(search.trim().toLowerCase());

  // ── Lock screen ──
  if (!unlocked) {
    return <LockScreen onUnlock={handleUnlock} error={lockError} />;
  }

  // ── Grid column (shared between desktop & mobile) ──
  const renderDayCol = (d) => {
    const dayBlocks = blocks.filter((b) => b.day === d);
    const layout = layoutDay(dayBlocks);
    const isToday = d === todayIdx;

    return (
      <div
        key={d}
        className="day-col"
        style={{
          height: hours.length * ROW_H,
          background: isToday
            ? "rgba(217,164,65,0.04)"
            : `repeating-linear-gradient(to bottom, transparent 0, transparent ${ROW_H - 1}px, var(--line) ${ROW_H - 1}px, var(--line) ${ROW_H}px)`,
        }}
      >
        {/* Hit targets */}
        {hours.map((h) => (
          <div
            key={h}
            className={mobile ? "tt-cell-touch" : "tt-cell"}
            onMouseDown={mobile ? undefined : (e) => onCellMouseDown(d, h, e)}
            onMouseEnter={mobile ? undefined : () => onCellMouseEnter(d, h)}
            onDoubleClick={() => {
              setEditing({ id: uid(), day: d, start: h, end: h + 1, title: "", categoryId: categories[0]?.id || "other", notes: "", isNew: true });
            }}
            style={{ position: "absolute", top: (h - rangeStart) * ROW_H, left: 0, right: 0, height: ROW_H }}
            title={mobile ? "Double-tap to add" : "Drag or double-click to add"}
          />
        ))}

        {/* Create preview */}
        {creatingPreview && creatingPreview.day === d && (
          <div
            className="tt-fade-in"
            style={{
              position: "absolute",
              top: (creatingPreview.start - rangeStart) * ROW_H,
              height: (creatingPreview.end - creatingPreview.start) * ROW_H,
              left: 3, right: 3,
              background: "var(--brass-dim)",
              border: "1.5px dashed var(--brass)",
              borderRadius: 6,
              pointerEvents: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--paper)",
            }}
          >
            {creatingPreview.end - creatingPreview.start}h
          </div>
        )}

        {/* Now line */}
        {showNowLine && isToday && (
          <div style={{ position: "absolute", top: (nowHourFrac - rangeStart) * ROW_H, left: 0, right: 0, height: 0, borderTop: "1.5px dashed var(--brass)", zIndex: 15 }}>
            <div style={{ width: 7, height: 7, borderRadius: 999, background: "var(--brass)", position: "absolute", left: -3.5, top: -4 }} />
          </div>
        )}

        {/* Blocks */}
        {dayBlocks.map((b) => {
          const cat = categoryOf(b.categoryId);
          const { col, totalCols } = layout[b.id] || { col: 0, totalCols: 1 };
          const widthPct = 100 / totalCols;
          const dim = searchActive && !matches(b);
          const blockH = (b.end - b.start) * ROW_H - 4;
          return (
            <div
              key={b.id}
              className="tt-block tt-fade-in"
              onMouseDown={(e) => startMoveBlock(b, e)}
              onClick={(e) => openExisting(b, e)}
              style={{
                position: "absolute",
                top: (b.start - rangeStart) * ROW_H + 2,
                height: blockH,
                left: `calc(${col * widthPct}% + 3px)`,
                width: `calc(${widthPct}% - 6px)`,
                background: cat ? `${cat.color}26` : "rgba(146,186,212,0.15)",
                borderLeft: `3px solid ${cat ? cat.color : "var(--muted)"}`,
                borderRadius: 6,
                padding: "5px 7px",
                cursor: "grab",
                overflow: "hidden",
                opacity: dim ? 0.2 : 1,
                zIndex: 10,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.2, color: "var(--paper)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {b.title || "Untitled"}
              </div>
              <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--muted)", marginTop: 2 }}>
                {fmtHour(b.start)}–{fmtHour(b.end)}
              </div>
              {blockH > 48 && b.notes && (
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {b.notes}
                </div>
              )}
              <div onMouseDown={(e) => startResizeBlock(b, e)} style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 8, cursor: "ns-resize" }} />
            </div>
          );
        })}
      </div>
    );
  };

  // ── Sync indicator ──
  const SyncIndicator = () => (
    <div className="sync-indicator">
      {syncStatus === "syncing" && <><div className="sync-dot syncing" /><span style={{ color: "var(--muted)" }}>Syncing…</span></>}
      {syncStatus === "synced"  && <><div className="sync-dot synced" /><span style={{ color: "var(--muted)" }}>Synced</span></>}
      {syncStatus === "error"   && <><div className="sync-dot error" /><span style={{ color: "var(--red)" }}>Offline</span></>}
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <div className="logo-box">
            <Calendar size={18} color="var(--brass)" />
          </div>
          <div>
            <div className="app-title">Weekly Timetable</div>
            <div className="app-subtitle">
              {DAYS_FULL[todayIdx]} · {pad2(now.getHours())}:{pad2(now.getMinutes())}
            </div>
          </div>
        </div>

        <div className="header-right">
          <div className="search-wrap">
            <Search size={13} className="search-icon" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="search-input"
            />
          </div>

          <button className="btn" onClick={() => patchData({ showWeekend: !showWeekend })}>
            <span className="label">{showWeekend ? "7-day" : "5-day"}</span>
            <span style={{ display: "none" }} className="short">{showWeekend ? "7D" : "5D"}</span>
          </button>

          <button className="btn" onClick={() => setShowCategoryPanel((v) => !v)}>
            <Settings2 size={13} /><span className="label">Categories</span>
          </button>

          <button className="btn" onClick={exportSummary}>
            <Clipboard size={13} /><span className="label">Copy</span>
          </button>

          <button className="btn danger" onClick={clearWeek}>
            <span className="label">Clear</span>
          </button>

          <button className="btn icon-only" title="Lock" onClick={() => { sessionStorage.removeItem(SESSION_KEY); setUnlocked(false); setPin(null); pinRef.current = null; }}>
            <Lock size={14} />
          </button>
        </div>
      </header>

      {/* Controls bar */}
      <div className="controls-bar">
        <span>From</span>
        <select value={rangeStart} onChange={(e) => patchData({ rangeStart: Math.min(Number(e.target.value), rangeEnd - 1) })}>
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
        </select>
        <span>to</span>
        <select value={rangeEnd} onChange={(e) => patchData({ rangeEnd: Math.max(Number(e.target.value), rangeStart + 1) })}>
          {Array.from({ length: 25 }, (_, h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
        </select>
        <span style={{ marginLeft: 4 }}>{blocks.length} block{blocks.length !== 1 ? "s" : ""} · {stats.total}h</span>
        <SyncIndicator />
      </div>

      {/* Mobile day picker */}
      {mobile && (
        <div className="day-picker">
          {visibleDays.map((d) => (
            <button
              key={d}
              className={`day-pill ${d === mobileDay ? "active" : ""} ${d === todayIdx && d !== mobileDay ? "today" : ""}`}
              onClick={() => setMobileDay(d)}
            >
              {DAYS[d]}
              {d === todayIdx && <span style={{ marginLeft: 3, fontSize: 8 }}>●</span>}
            </button>
          ))}
        </div>
      )}

      {/* Main area */}
      <div className="app-layout">

        {/* Grid */}
        <div className="grid-wrapper tt-scroll">
          {mobile ? (
            /* Mobile: single day */
            <div style={{ minWidth: "100%" }}>
              <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 20, background: "var(--panel)" }}>
                <div style={{ width: 60, flexShrink: 0 }} />
                <div className="day-header-cell" style={{ background: mobileDay === todayIdx ? "rgba(217,164,65,0.09)" : "transparent" }}>
                  <div className="day-label">{DAYS_FULL[mobileDay]}</div>
                  {mobileDay === todayIdx && <div className="day-today-badge">today</div>}
                </div>
              </div>
              <div className="grid-body">
                <div className="hour-ruler">
                  {hours.map((h) => (
                    <div key={h} className="hour-tick">
                      <span className="hour-label">{fmtHour(h)}</span>
                      <span className="hour-tick-mark" style={{ width: h % 3 === 0 ? 10 : 5 }} />
                    </div>
                  ))}
                </div>
                {renderDayCol(mobileDay)}
              </div>
            </div>
          ) : (
            /* Desktop: full week */
            <div className="grid-inner" style={{ minWidth: 60 + visibleDays.length * 132 }}>
              <div className="day-header-row">
                <div className="day-header-spacer" />
                {visibleDays.map((d) => (
                  <div key={d} className="day-header-cell" style={{ background: d === todayIdx ? "rgba(217,164,65,0.09)" : "transparent" }}>
                    <div className="day-label">{DAYS[d]}</div>
                    {d === todayIdx && <div className="day-today-badge">today</div>}
                  </div>
                ))}
              </div>
              <div className="grid-body">
                <div className="hour-ruler">
                  {hours.map((h) => (
                    <div key={h} className="hour-tick">
                      <span className="hour-label">{fmtHour(h)}</span>
                      <span className="hour-tick-mark" style={{ width: h % 3 === 0 ? 10 : 5 }} />
                    </div>
                  ))}
                </div>
                {visibleDays.map((d) => renderDayCol(d))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar (desktop only) */}
        {!mobile && (
          <aside className="sidebar">
            {showCategoryPanel && (
              <div className="sidebar-card tt-fade-in">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div className="sidebar-title" style={{ margin: 0 }}>Categories</div>
                  <button className="btn" style={{ padding: "4px 8px", fontSize: 11 }} onClick={addCategory}><Plus size={12} /> Add</button>
                </div>
                {categories.map((c) => (
                  <div key={c.id} className="cat-row">
                    <div style={{ position: "relative" }}>
                      <button
                        className="cat-color-btn"
                        style={{ background: c.color }}
                        onClick={() => setOpenColorPicker(openColorPicker === c.id ? null : c.id)}
                      />
                      {openColorPicker === c.id && (
                        <div className="color-picker-popup">
                          {PALETTE.map((p) => (
                            <button key={p.hex} className="color-swatch" style={{ background: p.hex }} title={p.name}
                              onClick={() => { updateCategory(c.id, { color: p.hex }); setOpenColorPicker(null); }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    <input className="cat-name-input" value={c.name} onChange={(e) => updateCategory(c.id, { name: e.target.value })} />
                    <button onClick={() => removeCategory(c.id)} disabled={categories.length <= 1} style={{ color: "var(--muted)" }}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Weekly stats */}
            <div className="sidebar-card">
              <div className="sidebar-title">This week</div>
              {stats.rows.length === 0 ? (
                <p style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
                  Nothing scheduled yet. {mobile ? "Tap" : "Drag on the grid"} to add your first block.
                </p>
              ) : (
                <>
                  {stats.rows.map((r) => (
                    <div key={r.id} className="stat-row">
                      <div className="stat-labels">
                        <span style={{ fontSize: 11.5 }}>{r.name}</span>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>{r.hours}h</span>
                      </div>
                      <div className="stat-bar-bg">
                        <div className="stat-bar-fill" style={{ width: `${(r.hours / stats.maxHours) * 100}%`, background: r.color }} />
                      </div>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, marginTop: 4, borderTop: "1px solid var(--line)", fontSize: 11.5, color: "var(--muted)" }}>
                    <span>Total</span>
                    <span style={{ fontFamily: "var(--font-mono)" }}>{stats.total}h</span>
                  </div>
                </>
              )}
            </div>

            {/* Tips */}
            <div className="sidebar-card" style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.6 }}>
              <strong style={{ color: "var(--paper)" }}>Tips</strong><br />
              Drag on the grid to sketch a block. Drag a block's body to move it, its bottom edge to resize. Double-click a cell for a quick 1-hour add. Changes sync instantly to all devices.
            </div>
          </aside>
        )}
      </div>

      {/* Mobile FAB */}
      {mobile && (
        <button
          className="fab"
          onClick={() => setEditing({ id: uid(), day: mobileDay, start: 9, end: 10, title: "", categoryId: categories[0]?.id || "other", notes: "", isNew: true })}
        >
          <Plus size={24} />
        </button>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="modal-overlay tt-fade-in" onClick={() => setEditing(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">{editing.isNew ? "New block" : "Edit block"}</div>
              <button onClick={() => setEditing(null)} style={{ color: "var(--muted)" }}><X size={16} /></button>
            </div>

            <div className="form-group">
              <label className="form-label">Title</label>
              <input
                autoFocus
                className="form-input"
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && saveEditing()}
                placeholder="What's happening?"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Category</label>
              <div className="cat-chips">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    className={`cat-chip ${editing.categoryId === c.id ? "active" : ""}`}
                    style={editing.categoryId === c.id ? { background: `${c.color}33`, borderColor: c.color } : {}}
                    onClick={() => setEditing({ ...editing, categoryId: c.id })}
                  >
                    <span className="cat-chip-dot" style={{ background: c.color }} />{c.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Schedule</label>
              <div className="form-row">
                <select value={editing.day} onChange={(e) => setEditing({ ...editing, day: Number(e.target.value) })}>
                  {DAYS_FULL.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
                <select value={editing.start} onChange={(e) => { const s = Number(e.target.value); setEditing({ ...editing, start: s, end: Math.max(editing.end, s + 1) }); }}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
                </select>
                <select value={editing.end} onChange={(e) => setEditing({ ...editing, end: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h + 1} value={h + 1} disabled={h + 1 <= editing.start}>{fmtHour(h + 1)}</option>)}
                </select>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Notes</label>
              <textarea
                className="form-input"
                value={editing.notes}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                placeholder="Optional notes…"
                rows={2}
                style={{ resize: "none" }}
              />
            </div>

            <div className="modal-footer">
              {!editing.isNew ? (
                <button className="btn danger" onClick={deleteEditing}><Trash2 size={13} /> Delete</button>
              ) : <span />}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
                <button className="btn primary" onClick={saveEditing}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="toast tt-fade-in">
          {toast}
          {pendingDelete && toast.includes("undo") && (
            <button onClick={undoDelete} style={{ color: "var(--brass)", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
              <RotateCcw size={12} /> Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
