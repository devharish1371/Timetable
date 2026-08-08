import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Plus, X, Trash2, Search, Ruler, Clipboard, RotateCcw, ChevronDown, Settings2 } from "lucide-react";

// ---------- constants ----------
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAYS_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const ROW_H = 56;
const STORAGE_KEY = "timetable:v1";

const PALETTE = [
  { name: "Teal", hex: "#4FA8A0" },
  { name: "Coral", hex: "#E4674F" },
  { name: "Sage", hex: "#7FA37A" },
  { name: "Periwinkle", hex: "#8686D8" },
  { name: "Rose", hex: "#C97B9A" },
  { name: "Ochre", hex: "#D9A441" },
  { name: "Slate", hex: "#7C8FA6" },
  { name: "Plum", hex: "#9B6BA6" },
];

const DEFAULT_CATEGORIES = [
  { id: "work", name: "Work", color: "#4FA8A0" },
  { id: "study", name: "Study", color: "#8686D8" },
  { id: "health", name: "Health", color: "#7FA37A" },
  { id: "personal", name: "Personal", color: "#E4674F" },
  { id: "social", name: "Social", color: "#C97B9A" },
  { id: "other", name: "Other", color: "#D9A441" },
];

const COLORS = {
  bg: "#101B2D",
  panel: "#16233A",
  panelSoft: "#1B2A44",
  line: "rgba(146,186,212,0.16)",
  lineStrong: "rgba(146,186,212,0.34)",
  paper: "#F0EDE3",
  muted: "#8095AD",
  brass: "#D9A441",
  brassDim: "rgba(217,164,65,0.35)",
};

const FONT_DISPLAY = "'Space Grotesk', sans-serif";
const FONT_MONO = "'IBM Plex Mono', monospace";
const FONT_BODY = "'Inter', sans-serif";

function pad2(n) {
  return n.toString().padStart(2, "0");
}
function fmtHour(h) {
  const hh = ((h % 24) + 24) % 24;
  return `${pad2(hh)}:00`;
}
function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function todayIndex() {
  return (new Date().getDay() + 6) % 7; // Mon=0..Sun=6
}

// cluster + column layout so overlapping blocks sit side by side
function layoutDay(dayBlocks) {
  const sorted = [...dayBlocks].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const clusters = [];
  let current = [];
  let clusterEnd = -Infinity;
  for (const b of sorted) {
    if (current.length === 0 || b.start < clusterEnd) {
      current.push(b);
      clusterEnd = Math.max(clusterEnd, b.end);
    } else {
      clusters.push(current);
      current = [b];
      clusterEnd = b.end;
    }
  }
  if (current.length) clusters.push(current);

  const result = {};
  for (const cluster of clusters) {
    const colEnds = [];
    const assigned = [];
    for (const b of cluster) {
      let col = colEnds.findIndex((end) => end <= b.start);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(b.end);
      } else {
        colEnds[col] = b.end;
      }
      assigned.push({ b, col });
    }
    const totalCols = colEnds.length;
    for (const { b, col } of assigned) {
      result[b.id] = { col, totalCols };
    }
  }
  return result;
}

