// src/components/LockScreen.jsx
import React, { useState } from "react";
import { Calendar, Delete } from "lucide-react";

const KEYS = ["1","2","3","4","5","6","7","8","9","0"];

export default function LockScreen({ onUnlock, error }) {
  const [pin, setPin] = useState("");
  const MAX = 4;

  const press = (k) => {
    if (pin.length >= MAX) return;
    const next = pin + k;
    setPin(next);
    if (next.length === MAX) {
      // small delay so last dot animates
      setTimeout(() => onUnlock(next), 120);
    }
  };

  const del = () => setPin((p) => p.slice(0, -1));

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <div className="lock-logo">
          <Calendar size={26} color="var(--brass)" />
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 20 }}>
            Weekly Timetable
          </div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
            Enter your PIN to continue
          </div>
        </div>

        <div className="pin-dots">
          {Array.from({ length: MAX }).map((_, i) => (
            <div key={i} className={`pin-dot ${i < pin.length ? "filled" : ""}`} />
          ))}
        </div>

        {error && (
          <div style={{ color: "var(--red)", fontSize: 12, marginTop: -8 }}>
            Incorrect PIN. Try again.
          </div>
        )}

        <div className="pin-pad">
          {["1","2","3","4","5","6","7","8","9"].map((k) => (
            <button key={k} className="pin-key" onClick={() => press(k)}>{k}</button>
          ))}
          <button className="pin-key" style={{ visibility: "hidden" }} />
          <button className="pin-key" onClick={() => press("0")}>0</button>
          <button className="pin-key del" onClick={del}>
            <Delete size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
