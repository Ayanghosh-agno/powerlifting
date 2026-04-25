import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAppContext } from "../App";

const REFEREE_SLOTS = [
  { key: "left", label: "Left", index: 0 },
  { key: "center", label: "Center", index: 1 },
  { key: "right", label: "Right", index: 2 },
];

const REFEREE_CONFIRM_DELAY_MS = 1000;

export const RefereePanelPage = () => {
  const {
    activeCompetitionId,
    refereeSignals,
    setRefereeSignals,
    applyRefereeDecision,
  } = useAppContext();

  const [decisionEndsAt, setDecisionEndsAt] = useState<number | null>(null);
  const [pendingDecision, setPendingDecision] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [pendingPosition, setPendingPosition] = useState<number | null>(null);

  useEffect(() => {
    if (!decisionEndsAt) return;
    const ticker = window.setInterval(() => setNow(Date.now()), 50);
    return () => window.clearInterval(ticker);
  }, [decisionEndsAt]);

  useEffect(() => {
    if (refereeSignals.every((signal) => signal !== null)) {
      const timer = window.setTimeout(() => applyRefereeDecision(), 240);
      return () => window.clearTimeout(timer);
    }
  }, [refereeSignals, applyRefereeDecision]);

  const startHold = (position: number, decision: string) => {
    if (pendingDecision) return;
    setPendingPosition(position);
    setPendingDecision(decision);
    setDecisionEndsAt(Date.now() + REFEREE_CONFIRM_DELAY_MS);

    const timer = window.setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(80);
      const nextSignals = refereeSignals.map((s, idx) =>
        idx === position ? decision : s
      );
      setRefereeSignals(nextSignals);
      setPendingDecision(null);
      setPendingPosition(null);
      setDecisionEndsAt(null);
    }, REFEREE_CONFIRM_DELAY_MS);

    return () => window.clearTimeout(timer);
  };

  const cancelHold = () => {
    setPendingDecision(null);
    setPendingPosition(null);
    setDecisionEndsAt(null);
  };

  const countdown =
    decisionEndsAt && pendingPosition !== null
      ? Math.max(0, (decisionEndsAt - now) / 1000)
      : 0;

  const progressPercentage =
    decisionEndsAt && pendingPosition !== null
      ? ((REFEREE_CONFIRM_DELAY_MS - (decisionEndsAt - now)) /
          REFEREE_CONFIRM_DELAY_MS) *
        100
      : 0;

  if (!activeCompetitionId) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-400">
        Select a competition first
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-6xl mx-auto">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {REFEREE_SLOTS.map((slot) => {
          const signal = refereeSignals[slot.index];
          const isHoldingThis = pendingPosition === slot.index;
          const signalColor =
            signal === "GOOD"
              ? "text-emerald-400"
              : signal === "NO"
              ? "text-red-400"
              : "text-slate-400";

          return (
            <div key={slot.key} className="space-y-4">
              <div className="bg-slate-900/50 rounded-2xl border border-slate-700/30 p-6 space-y-4">
                <div className="text-center">
                  <p className="text-xs uppercase tracking-widest text-slate-500 mb-2">
                    {slot.label} Referee
                  </p>
                  <p className={`text-3xl font-bold ${signalColor}`}>
                    {signal ?? "—"}
                  </p>
                </div>

                <div className="space-y-2">
                  <button
                    onPointerDown={() => startHold(slot.index, "GOOD")}
                    onPointerUp={cancelHold}
                    onPointerLeave={cancelHold}
                    onPointerCancel={cancelHold}
                    className="w-full touch-manipulation rounded-xl bg-emerald-500 px-4 py-4 text-lg font-bold text-black shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 active:scale-95 transition-all overflow-hidden relative"
                  >
                    {isHoldingThis && pendingDecision === "GOOD" && (
                      <motion.div
                        className="absolute inset-0 bg-emerald-600 rounded-xl"
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: progressPercentage / 100 }}
                        transition={{ duration: 0.05 }}
                        style={{ transformOrigin: "left" }}
                      />
                    )}
                    <span className="relative z-10">
                      {isHoldingThis && pendingDecision === "GOOD"
                        ? `${countdown.toFixed(1)}s`
                        : "GOOD"}
                    </span>
                  </button>

                  <button
                    onPointerDown={() => startHold(slot.index, "NO")}
                    onPointerUp={cancelHold}
                    onPointerLeave={cancelHold}
                    onPointerCancel={cancelHold}
                    className="w-full touch-manipulation rounded-xl bg-red-500 px-4 py-4 text-lg font-bold text-white shadow-lg shadow-red-500/20 hover:bg-red-400 active:scale-95 transition-all overflow-hidden relative"
                  >
                    {isHoldingThis && pendingDecision === "NO" && (
                      <motion.div
                        className="absolute inset-0 bg-red-600 rounded-xl"
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: progressPercentage / 100 }}
                        transition={{ duration: 0.05 }}
                        style={{ transformOrigin: "left" }}
                      />
                    )}
                    <span className="relative z-10">
                      {isHoldingThis && pendingDecision === "NO"
                        ? `${countdown.toFixed(1)}s`
                        : "NO"}
                    </span>
                  </button>

                  <button
                    onClick={() => {
                      const next = refereeSignals.map((s, idx) =>
                        idx === slot.index ? null : s
                      );
                      setRefereeSignals(next);
                    }}
                    className="w-full rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-600 transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-3 justify-center">
        <button
          onClick={() => setRefereeSignals([null, null, null])}
          className="px-6 py-3 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700 transition-colors"
        >
          Reset All Signals
        </button>
        <button
          onClick={() => applyRefereeDecision()}
          className="px-6 py-3 rounded-lg bg-cyan-600 text-white font-semibold hover:bg-cyan-700 transition-colors"
        >
          Apply Decision
        </button>
      </div>
    </div>
  );
};