export default function WeeklyTimetable() {
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [blocks, setBlocks] = useState([]);
  const [rangeStart, setRangeStart] = useState(6);
  const [rangeEnd, setRangeEnd] = useState(22);
  const [showWeekend, setShowWeekend] = useState(true);
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(null); // {isNew, ...blockFields}
  const [showCategoryPanel, setShowCategoryPanel] = useState(false);
  const [toast, setToast] = useState(null);
  const [now, setNow] = useState(new Date());
  const [pendingDelete, setPendingDelete] = useState(null); // for undo

  const creatingRef = useRef(null); // {day, anchor}
  const [creatingPreview, setCreatingPreview] = useState(null);
  const draggingRef = useRef(null); // {id, mode: 'move'|'resize', grabOffset}
  const [, forceTick] = useState(0);
  const toastTimer = useRef(null);
  const saveTimer = useRef(null);

  const visibleDays = showWeekend ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4];
  const hours = useMemo(() => {
    const arr = [];
    for (let h = rangeStart; h < rangeEnd; h++) arr.push(h);
    return arr;
  }, [rangeStart, rangeEnd]);

  // ---------- load / save ----------
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        if (res && res.value) {
          const data = JSON.parse(res.value);
          if (data.blocks) setBlocks(data.blocks);
          if (data.categories) setCategories(data.categories);
          if (typeof data.rangeStart === "number") setRangeStart(data.rangeStart);
          if (typeof data.rangeEnd === "number") setRangeEnd(data.rangeEnd);
          if (typeof data.showWeekend === "boolean") setShowWeekend(data.showWeekend);
        }
      } catch (e) {
        // no saved data yet
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await window.storage.set(
          STORAGE_KEY,
          JSON.stringify({ blocks, categories, rangeStart, rangeEnd, showWeekend }),
          false
        );
      } catch (e) {
        showToast("Couldn't save — changes may not persist");
      }
    }, 400);
    return () => clearTimeout(saveTimer.current);
  }, [blocks, categories, rangeStart, rangeEnd, showWeekend, loaded]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  // ---------- drag to create ----------
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
      setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, day, start: newStart, end: newStart + duration } : b)));
    }
    if (draggingRef.current && draggingRef.current.mode === "resize") {
      const { id, day: bDay, start } = draggingRef.current;
      if (day !== bDay) return;
      const newEnd = Math.max(start + 1, Math.min(hour + 1, rangeEnd));
      setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, end: newEnd } : b)));
    }
  };

  useEffect(() => {
    const onUp = () => {
      if (creatingRef.current && creatingPreview) {
        const draft = {
          id: uid(),
          day: creatingPreview.day,
          start: creatingPreview.start,
          end: creatingPreview.end,
          title: "",
          categoryId: categories[0]?.id || "other",
          notes: "",
        };
        setEditing({ ...draft, isNew: true });
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
    draggingRef.current = {
      id: block.id,
      mode: "move",
      grabOffset: 0,
      duration: block.end - block.start,
    };
  };
  const startResizeBlock = (block, e) => {
    e.stopPropagation();
    draggingRef.current = { id: block.id, mode: "resize", day: block.day, start: block.start };
  };

  // ---------- editing ----------
  const openExisting = (block, e) => {
    e.stopPropagation();
    setEditing({ ...block, isNew: false });
  };

  const saveEditing = () => {
    if (!editing.title.trim()) {
      showToast("Give the block a title before saving");
      return;
    }
    if (editing.isNew) {
      setBlocks((bs) => [...bs, { ...editing, title: editing.title.trim() }]);
    } else {
      setBlocks((bs) => bs.map((b) => (b.id === editing.id ? { ...editing, title: editing.title.trim() } : b)));
    }
    setEditing(null);
  };

  const deleteEditing = () => {
    if (!editing.isNew) {
      const removed = blocks.find((b) => b.id === editing.id);
      setBlocks((bs) => bs.filter((b) => b.id !== editing.id));
      setPendingDelete(removed);
      showToast("Block deleted — undo?");
    }
    setEditing(null);
  };

  const undoDelete = () => {
    if (pendingDelete) {
      setBlocks((bs) => [...bs, pendingDelete]);
      setPendingDelete(null);
      setToast(null);
    }
  };

  // ---------- category management ----------
  const addCategory = () => {
    const used = new Set(categories.map((c) => c.color));
    const color = PALETTE.find((p) => !used.has(p.hex))?.hex || PALETTE[categories.length % PALETTE.length].hex;
    setCategories((cs) => [...cs, { id: uid(), name: "New category", color }]);
  };
  const updateCategory = (id, patch) => {
    setCategories((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };
  const removeCategory = (id) => {
    if (categories.length <= 1) return;
    const fallback = categories.find((c) => c.id !== id)?.id;
    setCategories((cs) => cs.filter((c) => c.id !== id));
    setBlocks((bs) => bs.map((b) => (b.categoryId === id ? { ...b, categoryId: fallback } : b)));
  };

  // ---------- stats ----------
  const stats = useMemo(() => {
    const byCategory = {};
    let total = 0;
    for (const b of blocks) {
      const dur = b.end - b.start;
      total += dur;
      byCategory[b.categoryId] = (byCategory[b.categoryId] || 0) + dur;
    }
    const rows = categories
      .map((c) => ({ ...c, hours: byCategory[c.id] || 0 }))
      .filter((c) => c.hours > 0)
      .sort((a, b) => b.hours - a.hours);
    return { total, rows, maxHours: rows[0]?.hours || 1 };
  }, [blocks, categories]);

  // ---------- export ----------
  const exportSummary = async () => {
    const lines = [];
    visibleDays.forEach((d) => {
      const dayBlocks = blocks.filter((b) => b.day === d).sort((a, b) => a.start - b.start);
      if (dayBlocks.length === 0) return;
      lines.push(DAYS_FULL[d]);
      dayBlocks.forEach((b) => {
        const cat = categories.find((c) => c.id === b.categoryId);
        lines.push(`  ${fmtHour(b.start)}–${fmtHour(b.end)}  ${b.title}${cat ? ` (${cat.name})` : ""}`);
      });
    });
    const text = lines.length ? lines.join("\n") : "No blocks scheduled yet.";
    try {
      await navigator.clipboard.writeText(text);
      showToast("Week summary copied to clipboard");
    } catch {
      showToast("Couldn't access clipboard");
    }
  };

  const clearWeek = () => {
    if (confirm("Clear every block from the timetable? This can't be undone.")) {
      setBlocks([]);
      showToast("Timetable cleared");
    }
  };

  const categoryOf = (id) => categories.find((c) => c.id === id);
  const nowHourFrac = now.getHours() + now.getMinutes() / 60;
  const todayIdx = todayIndex();
  const showNowLine = visibleDays.includes(todayIdx) && nowHourFrac >= rangeStart && nowHourFrac <= rangeEnd;

  const searchActive = search.trim().length > 0;
  const matches = (b) => b.title.toLowerCase().includes(search.trim().toLowerCase());

  return (
    <div
      className="w-full min-h-screen"
      style={{ background: COLORS.bg, fontFamily: FONT_BODY, color: COLORS.paper }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        .tt-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
        .tt-scroll::-webkit-scrollbar-thumb { background: rgba(146,186,212,0.3); border-radius: 4px; }
        .tt-cell:hover { background: rgba(146,186,212,0.06); cursor: crosshair; }
        .tt-block { transition: box-shadow 0.15s ease, transform 0.1s ease; }
        .tt-block:hover { box-shadow: 0 0 0 1px rgba(240,237,227,0.4), 0 4px 14px rgba(0,0,0,0.35); }
        .tt-fade-in { animation: ttFade 0.25s ease; }
        @keyframes ttFade { from { opacity: 0; transform: translateY(4px);} to { opacity: 1; transform: translateY(0);} }
        input[type="range"] { accent-color: ${COLORS.brass}; }
        @media (prefers-reduced-motion: reduce) { .tt-block, .tt-fade-in { animation: none !important; transition: none !important; } }
      `}</style>

      {/* header */}
      <header
        className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 border-b"
        style={{ borderColor: COLORS.line }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center rounded-md"
            style={{ width: 38, height: 38, background: COLORS.panelSoft, border: `1px solid ${COLORS.lineStrong}` }}
          >
            <Ruler size={18} color={COLORS.brass} />
          </div>
          <div>
            <h1
              className="text-xl tracking-tight leading-none"
              style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, letterSpacing: "-0.01em" }}
            >
              Weekly Timetable
            </h1>
            <p className="text-xs mt-1" style={{ color: COLORS.muted, fontFamily: FONT_MONO }}>
              {DAYS_FULL[todayIdx]} · {pad2(now.getHours())}:{pad2(now.getMinutes())} · drag to schedule
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={14} style={{ position: "absolute", left: 10, top: 9, color: COLORS.muted }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search blocks"
              className="text-sm rounded-md py-1.5 pl-7 pr-3 outline-none"
              style={{
                background: COLORS.panelSoft,
                border: `1px solid ${COLORS.lineStrong}`,
                color: COLORS.paper,
                width: 150,
                fontFamily: FONT_BODY,
              }}
            />
          </div>
          <button
            onClick={() => setShowWeekend((v) => !v)}
            className="text-xs rounded-md px-3 py-1.5"
            style={{ background: COLORS.panelSoft, border: `1px solid ${COLORS.lineStrong}`, color: COLORS.paper }}
          >
            {showWeekend ? "7-day" : "5-day"}
          </button>
          <button
            onClick={() => setShowCategoryPanel((v) => !v)}
            className="text-xs rounded-md px-3 py-1.5 flex items-center gap-1.5"
            style={{ background: COLORS.panelSoft, border: `1px solid ${COLORS.lineStrong}`, color: COLORS.paper }}
          >
            <Settings2 size={13} /> Categories
          </button>
          <button
            onClick={exportSummary}
            className="text-xs rounded-md px-3 py-1.5 flex items-center gap-1.5"
            style={{ background: COLORS.panelSoft, border: `1px solid ${COLORS.lineStrong}`, color: COLORS.paper }}
          >
            <Clipboard size={13} /> Copy summary
          </button>
          <button
            onClick={clearWeek}
            className="text-xs rounded-md px-3 py-1.5"
            style={{ background: "transparent", border: `1px solid ${COLORS.lineStrong}`, color: "#E4674F" }}
          >
            Clear week
          </button>
        </div>
      </header>

      {/* hour range controls */}
      <div className="flex items-center gap-4 px-6 py-2 text-xs" style={{ color: COLORS.muted, fontFamily: FONT_MONO }}>
        <span>Day starts</span>
        <select
          value={rangeStart}
          onChange={(e) => setRangeStart(Math.min(Number(e.target.value), rangeEnd - 1))}
          className="rounded px-1.5 py-0.5"
          style={{ background: COLORS.panelSoft, border: `1px solid ${COLORS.lineStrong}`, color: COLORS.paper }}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>{fmtHour(h)}</option>
          ))}
        </select>
        <span>ends</span>
        <select
          value={rangeEnd}
          onChange={(e) => setRangeEnd(Math.max(Number(e.target.value), rangeStart + 1))}
          className="rounded px-1.5 py-0.5"
          style={{ background: COLORS.panelSoft, border: `1px solid ${COLORS.lineStrong}`, color: COLORS.paper }}
        >
          {Array.from({ length: 25 }, (_, h) => (
            <option key={h} value={h}>{fmtHour(h)}</option>
          ))}
        </select>
        <span className="ml-2">{blocks.length} block{blocks.length === 1 ? "" : "s"} · {stats.total}h scheduled</span>
      </div>

      <div className="flex gap-4 px-6 pb-6">
        {/* grid */}
        <div className="flex-1 overflow-x-auto tt-scroll rounded-lg" style={{ border: `1px solid ${COLORS.lineStrong}` }}>
          <div style={{ minWidth: 60 + visibleDays.length * 132 }}>
            {/* day headers */}
            <div className="flex sticky top-0 z-20" style={{ background: COLORS.panel }}>
              <div style={{ width: 60, flexShrink: 0 }} />
              {visibleDays.map((d) => (
                <div
                  key={d}
                  className="flex-1 text-center py-2 border-l"
                  style={{
                    borderColor: COLORS.line,
                    minWidth: 132,
                    background: d === todayIdx ? "rgba(217,164,65,0.09)" : "transparent",
                  }}
                >
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 13 }}>
                    {DAYS[d]}
                  </div>
                  {d === todayIdx && (
                    <div style={{ fontSize: 10, color: COLORS.brass, fontFamily: FONT_MONO }}>today</div>
                  )}
                </div>
              ))}
            </div>

            {/* body */}
            <div className="flex relative select-none">
              {/* hour ruler */}
              <div style={{ width: 60, flexShrink: 0 }}>
                {hours.map((h) => (
                  <div key={h} style={{ height: ROW_H, position: "relative" }}>
                    <span
                      style={{
                        position: "absolute",
                        top: -7,
                        right: 8,
                        fontSize: 10.5,
                        fontFamily: FONT_MONO,
                        color: COLORS.muted,
                      }}
                    >
                      {fmtHour(h)}
                    </span>
                    <span
                      style={{
                        position: "absolute",
                        top: 0,
                        right: 0,
                        width: h % 3 === 0 ? 10 : 5,
                        height: 1,
                        background: COLORS.lineStrong,
                      }}
                    />
                  </div>
                ))}
              </div>

              {/* day columns */}
              {visibleDays.map((d) => {
                const dayBlocks = blocks.filter((b) => b.day === d);
                const layout = layoutDay(dayBlocks);
                return (
                  <div
                    key={d}
                    className="flex-1 relative border-l"
                    style={{
                      minWidth: 132,
                      borderColor: COLORS.line,
                      background:
                        d === todayIdx
                          ? "rgba(217,164,65,0.04)"
                          : `repeating-linear-gradient(to bottom, transparent 0, transparent ${ROW_H - 1}px, ${COLORS.line} ${ROW_H - 1}px, ${COLORS.line} ${ROW_H}px)`,
                      height: hours.length * ROW_H,
                    }}
                  >
                    {/* invisible hour hit-targets */}
                    {hours.map((h) => (
                      <div
                        key={h}
                        className="tt-cell"
                        onMouseDown={(e) => onCellMouseDown(d, h, e)}
                        onMouseEnter={() => onCellMouseEnter(d, h)}
                        onDoubleClick={() => {
                          setEditing({
                            id: uid(),
                            day: d,
                            start: h,
                            end: h + 1,
                            title: "",
                            categoryId: categories[0]?.id || "other",
                            notes: "",
                            isNew: true,
                          });
                        }}
                        style={{ position: "absolute", top: (h - rangeStart) * ROW_H, left: 0, right: 0, height: ROW_H }}
                        title="Drag to add a block"
                      />
                    ))}

                    {/* create preview */}
                    {creatingPreview && creatingPreview.day === d && (
                      <div
                        className="tt-fade-in"
                        style={{
                          position: "absolute",
                          top: (creatingPreview.start - rangeStart) * ROW_H,
                          height: (creatingPreview.end - creatingPreview.start) * ROW_H,
                          left: 3,
                          right: 3,
                          background: COLORS.brassDim,
                          border: `1px dashed ${COLORS.brass}`,
                          borderRadius: 6,
                          pointerEvents: "none",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontFamily: FONT_MONO,
                          fontSize: 11,
                          color: COLORS.paper,
                        }}
                      >
                        {creatingPreview.end - creatingPreview.start}h
                      </div>
                    )}

                    {/* now line */}
                    {showNowLine && d === todayIdx && (
                      <div
                        style={{
                          position: "absolute",
                          top: (nowHourFrac - rangeStart) * ROW_H,
                          left: 0,
                          right: 0,
                          height: 0,
                          borderTop: `1.5px dashed ${COLORS.brass}`,
                          zIndex: 15,
                        }}
                      >
                        <div
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 999,
                            background: COLORS.brass,
                            position: "absolute",
                            left: -3,
                            top: -3.5,
                          }}
                        />
                      </div>
                    )}

                    {/* blocks */}
                    {dayBlocks.map((b) => {
                      const cat = categoryOf(b.categoryId);
                      const { col, totalCols } = layout[b.id] || { col: 0, totalCols: 1 };
                      const widthPct = 100 / totalCols;
                      const dim = searchActive && !matches(b);
                      return (
                        <div
                          key={b.id}
                          className="tt-block tt-fade-in"
                          onMouseDown={(e) => startMoveBlock(b, e)}
                          onClick={(e) => openExisting(b, e)}
                          style={{
                            position: "absolute",
                            top: (b.start - rangeStart) * ROW_H + 2,
                            height: (b.end - b.start) * ROW_H - 4,
                            left: `calc(${col * widthPct}% + 3px)`,
                            width: `calc(${widthPct}% - 6px)`,
                            background: cat ? `${cat.color}26` : "rgba(146,186,212,0.15)",
                            borderLeft: `3px solid ${cat ? cat.color : COLORS.muted}`,
                            borderRadius: 6,
                            padding: "5px 7px",
                            cursor: "grab",
                            overflow: "hidden",
                            opacity: dim ? 0.25 : 1,
                            zIndex: 10,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              lineHeight: 1.2,
                              color: COLORS.paper,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {b.title || "Untitled"}
                          </div>
                          <div style={{ fontSize: 10, fontFamily: FONT_MONO, color: COLORS.muted, marginTop: 2 }}>
                            {fmtHour(b.start)}–{fmtHour(b.end)}
                          </div>
                          <div
                            onMouseDown={(e) => startResizeBlock(b, e)}
                            style={{
                              position: "absolute",
                              left: 0,
                              right: 0,
                              bottom: 0,
                              height: 8,
                              cursor: "ns-resize",
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* sidebar */}
        <aside className="hidden lg:flex flex-col gap-4" style={{ width: 240, flexShrink: 0 }}>
          {showCategoryPanel && (
            <div className="rounded-lg p-3 tt-fade-in" style={{ background: COLORS.panel, border: `1px solid ${COLORS.lineStrong}` }}>
              <div className="flex items-center justify-between mb-2">
                <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 600 }}>Categories</h3>
                <button onClick={addCategory} style={{ color: COLORS.brass }}>
                  <Plus size={15} />
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {categories.map((c) => (
                  <div key={c.id} className="flex items-center gap-2">
                    <div className="relative group">
                      <button
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 999,
                          background: c.color,
                          border: `1px solid ${COLORS.lineStrong}`,
                        }}
                        onClick={(e) => {
                          const menu = e.currentTarget.nextSibling;
                          menu.style.display = menu.style.display === "flex" ? "none" : "flex";
                        }}
                      />
                      <div
                        style={{
                          display: "none",
                          position: "absolute",
                          top: 20,
                          left: 0,
                          zIndex: 30,
                          background: COLORS.panelSoft,
                          border: `1px solid ${COLORS.lineStrong}`,
                          borderRadius: 6,
                          padding: 6,
                          gap: 4,
                          flexWrap: "wrap",
                          width: 100,
                        }}
                      >
                        {PALETTE.map((p) => (
                          <button
                            key={p.hex}
                            onClick={() => updateCategory(c.id, { color: p.hex })}
                            style={{ width: 16, height: 16, borderRadius: 999, background: p.hex }}
                            title={p.name}
                          />
                        ))}
                      </div>
                    </div>
                    <input
                      value={c.name}
                      onChange={(e) => updateCategory(c.id, { name: e.target.value })}
                      className="text-xs flex-1 min-w-0 rounded px-1.5 py-1 outline-none"
                      style={{ background: COLORS.panelSoft, border: `1px solid ${COLORS.line}`, color: COLORS.paper }}
                    />
                    <button onClick={() => removeCategory(c.id)} style={{ color: COLORS.muted }} disabled={categories.length <= 1}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg p-3" style={{ background: COLORS.panel, border: `1px solid ${COLORS.lineStrong}` }}>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>This week</h3>
            {stats.rows.length === 0 ? (
              <p style={{ fontSize: 12, color: COLORS.muted }}>Nothing scheduled yet. Drag on the grid to add your first block.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {stats.rows.map((r) => (
                  <div key={r.id}>
                    <div className="flex justify-between" style={{ fontSize: 11.5, marginBottom: 3 }}>
                      <span>{r.name}</span>
                      <span style={{ fontFamily: FONT_MONO, color: COLORS.muted }}>{r.hours}h</span>
                    </div>
                    <div style={{ height: 5, borderRadius: 3, background: COLORS.panelSoft, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${(r.hours / stats.maxHours) * 100}%`, background: r.color }} />
                    </div>
                  </div>
                ))}
                <div className="pt-1 flex justify-between" style={{ fontSize: 11.5, color: COLORS.muted, borderTop: `1px solid ${COLORS.line}` }}>
                  <span>Total scheduled</span>
                  <span style={{ fontFamily: FONT_MONO }}>{stats.total}h</span>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg p-3" style={{ background: COLORS.panel, border: `1px solid ${COLORS.lineStrong}`, fontSize: 11.5, color: COLORS.muted, lineHeight: 1.5 }}>
            <strong style={{ color: COLORS.paper }}>Tips</strong>
            <br />Drag on the grid to sketch a block. Drag a block's body to move it, its bottom edge to resize. Double-click a cell for a quick 1-hour add.
          </div>
        </aside>
      </div>

      {/* editor modal */}
      {editing && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 tt-fade-in"
          style={{ background: "rgba(8,13,22,0.6)" }}
          onClick={() => setEditing(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="rounded-xl p-5"
            style={{ width: 340, background: COLORS.panel, border: `1px solid ${COLORS.lineStrong}` }}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15 }}>
                {editing.isNew ? "New block" : "Edit block"}
              </h3>
              <button onClick={() => setEditing(null)} style={{ color: COLORS.muted }}>
                <X size={16} />
              </button>
            </div>

            <input
              autoFocus
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && saveEditing()}
              placeholder="What's happening?"
              className="w-full text-sm rounded-md px-3 py-2 mb-3 outline-none"
              style={{ background: COLORS.panelSoft, border: `1px solid ${COLORS.lineStrong}`, color: COLORS.paper }}
            />

            <div className="flex gap-2 mb-3 flex-wrap">
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setEditing({ ...editing, categoryId: c.id })}
                  className="flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1"
                  style={{
                    background: editing.categoryId === c.id ? `${c.color}33` : COLORS.panelSoft,
                    border: `1px solid ${editing.categoryId === c.id ? c.color : COLORS.lineStrong}`,
                    color: COLORS.paper,
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: c.color }} />
                  {c.name}
                </button>
              ))}
            </div>

            <div className="flex gap-2 mb-3">
              <select
                value={editing.day}
                onChange={(e) => setEditing({ ...editing, day: Number(e.target.value) })}
                className="flex-1 text-xs rounded-md px-2 py-1.5"
                style={{ background: COLORS.panelSoft, border: `1px solid ${COLORS.lineStrong}`, color: COLORS.paper }}
              >
                {DAYS_FULL.map((d, i) => (
                  <option key={d} value={i}>{d}</option>
                ))}
              </select>
              <select
                value={editing.start}
                onChange={(e) => {
                  const start = Number(e.target.value);
                  setEditing({ ...editing, start, end: Math.max(editing.end, start + 1) });
                }}
                className="text-xs rounded-md px-2 py-1.5"
                style={{ background: COLORS.panelSoft, border: `1px solid ${COLORS.lineStrong}`, color: COLORS.paper }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{fmtHour(h)}</option>
                ))}
              </select>
              <select
                value={editing.end}
                onChange={(e) => setEditing({ ...editing, end: Number(e.target.value) })}
                className="text-xs rounded-md px-2 py-1.5"
                style={{ background: COLORS.panelSoft, border: `1px solid ${COLORS.lineStrong}`, color: COLORS.paper }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h + 1} value={h + 1} disabled={h + 1 <= editing.start}>{fmtHour(h + 1)}</option>
                ))}
              </select>
            </div>

            <textarea
              value={editing.notes}
              onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
              placeholder="Notes (optional)"
              rows={2}
              className="w-full text-xs rounded-md px-3 py-2 mb-4 outline-none resize-none"
              style={{ background: COLORS.panelSoft, border: `1px solid ${COLORS.lineStrong}`, color: COLORS.paper }}
            />

            <div className="flex items-center justify-between">
              {!editing.isNew ? (
                <button onClick={deleteEditing} className="flex items-center gap-1 text-xs" style={{ color: "#E4674F" }}>
                  <Trash2 size={13} /> Delete
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(null)}
                  className="text-xs rounded-md px-3 py-1.5"
                  style={{ border: `1px solid ${COLORS.lineStrong}`, color: COLORS.paper }}
                >
                  Cancel
                </button>
                <button
                  onClick={saveEditing}
                  className="text-xs rounded-md px-3 py-1.5"
                  style={{ background: COLORS.brass, color: "#101B2D", fontWeight: 600 }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* toast */}
      {toast && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 tt-fade-in flex items-center gap-3 rounded-full px-4 py-2 text-xs"
          style={{ background: COLORS.panel, border: `1px solid ${COLORS.lineStrong}`, color: COLORS.paper }}
        >
          {toast}
          {pendingDelete && toast.includes("undo") && (
            <button onClick={undoDelete} className="flex items-center gap-1" style={{ color: COLORS.brass, fontWeight: 600 }}>
              <RotateCcw size={12} /> Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
