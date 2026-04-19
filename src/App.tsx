import { useCallback, useEffect, useMemo, useRef, useState, createContext, useContext, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  HashRouter,
  Link,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import indiaStateDistrictData from "../node_modules/india-states-districts/state_discripts.json";
import { useSupabaseSync, type ConnectedRefereeSlots } from "./lib/useSupabaseSync";
import { supabase } from "./lib/supabase";

type LiftType = "squat" | "bench" | "deadlift";
type AttemptStatus = "PENDING" | "GOOD" | "NO" | "UNATTEMPTED";
type TimerPhase = "IDLE" | "ATTEMPT" | "NEXT_ATTEMPT";
type CompetitionMode = "FULL_GAME" | "BENCH_ONLY";
type Attempt = { weight: number | ""; status: AttemptStatus };
type RefSignal = "GOOD" | "NO" | null;
type RefereeSlot = "left" | "center" | "right";
type DisplayThemeKey = "black" | "white" | "royal" | "emerald" | "sepia" | "crimson" | "graphite";
type Group = { id: string; name: string; currentLift: LiftType };
type NextAttemptEntry = { lifterId: string; lift: LiftType; attemptIndex: number };

type Lifter = {
  id: string;
  name: string;
  sex: "Male" | "Female";
  dob: string;
  bodyweight: number | "";
  weightClass: string;
  manualWeightClass: string;
  isEquipped: boolean;
  disqualified: boolean;
  category: string; 
  group: string;
  team: string;
  rackHeightSquat: number | "";
  rackHeightBench: number | "";
  lot: number | "";
  squatAttempts: Attempt[];
  benchAttempts: Attempt[];
  deadliftAttempts: Attempt[];
};

type AppContextValue = {
  competitions: CompetitionRecord[];
  activeCompetitionId: string | null;
  activeCompetitionName: string;
  createCompetition: (name: string) => { ok: boolean; message: string; competitionId?: string };
  switchCompetition: (competitionId: string) => void;
  updateCompetitionName: (competitionId: string, name: string) => { ok: boolean; message: string };
  deleteCompetition: (competitionId: string) => void;
  lifters: Lifter[];
  setLifters: (lifters: Lifter[]) => void;
  groups: Group[];
  setGroups: (groups: Group[]) => void;
  currentLifterId: string | null;
  setCurrentLifterId: (id: string | null) => void;
  refereeSignals: RefSignal[];
  setRefereeSignals: (signals: RefSignal[]) => void;
  refereeInputLocked: boolean;
  setRefereeInputLocked: (locked: boolean) => void;
  currentLift: LiftType;
  setCurrentLift: (lift: LiftType) => void;
  currentAttemptIndex: number;
  setCurrentAttemptIndex: (index: number) => void;
  competitionStarted: boolean;
  setCompetitionStarted: (started: boolean) => void;
  includeCollars: boolean;
  setIncludeCollars: (include: boolean) => void;
  competitionMode: CompetitionMode;
  setCompetitionMode: (mode: CompetitionMode) => void;
  /** When set, session order / platform flow is limited to this group name (from "Start competition" on Groups). */
  activeCompetitionGroupName: string | null;
  setActiveCompetitionGroupName: (name: string | null) => void;
  setNextAttemptQueue: (queue: NextAttemptEntry[]) => void;
  timerPhase: TimerPhase;
  timerEndsAt: number | null;
  setTimerState: (phase: TimerPhase, endsAt: number | null) => void;
  startAttemptClock: () => void;
  startNextAttemptClock: () => void;
  clearTimerState: () => void;
  nextAttemptQueue: NextAttemptEntry[];
  submitNextAttempt: (weight: number) => { ok: boolean; message: string };
  updateAttemptForLifter: (
    lifterId: string,
    lift: LiftType,
    attemptIndex: number,
    weight: number | "",
  ) => { ok: boolean; message: string };
  applyRefereeDecision: (overrideSignals?: RefSignal[]) => void;
  resetSignals: () => void;
  connectedRefereeSlots: ConnectedRefereeSlots;
  publishRefereeSignal: (position: number, signal: RefSignal) => Promise<void>;
  trackRefereePresence: (position: number) => Promise<void>;
  untrackRefereePresence: () => void;
};

type PersistedState = {
  lifters: Lifter[];
  groups: Group[];
  currentLifterId: string | null;
  refereeSignals: RefSignal[];
  refereeInputLocked: boolean;
  currentLift: LiftType;
  currentAttemptIndex: number;
  competitionStarted: boolean;
  includeCollars: boolean;
  timerPhase: TimerPhase;
  timerEndsAt: number | null;
  competitionMode: CompetitionMode;
  /** null = full meet; non-null = only this group's lifters in control / flight order */
  activeCompetitionGroupName: string | null;
  nextAttemptQueue: NextAttemptEntry[];
};

type CompetitionRecord = PersistedState & {
  id: string;
  name: string;
  createdAt: number;
};

type StoredState = {
  competitions?: Partial<CompetitionRecord>[];
  activeCompetitionId?: string | null;
} & Partial<PersistedState>;

const SYNC_KEY = "powerliftinglive.sync";
const STORAGE_KEY = "powerliftinglive.state";
const ONE_MINUTE_MS = 60_000;
const REFEREE_CONFIRM_DELAY_MS = 1000;
const BAR_WEIGHT_KG = 20;
const COLLAR_PER_SIDE_KG = 2.5;
const COLLAR_PAIR_KG = COLLAR_PER_SIDE_KG * 2;

const DISPLAY_THEME_ORDER: DisplayThemeKey[] = ["black", "white", "royal", "emerald", "sepia", "crimson", "graphite"];
const DISPLAY_THEME_CONFIG: Record<
  DisplayThemeKey,
  {
    label: string;
    tone: "dark" | "light";
    rootClass: string;
    buttonClass: string;
  }
> = {
  black: {
    label: "Black",
    tone: "dark",
    rootClass: "bg-[#050816] text-white",
    buttonClass:
      "fixed right-4 top-4 z-40 rounded-lg border border-white/20 bg-black/60 px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-white",
  },
  white: {
    label: "White",
    tone: "light",
    rootClass: "bg-[#f4f4ef] text-black",
    buttonClass:
      "fixed right-4 top-4 z-40 rounded-lg border border-black/20 bg-white/85 px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-black",
  },
  royal: {
    label: "Royal Blue",
    tone: "dark",
    rootClass: "bg-[#0f1f4d] text-white",
    buttonClass:
      "fixed right-4 top-4 z-40 rounded-lg border border-cyan-300/40 bg-[#0b1636]/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-cyan-100",
  },
  emerald: {
    label: "Emerald",
    tone: "dark",
    rootClass: "bg-[#042f2e] text-emerald-50",
    buttonClass:
      "fixed right-4 top-4 z-40 rounded-lg border border-emerald-200/30 bg-[#02211f]/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-emerald-100",
  },
  sepia: {
    label: "Sepia",
    tone: "light",
    rootClass: "bg-[#f2ead8] text-[#2e261d]",
    buttonClass:
      "fixed right-4 top-4 z-40 rounded-lg border border-[#6a5a42]/30 bg-[#f5eddc]/90 px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-[#3a2f20]",
  },
  crimson: {
    label: "Crimson",
    tone: "dark",
    rootClass: "bg-[#2b0712] text-rose-50",
    buttonClass:
      "fixed right-4 top-4 z-40 rounded-lg border border-rose-300/35 bg-[#3a0a18]/85 px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-rose-100",
  },
  graphite: {
    label: "Graphite",
    tone: "dark",
    rootClass: "bg-[#15181d] text-slate-100",
    buttonClass:
      "fixed right-4 top-4 z-40 rounded-lg border border-slate-300/25 bg-[#0f1216]/85 px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-100",
  },
};

const LOT_NUMBER_OPTIONS = Array.from({ length: 40 }, (_, index) => index + 1);

const socket = {
  emit: (event: string, data: unknown) => {
    const payload = { event, data, ts: Date.now() };
    window.dispatchEvent(new CustomEvent(event, { detail: data }));
    localStorage.setItem(SYNC_KEY, JSON.stringify(payload));
  },
  on: (event: string, callback: (data: any) => void) => {
    const localHandler = (e: Event) => callback((e as CustomEvent).detail);
    const storageHandler = (e: Event) => {
      const storageEvent = e as StorageEvent;
      if (storageEvent.key !== SYNC_KEY || !storageEvent.newValue) return;
      const payload = JSON.parse(storageEvent.newValue);
      if (payload.event === event) callback(payload.data);
    };
    window.addEventListener(event, localHandler);
    window.addEventListener("storage", storageHandler);
    return { localHandler, storageHandler };
  },
  off: (event: string, handlers: { localHandler: EventListener; storageHandler: EventListener }) => {
    window.removeEventListener(event, handlers.localHandler);
    window.removeEventListener("storage", handlers.storageHandler);
  },
};

const defaultGroups: Group[] = [];

const REFEREE_SLOT_CONFIG: { key: RefereeSlot; label: string; index: number }[] = [
  { key: "left", label: "Left", index: 0 },
  { key: "center", label: "Center", index: 1 },
  { key: "right", label: "Right", index: 2 },
];

const getRefereeConfig = (slot: string | undefined) =>
  REFEREE_SLOT_CONFIG.find((entry) => entry.key === slot);

const REFEREE_PRESENCE_PREFIX = "powerliftinglive.refereePresence";
const REFEREE_HEARTBEAT_MS = 2000;
const REFEREE_PRESENCE_TTL_MS = 7000;
const REMOTE_RELAY_BASE = "https://ntfy.sh";
const REMOTE_RELAY_PREFIX = "powerliftingcomp";

type RefereePresenceMap = Partial<Record<RefereeSlot, number>>;

const getRefereePresenceKey = (competitionId: string | null) =>
  `${REFEREE_PRESENCE_PREFIX}.${competitionId ?? "none"}`;

const readRefereePresence = (competitionId: string | null): RefereePresenceMap => {
  if (!competitionId) return {};
  try {
    const raw = localStorage.getItem(getRefereePresenceKey(competitionId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as RefereePresenceMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writeRefereePresence = (competitionId: string | null, presence: RefereePresenceMap) => {
  if (!competitionId) return;
  localStorage.setItem(getRefereePresenceKey(competitionId), JSON.stringify(presence));
};

const countConnectedReferees = (competitionId: string | null) => {
  const now = Date.now();
  const presence = readRefereePresence(competitionId);
  return REFEREE_SLOT_CONFIG.filter((slot) => {
    const ts = presence[slot.key];
    return typeof ts === "number" && now - ts <= REFEREE_PRESENCE_TTL_MS;
  }).length;
};

const encodeUrlSeed = (value: unknown) => {
  try {
    const json = JSON.stringify(value);
    return btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  } catch {
    return "";
  }
};

const decodeUrlSeed = <T,>(raw: string): T | null => {
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + "=".repeat(padLength);
    const decoded = decodeURIComponent(escape(atob(padded)));
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
};

const getHashSearchParams = () => {
  const hash = window.location.hash;
  const queryIndex = hash.indexOf("?");
  if (queryIndex === -1) return new URLSearchParams();
  return new URLSearchParams(hash.slice(queryIndex + 1));
};

const toRelayTopic = (competitionId: string | null) => {
  if (!competitionId) return "";
  const cleaned = competitionId.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 80);
  return `${REMOTE_RELAY_PREFIX}-${cleaned}`;
};

const createEmptyCompetitionState = (): PersistedState => ({
  lifters: [],
  groups: [],
  currentLifterId: null,
  refereeSignals: [null, null, null],
  refereeInputLocked: false,
  currentLift: "squat",
  currentAttemptIndex: 0,
  competitionStarted: false,
  includeCollars: false,
  timerPhase: "IDLE",
  timerEndsAt: null,
  competitionMode: "FULL_GAME",
  activeCompetitionGroupName: null,
  nextAttemptQueue: [],
});

const normalizeCompetitionRecord = (raw: Partial<CompetitionRecord>): CompetitionRecord => {
  const base = createEmptyCompetitionState();
  const lifters = (raw.lifters ?? base.lifters).map((l) => normalizeLifter(l));
  return {
    id: raw.id ?? `comp-${Date.now()}`,
    name: raw.name?.trim() || "Untitled Competition",
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    lifters,
    groups: (raw.groups ?? base.groups).map((g) => normalizeGroup(g)),
    currentLifterId: raw.currentLifterId ?? lifters[0]?.id ?? null,
    refereeSignals: raw.refereeSignals ?? base.refereeSignals,
    refereeInputLocked:
      typeof raw.refereeInputLocked === "boolean" ? raw.refereeInputLocked : base.refereeInputLocked,
    currentLift: raw.currentLift ?? base.currentLift,
    currentAttemptIndex: typeof raw.currentAttemptIndex === "number" ? raw.currentAttemptIndex : base.currentAttemptIndex,
    competitionStarted: typeof raw.competitionStarted === "boolean" ? raw.competitionStarted : base.competitionStarted,
    includeCollars: typeof raw.includeCollars === "boolean" ? raw.includeCollars : base.includeCollars,
    timerPhase: raw.timerPhase ?? base.timerPhase,
    timerEndsAt: typeof raw.timerEndsAt === "number" || raw.timerEndsAt === null ? raw.timerEndsAt : base.timerEndsAt,
    competitionMode: raw.competitionMode ?? base.competitionMode,
    activeCompetitionGroupName:
      typeof raw.activeCompetitionGroupName === "string"
        ? raw.activeCompetitionGroupName
        : raw.activeCompetitionGroupName === null
          ? null
          : base.activeCompetitionGroupName,
    nextAttemptQueue: raw.nextAttemptQueue ?? base.nextAttemptQueue,
  };
};

const emptyAttemptsFromFirst = (first: number | ""): Attempt[] => [
  { weight: first, status: first === "" ? "UNATTEMPTED" : "PENDING" },
  { weight: "", status: "UNATTEMPTED" },
  { weight: "", status: "UNATTEMPTED" },
];

const getIPFWeightClass = (sex: "Male" | "Female", bw: number | "") => {
  if (bw === "" || bw <= 0) return "";
  if (sex === "Male") {
    if (bw < 53) return "Under 53kg";
    if (bw <= 53) return "53kg";
    if (bw <= 59) return "59kg";
    if (bw <= 66) return "66kg";
    if (bw <= 74) return "74kg";
    if (bw <= 83) return "83kg";
    if (bw <= 93) return "93kg";
    if (bw <= 105) return "105kg";
    if (bw <= 120) return "120kg";
    return "120kg+";
  }
  if (bw <= 43) return "43kg (Sub/Jr)";
  if (bw <= 47) return "47kg";
  if (bw <= 52) return "52kg";
  if (bw <= 57) return "57kg";
  if (bw <= 63) return "63kg";
  if (bw <= 69) return "69kg";
  if (bw <= 76) return "76kg";
  if (bw <= 84) return "84kg";
  return "84kg+";
};

const resolveWeightClass = (sex: "Male" | "Female", bw: number | "", manualWeightClass: string) => {
  const manual = manualWeightClass.trim();
  if (manual) return manual;
  return getIPFWeightClass(sex, bw);
};

const getCategoryOptions = (sex: "Male" | "Female") => {
  const suffix = sex === "Male" ? "Men" : "Women";
  return [
    `Sub-Junior ${suffix}`,
    `Junior ${suffix}`,
    `Senior ${suffix}`,
    `Master 1 ${suffix}`,
    `Master 2 ${suffix}`,
    `Master 3 ${suffix}`,
    `Master 4 ${suffix}`,
    `Sub-Junior ${suffix} + Junior ${suffix}`,
    `Junior ${suffix} + Senior ${suffix}`,
    `Senior ${suffix} + Master ${suffix}`,
  ];
};

const getDoubleCategoryOptions = (sex: "Male" | "Female") => {
  const suffix = sex === "Male" ? "Men" : "Women";
  return [
    `Sub-Junior ${suffix} + Junior ${suffix}`,
    `Junior ${suffix} + Senior ${suffix}`,
    `Senior ${suffix} + Master ${suffix}`,
  ];
};

const INDIA_LOCATIONS = [
  ...indiaStateDistrictData.states,
  ...indiaStateDistrictData.union_territories,
];

const INDIA_STATES = INDIA_LOCATIONS.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));

const INDIA_DISTRICTS: Record<string, string[]> = INDIA_LOCATIONS.reduce<Record<string, string[]>>((acc, entry) => {
  acc[entry.name] = [...entry.districts].sort((a, b) => a.localeCompare(b));
  return acc;
}, {});

const MANUAL_WEIGHT_CLASSES = [
  "Under 53kg",
  "53kg",
  "59kg",
  "66kg",
  "74kg",
  "83kg",
  "93kg",
  "105kg",
  "120kg",
  "120kg+",
  "43kg",
  "47kg",
  "52kg",
  "57kg",
  "63kg",
  "69kg",
  "76kg",
  "84kg",
  "84kg+",
];

const normalizeAttempts = (attempts: Attempt[] | undefined) => {
  const base = attempts && attempts.length ? [...attempts] : [];
  const normalizeWeight = (value: unknown): number | "" => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return "";
  };

  return [0, 1, 2].map((i) => ({
    weight: normalizeWeight(base[i]?.weight),
    status: base[i]?.status ?? "UNATTEMPTED",
  })) as Attempt[];
};

const normalizeGroup = (group: Partial<Group>): Group => ({
  id: group.id ?? `group-${Date.now()}`,
  name: group.name ?? "A",
  currentLift: group.currentLift ?? "squat",
});

const normalizeLifter = (raw: Partial<Lifter>): Lifter => {
  const sex = raw.sex === "Female" ? "Female" : "Male";
  const parseNumberOrEmpty = (value: unknown): number | "" => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return "";
  };
  const bodyweight = parseNumberOrEmpty(raw.bodyweight);
  const manualWeightClass = raw.manualWeightClass ?? "";
  return {
    id: raw.id ?? Date.now().toString(),
    name: raw.name ?? "",
    sex,
    dob: raw.dob ?? "",
    bodyweight,
    weightClass: raw.weightClass ?? resolveWeightClass(sex, bodyweight, manualWeightClass),
    manualWeightClass,
    isEquipped: Boolean(raw.isEquipped),
    disqualified: Boolean(raw.disqualified),
    category: raw.category ?? getCategoryOptions(sex)[0],
    group: raw.group ?? "",
    team: raw.team ?? "",
    rackHeightSquat: parseNumberOrEmpty(raw.rackHeightSquat),
    rackHeightBench: parseNumberOrEmpty(raw.rackHeightBench),
    lot: parseNumberOrEmpty(raw.lot),
    squatAttempts: normalizeAttempts(raw.squatAttempts),
    benchAttempts: normalizeAttempts(raw.benchAttempts),
    deadliftAttempts: normalizeAttempts(raw.deadliftAttempts),
  };
};

const getAttempts = (lifter: Lifter, lift: LiftType) => {
  if (lift === "squat") return lifter.squatAttempts;
  if (lift === "bench") return lifter.benchAttempts;
  return lifter.deadliftAttempts;
};

const setAttempts = (lifter: Lifter, lift: LiftType, attempts: Attempt[]): Lifter => {
  if (lift === "squat") return { ...lifter, squatAttempts: attempts };
  if (lift === "bench") return { ...lifter, benchAttempts: attempts };
  return { ...lifter, deadliftAttempts: attempts };
};

const resolveStageForNextAttempt = (
  lift: LiftType,
  attemptIndex: number,
  competitionMode: CompetitionMode,
): { lift: LiftType; attemptIndex: number } | null => {
  if (competitionMode === "BENCH_ONLY") {
    if (attemptIndex < 2) return { lift: "bench", attemptIndex: attemptIndex + 1 };
    return null;
  }

  if (lift === "squat") {
    if (attemptIndex < 2) return { lift: "squat", attemptIndex: attemptIndex + 1 };
    return { lift: "bench", attemptIndex: 0 };
  }
  if (lift === "bench") {
    if (attemptIndex < 2) return { lift: "bench", attemptIndex: attemptIndex + 1 };
    return { lift: "deadlift", attemptIndex: 0 };
  }
  if (attemptIndex < 2) return { lift: "deadlift", attemptIndex: attemptIndex + 1 };
  return null;
};

const getAttemptValue = (lifter: Lifter, lift: LiftType, attemptIndex: number) => {
  const attempt = getAttempts(lifter, lift)[attemptIndex];
  if (typeof attempt?.weight === "number" && Number.isFinite(attempt.weight)) return attempt.weight;
  if (typeof attempt?.weight === "string" && attempt.weight.trim() !== "") {
    const parsed = Number(attempt.weight);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const getBodyweightValue = (lifter: Lifter) => {
  if (typeof lifter.bodyweight === "number" && Number.isFinite(lifter.bodyweight) && lifter.bodyweight > 0) {
    return lifter.bodyweight;
  }
  return Number.POSITIVE_INFINITY;
};

const orderLiftersByIPF = (lifters: Lifter[], lift: LiftType, attemptIndex: number) =>
  [...lifters]
    .filter((lifter) => !lifter.disqualified)
    .sort((a, b) => {
      const weightA = getAttemptValue(a, lift, attemptIndex);
      const weightB = getAttemptValue(b, lift, attemptIndex);
      const hasWeightA = weightA !== null;
      const hasWeightB = weightB !== null;

      if (hasWeightA && hasWeightB && weightA !== weightB) return Number(weightA) - Number(weightB);
      if (hasWeightA !== hasWeightB) return hasWeightA ? -1 : 1;

      const bodyweightA = getBodyweightValue(a);
      const bodyweightB = getBodyweightValue(b);
      if (bodyweightA !== bodyweightB) return bodyweightA - bodyweightB;

      const lotA = typeof a.lot === "number" ? a.lot : Number.POSITIVE_INFINITY;
      const lotB = typeof b.lot === "number" ? b.lot : Number.POSITIVE_INFINITY;
      if (lotA !== lotB) return lotA - lotB;
      return a.name.localeCompare(b.name);
    });

const getStageSequence = (competitionMode: CompetitionMode): { lift: LiftType; attemptIndex: number }[] =>
  competitionMode === "BENCH_ONLY"
    ? [
        { lift: "bench", attemptIndex: 0 },
        { lift: "bench", attemptIndex: 1 },
        { lift: "bench", attemptIndex: 2 },
      ]
    : [
        { lift: "squat", attemptIndex: 0 },
        { lift: "squat", attemptIndex: 1 },
        { lift: "squat", attemptIndex: 2 },
        { lift: "bench", attemptIndex: 0 },
        { lift: "bench", attemptIndex: 1 },
        { lift: "bench", attemptIndex: 2 },
        { lift: "deadlift", attemptIndex: 0 },
        { lift: "deadlift", attemptIndex: 1 },
        { lift: "deadlift", attemptIndex: 2 },
      ];

const getStageRank = (entry: NextAttemptEntry, competitionMode: CompetitionMode) => {
  const sequence = getStageSequence(competitionMode);
  const idx = sequence.findIndex((stage) => stage.lift === entry.lift && stage.attemptIndex === entry.attemptIndex);
  return idx >= 0 ? idx : Number.POSITIVE_INFINITY;
};

const sortNextAttemptQueue = (
  entries: NextAttemptEntry[],
  lifters: Lifter[],
  competitionMode: CompetitionMode,
) => {
  const unique = new Map<string, NextAttemptEntry>();
  entries.forEach((entry) => {
    unique.set(`${entry.lifterId}-${entry.lift}-${entry.attemptIndex}`, entry);
  });
  return [...unique.values()].sort((a, b) => {
    const rankA = getStageRank(a, competitionMode);
    const rankB = getStageRank(b, competitionMode);
    if (rankA !== rankB) return rankA - rankB;

    const lifterA = lifters.find((lifter) => lifter.id === a.lifterId);
    const lifterB = lifters.find((lifter) => lifter.id === b.lifterId);
    if (!lifterA && !lifterB) return 0;
    if (!lifterA) return 1;
    if (!lifterB) return -1;

    const weightA = getAttemptValue(lifterA, a.lift, a.attemptIndex);
    const weightB = getAttemptValue(lifterB, b.lift, b.attemptIndex);
    const hasWeightA = weightA !== null;
    const hasWeightB = weightB !== null;
    if (hasWeightA && hasWeightB && Number(weightA) !== Number(weightB)) return Number(weightA) - Number(weightB);
    if (hasWeightA !== hasWeightB) return hasWeightA ? -1 : 1;

    const bodyweightA = getBodyweightValue(lifterA);
    const bodyweightB = getBodyweightValue(lifterB);
    if (bodyweightA !== bodyweightB) return bodyweightA - bodyweightB;

    const lotA = typeof lifterA.lot === "number" ? lifterA.lot : Number.POSITIVE_INFINITY;
    const lotB = typeof lifterB.lot === "number" ? lifterB.lot : Number.POSITIVE_INFINITY;
    if (lotA !== lotB) return lotA - lotB;
    return lifterA.name.localeCompare(lifterB.name);
  });
};

const derivePendingNextAttemptQueue = (lifters: Lifter[], competitionMode: CompetitionMode): NextAttemptEntry[] => {
  const sequence = getStageSequence(competitionMode);
  const pending: NextAttemptEntry[] = [];

  lifters.forEach((lifter) => {
    if (lifter.disqualified) return;
    for (let idx = 0; idx < sequence.length - 1; idx += 1) {
      const stage = sequence[idx];
      const nextStage = sequence[idx + 1];
      const stageAttempt = getAttempts(lifter, stage.lift)[stage.attemptIndex];
      const nextAttempt = getAttempts(lifter, nextStage.lift)[nextStage.attemptIndex];
      if (!stageAttempt || !nextAttempt) continue;
      const stageDone = stageAttempt.status === "GOOD" || stageAttempt.status === "NO";
      if (!stageDone) continue;
      if (nextAttempt.weight !== "") continue;
      pending.push({ lifterId: lifter.id, lift: nextStage.lift, attemptIndex: nextStage.attemptIndex });
    }
  });

  return sortNextAttemptQueue(pending, lifters, competitionMode);
};

const isPendingQueueEntry = (entry: NextAttemptEntry, lifters: Lifter[]) => {
  const lifter = lifters.find((row) => row.id === entry.lifterId);
  if (!lifter || lifter.disqualified) return false;
  const attempt = getAttempts(lifter, entry.lift)[entry.attemptIndex];
  if (!attempt) return false;
  return attempt.weight === "";
};

const resolveAttemptWeight = (lifter: Lifter, lift: LiftType, attemptIndex: number) => {
  const attempts = getAttempts(lifter, lift);
  const asNumber = (value: number | "" | string | undefined) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  const selectedWeight = attempts[attemptIndex]?.weight;
  const selectedNumber = asNumber(selectedWeight as number | "" | string | undefined);
  if (selectedNumber !== null) return selectedNumber;

  for (let i = attemptIndex - 1; i >= 0; i -= 1) {
    const previousWeight = asNumber(attempts[i]?.weight as number | "" | string | undefined);
    if (previousWeight !== null) return previousWeight;
  }

  for (let i = attemptIndex + 1; i < attempts.length; i += 1) {
    const nextWeight = asNumber(attempts[i]?.weight as number | "" | string | undefined);
    if (nextWeight !== null) return nextWeight;
  }

  return 20;
};

const AppContext = createContext<AppContextValue | null>(null);

const useAppContext = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("App context unavailable");
  return ctx;
};

const AppProvider = ({ children }: { children: React.ReactNode }) => {
  const seedAppliedRef = useRef(false);
  const relayClientIdRef = useRef(`relay-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`);
  const deviceIdRef = useRef(`device-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`);
  const [connectedRefereeSlots, setConnectedRefereeSlots] = useState<ConnectedRefereeSlots>({
    left: false,
    center: false,
    right: false,
  });
  const [competitions, setCompetitionsState] = useState<CompetitionRecord[]>([]);
  const [activeCompetitionId, setActiveCompetitionIdState] = useState<string | null>(null);
  const [lifters, setLiftersState] = useState<Lifter[]>([]);
  const [groups, setGroupsState] = useState<Group[]>(defaultGroups);
  const [currentLifterId, setCurrentLifterIdState] = useState<string | null>(null);
  const [refereeSignals, setRefereeSignalsState] = useState<RefSignal[]>([null, null, null]);
  const [refereeInputLocked, setRefereeInputLockedState] = useState(false);
  const [currentLift, setCurrentLiftState] = useState<LiftType>("squat");
  const [currentAttemptIndex, setCurrentAttemptIndexState] = useState(0);
  const [competitionStarted, setCompetitionStartedState] = useState(false);
  const [includeCollars, setIncludeCollarsState] = useState(false);
  const [timerPhase, setTimerPhaseState] = useState<TimerPhase>("IDLE");
  const [timerEndsAt, setTimerEndsAtState] = useState<number | null>(null);
  const [competitionMode, setCompetitionModeState] = useState<CompetitionMode>("FULL_GAME");
  const [nextAttemptQueue, setNextAttemptQueueState] = useState<NextAttemptEntry[]>([]);
  const [activeCompetitionGroupName, setActiveCompetitionGroupNameState] = useState<string | null>(null);

  const onCompetitionsLoaded = useCallback((loadedComps: CompetitionRecord[]) => {
    if (loadedComps.length === 0) return;
    const normalized = loadedComps.map((c) => normalizeCompetitionRecord(c));
    setCompetitionsState(normalized);
    if (normalized.length > 0) {
      const first = normalized[0];
      setActiveCompetitionIdState(first.id);
      setLiftersState(first.lifters);
      setGroupsState(first.groups);
      setCurrentLifterIdState(first.currentLifterId ?? first.lifters[0]?.id ?? null);
      setRefereeSignalsState(first.refereeSignals);
      setRefereeInputLockedState(first.refereeInputLocked);
      setCurrentLiftState(first.currentLift);
      setCurrentAttemptIndexState(first.currentAttemptIndex);
      setCompetitionStartedState(first.competitionStarted);
      setIncludeCollarsState(first.includeCollars);
      setTimerPhaseState(first.timerPhase);
      setTimerEndsAtState(first.timerEndsAt);
      setCompetitionModeState(first.competitionMode);
      setNextAttemptQueueState(first.nextAttemptQueue);
      setActiveCompetitionGroupNameState(first.activeCompetitionGroupName ?? null);
    }
  }, []);

  const onRefereeSignalsChanged = useCallback((signals: RefSignal[]) => {
    setRefereeSignalsState(signals);
    socket.emit("SYNC_STATE", { refereeSignals: signals });
  }, []);

  const onDevicesChanged = useCallback((devices: ConnectedRefereeSlots) => {
    setConnectedRefereeSlots(devices);
  }, []);

  const {
    publishSignal,
    clearSignals,
    createCompetitionInDb,
    deleteCompetitionFromDb,
    updateCompetitionNameInDb,
    trackPresence,
    untrackPresence,
  } = useSupabaseSync(
    activeCompetitionId,
    competitions,
    lifters,
    groups,
    refereeSignals,
    { onCompetitionsLoaded, onRefereeSignalsChanged, onDevicesChanged },
    deviceIdRef.current
  );

  const hydrateCompetition = (competition: CompetitionRecord | null) => {
    if (!competition) {
      const empty = createEmptyCompetitionState();
      setLiftersState(empty.lifters);
      setGroupsState(empty.groups);
      setCurrentLifterIdState(empty.currentLifterId);
      setRefereeSignalsState(empty.refereeSignals);
      setRefereeInputLockedState(empty.refereeInputLocked);
      setCurrentLiftState(empty.currentLift);
      setCurrentAttemptIndexState(empty.currentAttemptIndex);
      setCompetitionStartedState(empty.competitionStarted);
      setIncludeCollarsState(empty.includeCollars);
      setTimerPhaseState(empty.timerPhase);
      setTimerEndsAtState(empty.timerEndsAt);
      setCompetitionModeState(empty.competitionMode);
      setNextAttemptQueueState(empty.nextAttemptQueue);
      setActiveCompetitionGroupNameState(empty.activeCompetitionGroupName);
      return;
    }

    setLiftersState(competition.lifters);
    setGroupsState(competition.groups);
    setCurrentLifterIdState(competition.currentLifterId ?? competition.lifters[0]?.id ?? null);
    setRefereeSignalsState(competition.refereeSignals);
    setRefereeInputLockedState(competition.refereeInputLocked);
    setCurrentLiftState(competition.currentLift);
    setCurrentAttemptIndexState(competition.currentAttemptIndex);
    setCompetitionStartedState(competition.competitionStarted);
    setIncludeCollarsState(competition.includeCollars);
    setTimerPhaseState(competition.timerPhase);
    setTimerEndsAtState(competition.timerEndsAt);
    setCompetitionModeState(competition.competitionMode);
    setNextAttemptQueueState(competition.nextAttemptQueue);
    setActiveCompetitionGroupNameState(competition.activeCompetitionGroupName ?? null);
  };

  const applyIncomingState = useCallback((data: Partial<AppContextValue>) => {
    if (Array.isArray((data as { competitions?: unknown }).competitions)) {
      const incomingCompetitions = (data as { competitions?: CompetitionRecord[] }).competitions ?? [];
      setCompetitionsState(incomingCompetitions.map((competition) => normalizeCompetitionRecord(competition)));
    }
    if (typeof (data as { activeCompetitionId?: string | null }).activeCompetitionId !== "undefined") {
      setActiveCompetitionIdState((data as { activeCompetitionId?: string | null }).activeCompetitionId ?? null);
    }
    if (data.lifters) setLiftersState(data.lifters.map((l) => normalizeLifter(l)));
    if (data.groups) setGroupsState(data.groups.map((g) => normalizeGroup(g)));
    if (typeof data.currentLifterId !== "undefined") setCurrentLifterIdState(data.currentLifterId);
    if (data.refereeSignals) setRefereeSignalsState(data.refereeSignals);
    if (typeof data.refereeInputLocked === "boolean") setRefereeInputLockedState(data.refereeInputLocked);
    if (data.currentLift) setCurrentLiftState(data.currentLift);
    if (typeof data.currentAttemptIndex === "number") setCurrentAttemptIndexState(data.currentAttemptIndex);
    if (typeof data.competitionStarted === "boolean") setCompetitionStartedState(data.competitionStarted);
    if (typeof data.includeCollars === "boolean") setIncludeCollarsState(data.includeCollars);
    if (data.timerPhase) setTimerPhaseState(data.timerPhase);
    if (typeof data.timerEndsAt === "number" || data.timerEndsAt === null) setTimerEndsAtState(data.timerEndsAt);
    if (data.competitionMode === "FULL_GAME" || data.competitionMode === "BENCH_ONLY") {
      setCompetitionModeState(data.competitionMode);
    }
    if (Array.isArray((data as { nextAttemptQueue?: unknown }).nextAttemptQueue)) {
      setNextAttemptQueueState((data as { nextAttemptQueue?: NextAttemptEntry[] }).nextAttemptQueue ?? []);
    }
    const patchGroup = data as { activeCompetitionGroupName?: string | null };
    if (typeof patchGroup.activeCompetitionGroupName === "string" || patchGroup.activeCompetitionGroupName === null) {
      setActiveCompetitionGroupNameState(patchGroup.activeCompetitionGroupName);
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      hydrateCompetition(null);
      return;
    }

    const parsed = JSON.parse(saved) as StoredState;
    if (Array.isArray(parsed.competitions)) {
      const normalizedCompetitions = parsed.competitions.map((competition) =>
        normalizeCompetitionRecord(competition),
      );
      const defaultActiveId =
        parsed.activeCompetitionId && normalizedCompetitions.some((competition) => competition.id === parsed.activeCompetitionId)
          ? parsed.activeCompetitionId
          : normalizedCompetitions[0]?.id ?? null;

      setCompetitionsState(normalizedCompetitions);
      setActiveCompetitionIdState(defaultActiveId);
      const activeCompetition =
        normalizedCompetitions.find((competition) => competition.id === defaultActiveId) ?? null;
      hydrateCompetition(activeCompetition);
      return;
    }

    // Migration path for older single-competition state.
    const migrated = normalizeCompetitionRecord({
      id: `comp-${Date.now()}`,
      name: "Competition 1",
      createdAt: Date.now(),
      lifters: (parsed.lifters ?? []).map((lifter) => normalizeLifter(lifter)),
      groups: (parsed.groups ?? defaultGroups).map((group) => normalizeGroup(group)),
      currentLifterId: parsed.currentLifterId ?? null,
      refereeSignals: parsed.refereeSignals ?? [null, null, null],
      refereeInputLocked: parsed.refereeInputLocked ?? false,
      currentLift: parsed.currentLift ?? "squat",
      currentAttemptIndex: parsed.currentAttemptIndex ?? 0,
      competitionStarted: parsed.competitionStarted ?? false,
      includeCollars: parsed.includeCollars ?? false,
      timerPhase: parsed.timerPhase ?? "IDLE",
      timerEndsAt: parsed.timerEndsAt ?? null,
      competitionMode: parsed.competitionMode ?? "FULL_GAME",
      activeCompetitionGroupName: null,
      nextAttemptQueue: parsed.nextAttemptQueue ?? [],
    });
    setCompetitionsState([migrated]);
    setActiveCompetitionIdState(migrated.id);
    hydrateCompetition(migrated);
  }, []);

  useEffect(() => {
    if (seedAppliedRef.current) return;
    const params = getHashSearchParams();
    const rawSeed = params.get("seed");
    const requestedCid = params.get("cid")?.trim() || "";
    if (!rawSeed) {
      if (requestedCid) {
        const placeholder = normalizeCompetitionRecord({
          ...createEmptyCompetitionState(),
          id: requestedCid,
          name: "Linked Competition",
          createdAt: Date.now(),
        });
        setCompetitionsState((prev) => {
          if (prev.some((competition) => competition.id === requestedCid)) return prev;
          return [...prev, placeholder];
        });
        setActiveCompetitionIdState(requestedCid);
        hydrateCompetition(placeholder);
      }
      seedAppliedRef.current = true;
      return;
    }

    const decoded = decodeUrlSeed<Partial<CompetitionRecord>>(rawSeed);
    if (!decoded) {
      seedAppliedRef.current = true;
      return;
    }

    const seededCompetition = normalizeCompetitionRecord(decoded);
    setCompetitionsState((prev) => {
      const exists = prev.some((competition) => competition.id === seededCompetition.id);
      if (exists) {
        return prev.map((competition) =>
          competition.id === seededCompetition.id ? seededCompetition : competition,
        );
      }
      return [...prev, seededCompetition];
    });
    setActiveCompetitionIdState(seededCompetition.id);
    hydrateCompetition(seededCompetition);
    seedAppliedRef.current = true;
  }, []);

  useEffect(() => {
    if (!lifters.length) {
      if (currentLifterId !== null) setCurrentLifterIdState(null);
      return;
    }
    const pool =
      activeCompetitionGroupName !== null
        ? lifters.filter((l) => l.group === activeCompetitionGroupName)
        : lifters;
    if (!pool.length) {
      if (currentLifterId !== null) setCurrentLifterIdState(null);
      return;
    }
    if (!currentLifterId || !pool.some((l) => l.id === currentLifterId)) {
      setCurrentLifterIdState(pool[0].id);
    }
  }, [lifters, currentLifterId, activeCompetitionGroupName]);

  useEffect(() => {
    if (!activeCompetitionId) return;
    setCompetitionsState((prev) =>
      prev.map((competition) =>
        competition.id === activeCompetitionId
          ? {
              ...competition,
              lifters,
              groups,
              currentLifterId,
              refereeSignals,
              refereeInputLocked,
              currentLift,
              currentAttemptIndex,
              competitionStarted,
              includeCollars,
              timerPhase,
              timerEndsAt,
              competitionMode,
              activeCompetitionGroupName,
              nextAttemptQueue,
            }
          : competition,
      ),
    );
  }, [
    activeCompetitionId,
    lifters,
    groups,
    currentLifterId,
    refereeSignals,
    refereeInputLocked,
    currentLift,
    currentAttemptIndex,
    competitionStarted,
    includeCollars,
    timerPhase,
    timerEndsAt,
    competitionMode,
    activeCompetitionGroupName,
    nextAttemptQueue,
  ]);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        competitions,
        activeCompetitionId,
      }),
    );
  }, [competitions, activeCompetitionId]);

  useEffect(() => {
    const handler = socket.on("SYNC_STATE", (data: Partial<AppContextValue>) => {
      applyIncomingState(data);
    });
    return () => socket.off("SYNC_STATE", handler);
  }, [applyIncomingState]);

  useEffect(() => {
    // Only auto-stop the platform timer. Next-attempt timer can run past zero until next weight is selected.
    if (!timerEndsAt || timerPhase !== "ATTEMPT") return;
    const remainingMs = timerEndsAt - Date.now();
    const timeout = window.setTimeout(() => {
      setTimerPhaseState("IDLE");
      setTimerEndsAtState(null);
      broadcast({ timerPhase: "IDLE", timerEndsAt: null });
    }, Math.max(0, remainingMs) + 60);

    return () => window.clearTimeout(timeout);
  }, [timerEndsAt, timerPhase]);

  useEffect(() => {
    const handleBootstrapMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; payload?: Partial<PersistedState> };
      if (data?.type !== "POWERLIFTING_BOOTSTRAP" || !data.payload) return;
      applyIncomingState(data.payload as Partial<AppContextValue>);
    };

    window.addEventListener("message", handleBootstrapMessage);
    return () => window.removeEventListener("message", handleBootstrapMessage);
  }, [applyIncomingState]);

  useEffect(() => {
    if (!activeCompetitionId) return;
    const topic = toRelayTopic(activeCompetitionId);
    if (!topic) return;

    const source = new EventSource(`${REMOTE_RELAY_BASE}/${topic}/sse`);
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { event?: string; message?: string };
        if (payload.event && payload.event !== "message") return;
        if (typeof payload.message !== "string" || !payload.message.trim()) return;
        const relayMessage = JSON.parse(payload.message) as {
          senderId?: string;
          competitionId?: string;
          patch?: Partial<AppContextValue>;
        };
        if (!relayMessage || relayMessage.senderId === relayClientIdRef.current) return;
        if (relayMessage.competitionId !== activeCompetitionId) return;
        if (relayMessage.patch) applyIncomingState(relayMessage.patch);
      } catch {
        // Ignore malformed relay data from public topic traffic.
      }
    };

    return () => {
      source.close();
    };
  }, [activeCompetitionId, applyIncomingState]);

  const publishRemotePatch = (patch: Partial<AppContextValue>) => {
    if (!activeCompetitionId) return;
    const topic = toRelayTopic(activeCompetitionId);
    if (!topic) return;

    const relayPayload = {
      senderId: relayClientIdRef.current,
      competitionId: activeCompetitionId,
      patch,
      ts: Date.now(),
    };
    fetch(`${REMOTE_RELAY_BASE}/${topic}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(relayPayload),
      keepalive: true,
    }).catch(() => null);
  };

  const broadcast = (next: Partial<AppContextValue>) => {
    socket.emit("SYNC_STATE", next);
    publishRemotePatch(next);
  };

  const setActiveCompetitionGroupName = (name: string | null) => {
    setActiveCompetitionGroupNameState(name);
    broadcast({ activeCompetitionGroupName: name });
  };

  const setNextAttemptQueue = (queue: NextAttemptEntry[]) => {
    setNextAttemptQueueState(queue);
    broadcast({ nextAttemptQueue: queue });
  };

  const activeCompetition =
    competitions.find((competition) => competition.id === activeCompetitionId) ?? null;
  const activeCompetitionName = activeCompetition?.name ?? "No Competition Selected";

  const createCompetition = (name: string) => {
    const nextName = name.trim();
    if (!nextName) {
      return { ok: false, message: "Competition name is required." };
    }
    if (competitions.some((competition) => competition.name.toUpperCase() === nextName.toUpperCase())) {
      return { ok: false, message: "Competition name already exists." };
    }

    const created = normalizeCompetitionRecord({
      ...createEmptyCompetitionState(),
      id: `comp-${Date.now()}`,
      name: nextName,
      createdAt: Date.now(),
    });

    const updatedCompetitions = [...competitions, created];
    setCompetitionsState(updatedCompetitions);
    setActiveCompetitionIdState(created.id);
    hydrateCompetition(created);
    broadcast({
      competitions: updatedCompetitions,
      activeCompetitionId: created.id,
      ...created,
    });
    createCompetitionInDb(created);
    return { ok: true, message: "Competition created.", competitionId: created.id };
  };

  const switchCompetition = (competitionId: string) => {
    const target = competitions.find((competition) => competition.id === competitionId);
    if (!target) return;
    setActiveCompetitionIdState(target.id);
    hydrateCompetition(target);
    broadcast({
      activeCompetitionId: target.id,
      ...target,
    });
  };

  const updateCompetitionName = (competitionId: string, name: string) => {
    const nextName = name.trim();
    if (!nextName) {
      return { ok: false, message: "Competition name is required." };
    }
    if (
      competitions.some(
        (competition) =>
          competition.id !== competitionId &&
          competition.name.toUpperCase() === nextName.toUpperCase(),
      )
    ) {
      return { ok: false, message: "Competition name already exists." };
    }
    const updatedCompetitions = competitions.map((competition) =>
      competition.id === competitionId ? { ...competition, name: nextName } : competition,
    );
    setCompetitionsState(updatedCompetitions);
    broadcast({ competitions: updatedCompetitions });
    updateCompetitionNameInDb(competitionId, nextName);
    return { ok: true, message: "Competition name updated." };
  };

  const deleteCompetition = (competitionId: string) => {
    const updatedCompetitions = competitions.filter((competition) => competition.id !== competitionId);
    const nextActiveId =
      activeCompetitionId === competitionId ? updatedCompetitions[0]?.id ?? null : activeCompetitionId;
    setCompetitionsState(updatedCompetitions);
    setActiveCompetitionIdState(nextActiveId);
    const nextActiveCompetition =
      updatedCompetitions.find((competition) => competition.id === nextActiveId) ?? null;
    hydrateCompetition(nextActiveCompetition);
    broadcast({
      competitions: updatedCompetitions,
      activeCompetitionId: nextActiveId,
      ...(nextActiveCompetition ?? createEmptyCompetitionState()),
    });
    deleteCompetitionFromDb(competitionId);
  };

  const setLifters = (next: Lifter[]) => {
    const normalized = next.map((l) => normalizeLifter(l));
    setLiftersState(normalized);
    broadcast({ lifters: normalized });
  };

  const setGroups = (next: Group[]) => {
    const normalized = next.map((g) => normalizeGroup(g));
    setGroupsState(normalized);
    broadcast({ groups: normalized });
  };

  const setCurrentLifterId = (id: string | null) => {
    setCurrentLifterIdState(id);
    broadcast({ currentLifterId: id });
  };

  const setRefereeSignals = (signals: RefSignal[]) => {
    setRefereeSignalsState(signals);
    broadcast({ refereeSignals: signals });
  };

  const setRefereeInputLocked = (locked: boolean) => {
    setRefereeInputLockedState(locked);
    broadcast({ refereeInputLocked: locked });
  };

  const setCurrentLift = (lift: LiftType) => {
    setCurrentLiftState(lift);
    broadcast({ currentLift: lift });
  };

  const setCurrentAttemptIndex = (index: number) => {
    setCurrentAttemptIndexState(index);
    broadcast({ currentAttemptIndex: index });
  };

  const setCompetitionStarted = (started: boolean) => {
    setCompetitionStartedState(started);
    broadcast({ competitionStarted: started });
  };

  const setIncludeCollars = (include: boolean) => {
    setIncludeCollarsState(include);
    broadcast({ includeCollars: include });
  };

  const setCompetitionMode = (mode: CompetitionMode) => {
    setCompetitionModeState(mode);
    broadcast({ competitionMode: mode });
    if (mode === "BENCH_ONLY") {
      setCurrentLift("bench");
      setCurrentAttemptIndex(0);
    }
  };

  const setTimerState = (phase: TimerPhase, endsAt: number | null) => {
    setTimerPhaseState(phase);
    setTimerEndsAtState(endsAt);
    broadcast({ timerPhase: phase, timerEndsAt: endsAt });
  };

  const startAttemptClock = () => {
    if (!competitionStarted) setCompetitionStarted(true);
    setTimerState("ATTEMPT", Date.now() + ONE_MINUTE_MS);
  };

  const startNextAttemptClock = () => {
    setTimerState("NEXT_ATTEMPT", Date.now() + ONE_MINUTE_MS);
  };

  const clearTimerState = () => {
    setTimerState("IDLE", null);
  };

  const resetSignals = () => {
    setRefereeSignals([null, null, null]);
    clearSignals();
  };

  const submitNextAttempt = (weight: number) => {
    if (weight <= 0) return { ok: false, message: "Weight must be greater than 0." };
    if (Math.round(weight * 10) % 25 !== 0) return { ok: false, message: "Use 2.5kg increments." };
    const idx = lifters.findIndex((l) => l.id === currentLifterId);
    if (idx < 0) return { ok: false, message: "Select a lifter first." };

    const selected = lifters[idx];
    const attempts = [...getAttempts(selected, currentLift)];
    if (currentAttemptIndex > 0) {
      const previous = attempts[currentAttemptIndex - 1];
      if (typeof previous?.weight === "number" && weight < previous.weight) {
        return { ok: false, message: `Next attempt cannot be below ${previous.weight}kg.` };
      }
    }
    attempts[currentAttemptIndex] = { weight, status: "PENDING" };
    const updated = [...lifters];
    updated[idx] = setAttempts(selected, currentLift, attempts);
    setLifters(updated);
    if (timerPhase === "NEXT_ATTEMPT") clearTimerState();
    return { ok: true, message: "Attempt submitted." };
  };

  const updateAttemptForLifter = (lifterId: string, lift: LiftType, attemptIndex: number, weight: number | "") => {
    if (attemptIndex < 0 || attemptIndex > 2) return { ok: false, message: "Invalid attempt index." };
    if (weight !== "") {
      if (weight <= 0) return { ok: false, message: "Weight must be greater than 0." };
      if (Math.round(weight * 10) % 25 !== 0) return { ok: false, message: "Use 2.5kg increments." };
    }
    const idx = lifters.findIndex((l) => l.id === lifterId);
    if (idx < 0) return { ok: false, message: "Lifter not found." };

    const selected = lifters[idx];
    const attempts = [...getAttempts(selected, lift)];
    if (weight !== "" && attemptIndex > 0) {
      const previous = attempts[attemptIndex - 1];
      if (typeof previous?.weight === "number" && weight < previous.weight) {
        return { ok: false, message: `Next attempt cannot be below ${previous.weight}kg.` };
      }
    }
    attempts[attemptIndex] = { weight, status: weight === "" ? "UNATTEMPTED" : "PENDING" };
    const updated = [...lifters];
    updated[idx] = setAttempts(selected, lift, attempts);
    setLifters(updated);

    const remainingQueue = nextAttemptQueue.filter(
      (entry) => !(entry.lifterId === lifterId && entry.lift === lift && entry.attemptIndex === attemptIndex),
    );
    if (remainingQueue.length !== nextAttemptQueue.length) {
      setNextAttemptQueueState(remainingQueue);
      broadcast({ nextAttemptQueue: remainingQueue });
      if (timerPhase === "NEXT_ATTEMPT") {
        if (remainingQueue.length > 0) {
          startNextAttemptClock();
        } else {
          clearTimerState();
        }
      }
    }

    return { ok: true, message: "Attempt updated." };
  };

  const applyRefereeDecision = (overrideSignals?: RefSignal[]) => {
    const idx = lifters.findIndex((l) => l.id === currentLifterId);
    if (idx < 0) return;
    const effectiveSignals = overrideSignals ?? refereeSignals;
    const completed = effectiveSignals.every((s) => s !== null);
    if (!completed) return;

    const noVotes = effectiveSignals.filter((s) => s === "NO").length;
    const status: AttemptStatus = noVotes >= 2 ? "NO" : "GOOD";
    const selected = lifters[idx];
    const attempts = [...getAttempts(selected, currentLift)];
    const currentAttempt = attempts[currentAttemptIndex] ?? { weight: "", status: "UNATTEMPTED" as AttemptStatus };
    attempts[currentAttemptIndex] = { ...currentAttempt, status };

    const updated = [...lifters];
    updated[idx] = setAttempts(selected, currentLift, attempts);

    const sessionLifters =
      activeCompetitionGroupName !== null
        ? updated.filter((l) => l.group === activeCompetitionGroupName)
        : updated;

    const queueForSession =
      activeCompetitionGroupName !== null
        ? nextAttemptQueue.filter((e) => {
            const row = updated.find((l) => l.id === e.lifterId);
            return row ? row.group === activeCompetitionGroupName : false;
          })
        : nextAttemptQueue;

    const orderedFlight = orderLiftersByIPF(sessionLifters, currentLift, currentAttemptIndex);
    if (!orderedFlight.length) return;

    let nextLift = currentLift;
    let nextAttemptIdx = currentAttemptIndex;
    let nextLifterId = currentLifterId ?? orderedFlight[0].id;

    // Always move platform to the lowest valid active attempt in the round.
    // This prevents highlight/platform from sticking to a higher-weight lifter.
    const activeCurrentRound = orderedFlight.filter((lifter) => {
      const attempt = getAttempts(lifter, currentLift)[currentAttemptIndex];
      return attempt?.status !== "GOOD" && attempt?.status !== "NO";
    });

    if (activeCurrentRound.length > 0) {
      nextLifterId = activeCurrentRound[0].id;
    } else {
      const nextStage = resolveStageForNextAttempt(currentLift, currentAttemptIndex, competitionMode);
      if (nextStage) {
        nextLift = nextStage.lift;
        nextAttemptIdx = nextStage.attemptIndex;
        const nextOrder = orderLiftersByIPF(sessionLifters, nextLift, nextAttemptIdx);
        const nextActive = nextOrder.find((lifter) => {
          const attempt = getAttempts(lifter, nextLift)[nextAttemptIdx];
          return attempt?.status !== "GOOD" && attempt?.status !== "NO";
        });
        nextLifterId = nextActive?.id ?? nextOrder[0]?.id ?? nextLifterId;
      }
    }

    const declarationStage = resolveStageForNextAttempt(currentLift, currentAttemptIndex, competitionMode);
    let queueAfter = queueForSession;
    if (declarationStage) {
      const declaredWeight = getAttemptValue(selected, declarationStage.lift, declarationStage.attemptIndex);
      if (declaredWeight === null) {
        const alreadyQueued = queueForSession.some(
          (entry) =>
            entry.lifterId === selected.id &&
            entry.lift === declarationStage.lift &&
            entry.attemptIndex === declarationStage.attemptIndex,
        );
        if (!alreadyQueued) {
          queueAfter = [
            ...queueForSession,
            { lifterId: selected.id, lift: declarationStage.lift, attemptIndex: declarationStage.attemptIndex },
          ];
        }
      }
    }

    const nextIdx = updated.findIndex((l) => l.id === nextLifterId);
    if (nextIdx >= 0) {
      const nextLifter = updated[nextIdx];
      const nextAttempts = [...getAttempts(nextLifter, nextLift)];
      const focusAttempt = nextAttempts[nextAttemptIdx];
      if (focusAttempt) {
        nextAttempts[nextAttemptIdx] = {
          ...focusAttempt,
          status: focusAttempt.weight === "" ? "UNATTEMPTED" : "PENDING",
        };
        updated[nextIdx] = setAttempts(nextLifter, nextLift, nextAttempts);
      }
    }

    setLifters(updated);
    setCurrentLift(nextLift);
    setCurrentAttemptIndex(nextAttemptIdx);
    if (nextLifterId !== currentLifterId) {
      setCurrentLifterId(nextLifterId);
    }
    const normalizedQueue = sortNextAttemptQueue(
      [...queueAfter, ...derivePendingNextAttemptQueue(sessionLifters, competitionMode)],
      updated,
      competitionMode,
    );
    if (JSON.stringify(normalizedQueue) !== JSON.stringify(nextAttemptQueue)) {
      setNextAttemptQueueState(normalizedQueue);
      broadcast({ nextAttemptQueue: normalizedQueue });
    }
    // Decision ends platform time and starts the 1-minute next-attempt declaration time.
    if (normalizedQueue.length > 0) {
      startNextAttemptClock();
    } else {
      clearTimerState();
    }
    resetSignals();
  };

  return (
    <AppContext.Provider
      value={{
        competitions,
        activeCompetitionId,
        activeCompetitionName,
        createCompetition,
        switchCompetition,
        updateCompetitionName,
        deleteCompetition,
        lifters,
        setLifters,
        groups,
        setGroups,
        currentLifterId,
        setCurrentLifterId,
        refereeSignals,
        setRefereeSignals,
        refereeInputLocked,
        setRefereeInputLocked,
        currentLift,
        setCurrentLift,
        currentAttemptIndex,
        setCurrentAttemptIndex,
        competitionStarted,
        setCompetitionStarted,
        includeCollars,
        setIncludeCollars,
        competitionMode,
        setCompetitionMode,
        activeCompetitionGroupName,
        setActiveCompetitionGroupName,
        setNextAttemptQueue,
        timerPhase,
        timerEndsAt,
        setTimerState,
        startAttemptClock,
        startNextAttemptClock,
        clearTimerState,
        nextAttemptQueue,
        submitNextAttempt,
        updateAttemptForLifter,
        applyRefereeDecision,
        resetSignals,
        connectedRefereeSlots,
        publishRefereeSignal: publishSignal,
        trackRefereePresence: trackPresence,
        untrackRefereePresence: untrackPresence,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

const navItems: { to: string; label: string; requiresCompetition?: boolean }[] = [
  { to: "/competitions", label: "Competitions" },
  { to: "/control", label: "Control Center" },
  { to: "/lifters", label: "Manage Lifters", requiresCompetition: true },
  { to: "/groups", label: "Groups", requiresCompetition: true },
  { to: "/signals", label: "Referee Signals" },
  { to: "/screen", label: "Display Screens" },
  { to: "/results", label: "Results", requiresCompetition: true },
  { to: "/settings", label: "Settings + Backup" },
];

const Field = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className="h-11 w-full rounded-xl border border-white/20 bg-white/5 px-3 text-sm text-white outline-none ring-cyan-400 transition focus:ring"
  />
);

const SectionHeader = ({ title }: { title: string; path?: string }) => (
  <div className="mb-6">
    <h1 className="text-2xl font-semibold text-white md:text-3xl">{title}</h1>
  </div>
);

const DashboardLayout = () => {
  const { activeCompetitionId, activeCompetitionName } = useAppContext();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="min-h-screen bg-[#05070f] text-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed left-4 top-4 z-50 rounded-lg border border-white/20 bg-black/60 px-3 py-2 text-sm md:hidden"
      >
        Menu
      </button>

      <aside
        className={`fixed left-0 top-0 z-40 h-full w-72 border-r border-white/10 bg-black/60 p-6 backdrop-blur-xl transition-transform md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-8 mt-10 md:mt-0">
          <h2 className="mt-2 text-2xl font-bold">Powerlifting Competition</h2>
          <p className="mt-2 text-xs text-slate-300">
            {activeCompetitionId ? `Active: ${activeCompetitionName}` : "Create/select a competition"}
          </p>
        </div>
        <nav className="space-y-1">
          {navItems.map((item) => (
            <motion.div key={item.to} whileHover={{ x: 5 }} transition={{ duration: 0.2 }}>
              <NavLink
                to={item.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `block rounded-lg px-3 py-3 text-sm transition ${
                    item.requiresCompetition && !activeCompetitionId ? "opacity-60 " : ""
                  }${
                    isActive ? "bg-cyan-400/20 text-cyan-200" : "text-slate-200 hover:bg-white/10"
                  }`
                }
              >
                {item.label}
              </NavLink>
            </motion.div>
          ))}
        </nav>
      </aside>

      <main className="px-4 pb-8 pt-20 md:ml-72 md:px-8 md:pt-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.24 }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
};

const CompetitionGate = ({ children }: { children: React.ReactNode }) => {
  const { activeCompetitionId } = useAppContext();

  if (activeCompetitionId) return <>{children}</>;

  return (
    <section>
      <SectionHeader title="Competition Required" />
      <div className="rounded-2xl border border-white/15 bg-white/5 p-5 text-slate-200">
        <p className="text-sm">Create or select a competition first to access this tab.</p>
        <Link
          to="/competitions"
          className="mt-4 inline-flex rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-black"
        >
          Open Competitions
        </Link>
      </div>
    </section>
  );
};

const CompetitionPage = () => {
  const {
    competitions,
    activeCompetitionId,
    createCompetition,
    switchCompetition,
    updateCompetitionName,
    deleteCompetition,
  } = useAppContext();
  const [nameInput, setNameInput] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const handleCreate = () => {
    const result = createCompetition(nameInput);
    setNotice(result.message);
    if (result.ok) {
      setNameInput("");
      if (result.competitionId) switchCompetition(result.competitionId);
    }
  };

  const handleDelete = (competitionId: string, competitionName: string) => {
    if (!window.confirm(`Delete competition \"${competitionName}\"?`)) return;
    deleteCompetition(competitionId);
    setNotice("Competition deleted.");
  };

  const handleRename = () => {
    if (!editingId) return;
    const result = updateCompetitionName(editingId, editingName);
    setNotice(result.message);
    if (result.ok) {
      setEditingId(null);
      setEditingName("");
    }
  };

  return (
    <section>
      <SectionHeader title="Competitions" path="/competitions" />
      {notice && (
        <p className="mb-4 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-100">
          {notice}
        </p>
      )}

      <div className="mb-4 rounded-2xl border border-white/15 bg-white/5 p-5">
        <p className="mb-3 text-xs uppercase tracking-[0.2em] text-cyan-300">Create Competition</p>
        <div className="flex flex-wrap items-center gap-3">
          <Field
            placeholder="Competition name"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
          />
          <button
            onClick={handleCreate}
            className="h-11 rounded-xl bg-cyan-500 px-4 text-sm font-semibold text-black"
          >
            Create
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {competitions.map((competition) => {
          const isActive = competition.id === activeCompetitionId;
          return (
            <div
              key={competition.id}
              className={`rounded-2xl border p-4 ${
                isActive ? "border-cyan-400/70 bg-cyan-500/10" : "border-white/15 bg-white/5"
              }`}
            >
              {editingId === competition.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Field value={editingName} onChange={(e) => setEditingName(e.target.value)} />
                  <button onClick={handleRename} className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-black">
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(null);
                      setEditingName("");
                    }}
                    className="rounded-lg bg-white/10 px-3 py-2 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-white">{competition.name}</p>
                    <p className="text-xs text-slate-300">{competition.lifters.length} lifter(s)</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => switchCompetition(competition.id)}
                      className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-black"
                    >
                      {isActive ? "Selected" : "Select"}
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(competition.id);
                        setEditingName(competition.name);
                      }}
                      className="rounded-lg bg-violet-500 px-3 py-2 text-sm font-semibold text-white"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(competition.id, competition.name)}
                      className="rounded-lg bg-rose-500 px-3 py-2 text-sm font-semibold text-white"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {competitions.length === 0 && (
          <div className="rounded-2xl border border-white/15 bg-white/5 p-4 text-sm text-slate-300">
            No competitions created yet.
          </div>
        )}
      </div>
    </section>
  );
};

const ControlPage = () => {
  const {
    lifters,
    setLifters,
    groups,
    currentLifterId,
    setCurrentLifterId,
    currentLift,
    setCurrentLift,
    currentAttemptIndex,
    setCurrentAttemptIndex,
    includeCollars,
    setIncludeCollars,
    competitionMode,
    setCompetitionMode,
    activeCompetitionGroupName,
    setActiveCompetitionGroupName,
    timerPhase,
    timerEndsAt,
    startAttemptClock,
    nextAttemptQueue,
    updateAttemptForLifter,
    applyRefereeDecision,
    resetSignals,
  } = useAppContext();

  const sessionLifters = useMemo(
    () =>
      activeCompetitionGroupName !== null
        ? lifters.filter((l) => l.group === activeCompetitionGroupName)
        : lifters,
    [lifters, activeCompetitionGroupName],
  );
  const [showDecisionButtons, setShowDecisionButtons] = useState(true);
  const [quickWeightDraft, setQuickWeightDraft] = useState<Record<string, string>>({});
  const [actionNotice, setActionNotice] = useState("");
  const [editingOrderLifterId, setEditingOrderLifterId] = useState<string | null>(null);
  const [orderEditAttempt, setOrderEditAttempt] = useState("");
  const [orderEditBodyweight, setOrderEditBodyweight] = useState("");
  const [orderEditLot, setOrderEditLot] = useState("");
  const [ipfOrderSearchTerm, setIpfOrderSearchTerm] = useState("");
  const [updatedOrderLifterId, setUpdatedOrderLifterId] = useState<string | null>(null);
  const [draggingOrderIndex, setDraggingOrderIndex] = useState<number | null>(null);
  const [queueTimerStarts, setQueueTimerStarts] = useState<Record<string, number>>({});
  const [manualOrderByStage, setManualOrderByStage] = useState<Record<string, string[]>>({});
  const previousOrderWeightMapRef = useRef<Record<string, number | null>>({});
  const didInitOrderWeightRef = useRef(false);

  const ipfOrderedLifters = useMemo(
    () => orderLiftersByIPF(sessionLifters, currentLift, currentAttemptIndex),
    [sessionLifters, currentLift, currentAttemptIndex],
  );

  const activeStageLifters = useMemo(
    () =>
      ipfOrderedLifters.filter((lifter) => {
        const attempt = getAttempts(lifter, currentLift)[currentAttemptIndex];
        return attempt?.status !== "GOOD" && attempt?.status !== "NO";
      }),
    [ipfOrderedLifters, currentLift, currentAttemptIndex],
  );

  const stageKey = `${currentLift}-${currentAttemptIndex}`;
  const stageOrderPool = activeStageLifters.length > 0 ? activeStageLifters : ipfOrderedLifters;
  const controlOrderLifters = useMemo(() => {
    const manual = manualOrderByStage[stageKey];
    if (!manual || manual.length === 0) return stageOrderPool;

    const rank = new Map(manual.map((id, idx) => [id, idx]));
    return [...stageOrderPool].sort((a, b) => {
      const idxA = rank.get(a.id);
      const idxB = rank.get(b.id);
      if (typeof idxA === "number" && typeof idxB === "number") return idxA - idxB;
      if (typeof idxA === "number") return -1;
      if (typeof idxB === "number") return 1;
      return 0;
    });
  }, [manualOrderByStage, stageKey, stageOrderPool]);

  useEffect(() => {
    setManualOrderByStage((prev) => {
      const current = prev[stageKey];
      if (!current || current.length === 0) return prev;
      const validIds = new Set(stageOrderPool.map((lifter) => lifter.id));
      const cleaned = current.filter((id) => validIds.has(id));
      const missing = stageOrderPool.map((lifter) => lifter.id).filter((id) => !cleaned.includes(id));
      const merged = [...cleaned, ...missing];
      if (JSON.stringify(merged) === JSON.stringify(current)) return prev;
      return { ...prev, [stageKey]: merged };
    });
  }, [stageKey, stageOrderPool]);

  useEffect(() => {
    const nextMap: Record<string, number | null> = {};
    let changedLifterId: string | null = null;
    controlOrderLifters.forEach((lifter) => {
      const weight = getAttemptValue(lifter, currentLift, currentAttemptIndex);
      nextMap[lifter.id] = weight;
      if (previousOrderWeightMapRef.current[lifter.id] !== weight) {
        changedLifterId = lifter.id;
      }
    });
    if (!didInitOrderWeightRef.current) {
      previousOrderWeightMapRef.current = nextMap;
      didInitOrderWeightRef.current = true;
      return;
    }
    previousOrderWeightMapRef.current = nextMap;
    if (changedLifterId) {
      // If attempts changed, revert this stage to strict IPF order.
      setManualOrderByStage((prev) => {
        if (!prev[stageKey]) return prev;
        const next = { ...prev };
        delete next[stageKey];
        return next;
      });
      setUpdatedOrderLifterId(changedLifterId);
    }
  }, [controlOrderLifters, currentLift, currentAttemptIndex, stageKey]);

  useEffect(() => {
    if (!updatedOrderLifterId) return;
    const timer = window.setTimeout(() => setUpdatedOrderLifterId(null), 1500);
    return () => window.clearTimeout(timer);
  }, [updatedOrderLifterId]);

  const visibleOrderLifters = useMemo(() => {
    const query = ipfOrderSearchTerm.trim().toLowerCase();
    if (!query) return controlOrderLifters;
    return controlOrderLifters.filter((lifter) => {
      const haystack = `${lifter.name} ${lifter.team} ${lifter.group} ${lifter.weightClass} ${lifter.category}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [controlOrderLifters, ipfOrderSearchTerm]);

  const currentLifter = lifters.find((l) => l.id === currentLifterId) ?? null;

  useEffect(() => {
    if (activeCompetitionGroupName) return;
    if (!currentLifter) return;
    if (competitionMode === "BENCH_ONLY") return;

    const linkedGroup = groups.find((group) => group.name === currentLifter.group);
    if (!linkedGroup) return;

    const targetLift = linkedGroup.currentLift;
    if (targetLift === currentLift) return;

    const groupLifters = lifters.filter((lifter) => lifter.group === linkedGroup.name);
    let targetAttemptIndex = 0;
    for (let idx = 0; idx < 3; idx += 1) {
      const hasIncompleteInRound = groupLifters.some((lifter) => {
        const attempt = getAttempts(lifter, targetLift)[idx];
        return attempt?.status !== "GOOD" && attempt?.status !== "NO";
      });
      if (hasIncompleteInRound) {
        targetAttemptIndex = idx;
        break;
      }
    }

    setCurrentLift(targetLift);
    setCurrentAttemptIndex(targetAttemptIndex);
    setActionNotice(`Group stage applied: ${targetLift.toUpperCase()} A${targetAttemptIndex + 1}`);
  }, [activeCompetitionGroupName, competitionMode, currentLifter, currentLift, groups, lifters, setCurrentAttemptIndex, setCurrentLift]);

  useEffect(() => {
    if (timerPhase === "NEXT_ATTEMPT") return;
    if (!activeStageLifters.length) return;

    const activeIds = activeStageLifters.map((lifter) => lifter.id);
    const currentAttempt = currentLifter ? getAttempts(currentLifter, currentLift)[currentAttemptIndex] : null;
    const currentDone = currentAttempt?.status === "GOOD" || currentAttempt?.status === "NO";

    if (!currentLifterId || !activeIds.includes(currentLifterId) || currentDone) {
      setCurrentLifterId(activeStageLifters[0].id);
    }
  }, [activeStageLifters, currentLifterId, currentLifter, currentLift, currentAttemptIndex, timerPhase, setCurrentLifterId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const topLifterId = stageOrderPool[0]?.id ?? null;
      if (topLifterId && topLifterId !== currentLifterId) {
        setCurrentLifterId(topLifterId);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [stageOrderPool, currentLifterId, setCurrentLifterId]);

  const currentDisplayWeight = currentLifter ? resolveAttemptWeight(currentLifter, currentLift, currentAttemptIndex) : 20;
  const loadingDisplayWeight = currentDisplayWeight;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!timerEndsAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [timerEndsAt]);

  const timerRemainingSeconds = timerEndsAt ? Math.max(0, Math.ceil((timerEndsAt - now) / 1000)) : 0;

  const formatSignedTimer = (seconds: number) => {
    const sign = seconds < 0 ? "-" : "";
    const abs = Math.abs(seconds);
    const mins = Math.floor(abs / 60);
    const secs = String(abs % 60).padStart(2, "0");
    return `${sign}${mins}:${secs}`;
  };

  useEffect(() => {
    if (competitionMode === "BENCH_ONLY" && currentLift !== "bench") {
      setCurrentLift("bench");
      setCurrentAttemptIndex(0);
    }
  }, [competitionMode, currentLift, setCurrentLift, setCurrentAttemptIndex]);

  // Build a complete pending declaration list (SQ/BP/DL, A1/A2/A3) for all athletes.
  const pendingQueueEntries = useMemo(() => {
    const queueBase =
      activeCompetitionGroupName !== null
        ? nextAttemptQueue.filter((e) => sessionLifters.some((l) => l.id === e.lifterId))
        : nextAttemptQueue;
    return sortNextAttemptQueue(
      [...queueBase, ...derivePendingNextAttemptQueue(sessionLifters, competitionMode)],
      lifters,
      competitionMode,
    ).filter((entry) => isPendingQueueEntry(entry, lifters));
  }, [nextAttemptQueue, lifters, sessionLifters, competitionMode, activeCompetitionGroupName]);

  const queuedAttemptRows = useMemo(
    () =>
      pendingQueueEntries
        .map((entry) => ({
          entry,
          lifter: lifters.find((item) => item.id === entry.lifterId) ?? null,
        }))
        .filter((row): row is { entry: NextAttemptEntry; lifter: Lifter } => Boolean(row.lifter)),
    [pendingQueueEntries, lifters],
  );

  useEffect(() => {
    if (!queuedAttemptRows.length) {
      setQueueTimerStarts({});
      return;
    }

    setQueueTimerStarts((prev) => {
      const next: Record<string, number> = {};
      queuedAttemptRows.forEach(({ entry }) => {
        const key = `${entry.lifterId}-${entry.lift}-${entry.attemptIndex}`;
        next[key] = prev[key] ?? Date.now();
      });
      return next;
    });
  }, [queuedAttemptRows]);

  useEffect(() => {
    if (!queuedAttemptRows.length) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [queuedAttemptRows.length]);

  const declarationStage = resolveStageForNextAttempt(currentLift, currentAttemptIndex, competitionMode);

  // Keep blue highlight aligned to the currently expected declaration stage
  // (for example SQ A2 -> declare SQ A3), even when the queue shows all pending stages.
  const activeNextAttempt =
    (declarationStage
      ? queuedAttemptRows.find(
          (row) =>
            row.entry.lift === declarationStage.lift &&
            row.entry.attemptIndex === declarationStage.attemptIndex &&
            getAttempts(row.lifter, row.entry.lift)[row.entry.attemptIndex]?.weight === "",
        )?.entry
      : null) ??
    queuedAttemptRows.find((row) => getAttempts(row.lifter, row.entry.lift)[row.entry.attemptIndex]?.weight === "")?.entry ??
    queuedAttemptRows[0]?.entry ??
    null;

  // Keep highlight pinned to the first IPF-sorted row (lowest valid attempt).
  const highlightedOrderLifterId = visibleOrderLifters[0]?.id ?? stageOrderPool[0]?.id ?? currentLifterId;

  const resetControlOrderToIPF = () => {
    setManualOrderByStage((prev) => {
      if (!prev[stageKey]) return prev;
      const next = { ...prev };
      delete next[stageKey];
      return next;
    });
    if (stageOrderPool.length === 0) {
      setActionNotice("No lifters available for ordering.");
      return;
    }
    if (stageOrderPool[0]?.id) {
      setCurrentLifterId(stageOrderPool[0].id);
    }
    setActionNotice("IPF order auto-sorted by attempt, bodyweight, and lot.");
  };

  const reorderCurrentStage = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const ids = controlOrderLifters.map((lifter) => lifter.id);
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= ids.length || toIndex >= ids.length) return;
    const nextIds = [...ids];
    const [moved] = nextIds.splice(fromIndex, 1);
    nextIds.splice(toIndex, 0, moved);
    setManualOrderByStage((prev) => ({ ...prev, [stageKey]: nextIds }));
    setActionNotice("Manual order updated for this stage.");
  };

  const markLifterDisqualified = (lifterId: string) => {
    const target = lifters.find((row) => row.id === lifterId);
    if (!target) return;
    const confirmed = window.confirm(`Disqualify ${target.name}? This removes the lifter from active order.`);
    if (!confirmed) return;
    const updated = lifters.map((row) => (row.id === lifterId ? { ...row, disqualified: true } : row));
    setLifters(updated);
    setActionNotice(`${target.name} marked as disqualified.`);
  };

  const buildQuickWeights = (baseWeight: number, floorWeight: number) => {
    const start = Math.max(20, floorWeight, Math.round((baseWeight - 10) / 2.5) * 2.5);
    return Array.from({ length: 10 }, (_, i) => Number((start + i * 2.5).toFixed(1)));
  };

  const openOrderEdit = (lifter: Lifter) => {
    const currentAttemptWeight = getAttemptValue(lifter, currentLift, currentAttemptIndex);
    setEditingOrderLifterId(lifter.id);
    setOrderEditAttempt(currentAttemptWeight === null ? "" : String(currentAttemptWeight));
    setOrderEditBodyweight(typeof lifter.bodyweight === "number" ? String(lifter.bodyweight) : "");
    setOrderEditLot(typeof lifter.lot === "number" ? String(lifter.lot) : "");
  };

  const cancelOrderEdit = () => {
    setEditingOrderLifterId(null);
    setOrderEditAttempt("");
    setOrderEditBodyweight("");
    setOrderEditLot("");
  };

  const saveOrderEdit = (lifter: Lifter) => {
    const attemptText = orderEditAttempt.trim();
    const bodyweightText = orderEditBodyweight.trim();
    const lotText = orderEditLot.trim();

    let attemptValue: number | "" = "";
    if (attemptText !== "") {
      const parsed = Number(attemptText);
      if (!Number.isFinite(parsed)) {
        setActionNotice("Attempt must be a valid number.");
        return;
      }
      if (Math.round(parsed * 10) % 25 !== 0) {
        setActionNotice("Use 2.5kg increments.");
        return;
      }
      attemptValue = Number(parsed.toFixed(1));
    }

    let bodyweightValue: number | "" = "";
    if (bodyweightText !== "") {
      const parsed = Number(bodyweightText);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setActionNotice("Bodyweight must be greater than 0.");
        return;
      }
      bodyweightValue = Number(parsed.toFixed(2));
    }

    let lotValue: number | "" = "";
    if (lotText !== "") {
      const parsed = Number(lotText);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 40) {
        setActionNotice("Lot must be between 1 and 40.");
        return;
      }
      lotValue = Math.floor(parsed);
    }

    const selected = lifters.find((row) => row.id === lifter.id);
    if (!selected) {
      setActionNotice("Lifter not found.");
      return;
    }
    if (attemptValue !== "" && currentAttemptIndex > 0) {
      const previous = getAttempts(selected, currentLift)[currentAttemptIndex - 1];
      if (typeof previous?.weight === "number" && attemptValue < previous.weight) {
        setActionNotice(`Next attempt cannot be below ${previous.weight}kg.`);
        return;
      }
    }

    // Apply attempt/bodyweight/lot in one state update so IPF ordering stays stable.
    const merged = lifters.map((row) => {
      if (row.id !== lifter.id) return row;
      const attempts = getAttempts(row, currentLift);
      attempts[currentAttemptIndex] = { weight: attemptValue, status: attemptValue === "" ? "UNATTEMPTED" : "PENDING" };
      const withAttempt = setAttempts(row, currentLift, attempts);
      const updatedRow = { ...withAttempt, bodyweight: bodyweightValue, lot: lotValue };
      return {
        ...updatedRow,
        weightClass: resolveWeightClass(updatedRow.sex, updatedRow.bodyweight, updatedRow.manualWeightClass),
      };
    });
    setLifters(merged);

    // Keep platform highlight pinned to the top IPF row after editing attempts
    // from this panel so it never stays on a higher weight by mistake.
    const orderPool =
      activeCompetitionGroupName !== null
        ? merged.filter((l) => l.group === activeCompetitionGroupName)
        : merged;
    const nextActive = orderLiftersByIPF(orderPool, currentLift, currentAttemptIndex).find((row) => {
      const attempt = getAttempts(row, currentLift)[currentAttemptIndex];
      return attempt?.status !== "GOOD" && attempt?.status !== "NO";
    });
    setCurrentLifterId(nextActive?.id ?? orderLiftersByIPF(orderPool, currentLift, currentAttemptIndex)[0]?.id ?? null);

    setActionNotice("Lifter updated. Control, Results, and Display are synced.");
    cancelOrderEdit();
  };

  return (
    <section className="rounded-2xl border border-white/15 bg-white/5 p-4 text-white md:p-7">
      <p className="mb-2 text-center text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">
        Design by SUMIT BHANJA
      </p>
      <h1 className="mb-6 text-center text-3xl font-semibold text-white">Control Center</h1>
      {activeCompetitionGroupName ? (
        <p className="mb-4 text-center text-sm font-medium text-amber-200/95">
          Group session: <span className="font-semibold text-amber-100">{activeCompetitionGroupName}</span> — lifter list and order are limited to this group.{" "}
          <button
            type="button"
            onClick={() => setActiveCompetitionGroupName(null)}
            className="inline font-semibold text-cyan-300 underline decoration-cyan-300/50 underline-offset-2 hover:text-cyan-200"
          >
            Show all groups
          </button>
        </p>
      ) : null}
      <div className="mb-4 rounded-2xl border border-white/15 bg-black/30 p-4 text-center">
        {timerPhase === "ATTEMPT" ? (
          <p className="text-lg font-semibold text-cyan-200 md:text-2xl">
            Platform Timer: {Math.floor(timerRemainingSeconds / 60)}:{String(timerRemainingSeconds % 60).padStart(2, "0")}
          </p>
        ) : (
          <p className="text-sm text-slate-300">Tap Bar loaded to start competition and 1:00 platform timer.</p>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => setCompetitionMode("FULL_GAME")}
            className={`rounded px-3 py-1.5 text-xs font-semibold ${
              competitionMode === "FULL_GAME" ? "bg-cyan-500 text-black" : "border border-white/20 bg-white/10 text-white"
            }`}
          >
            Full Game
          </button>
          <button
            onClick={() => setCompetitionMode("BENCH_ONLY")}
            className={`rounded px-3 py-1.5 text-xs font-semibold ${
              competitionMode === "BENCH_ONLY" ? "bg-violet-500 text-white" : "border border-white/20 bg-white/10 text-white"
            }`}
          >
            Bench Only
          </button>
        </div>
      </div>

      <div className="text-center text-white">
        <h2 className="font-serif text-4xl font-bold uppercase md:text-6xl">{currentLifter?.name || "NO LIFTER"}</h2>
        <p className="font-serif text-5xl font-bold md:text-7xl">{currentDisplayWeight.toFixed(1)} kg</p>
        <p className="mt-1 text-sm text-slate-300">
          {includeCollars
            ? `Loading with collar: ${loadingDisplayWeight.toFixed(1)} kg`
            : `Loading without collar: ${loadingDisplayWeight.toFixed(1)} kg`}
        </p>
        <p className="mt-2 font-serif text-3xl font-semibold uppercase">
          {currentLift} attempt {currentAttemptIndex + 1}
        </p>

        <label className="mt-3 inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={includeCollars}
            onChange={(e) => setIncludeCollars(e.target.checked)}
          />
          Add collar ({COLLAR_PER_SIDE_KG} kg each side)
        </label>

        {showDecisionButtons && (
          <div className="mt-3 flex flex-col items-center gap-3">
            <div className="flex flex-wrap items-start justify-center gap-5">
              <div className="flex flex-col items-center gap-1">
                <button
                  onClick={() => {
                    applyRefereeDecision(["GOOD", "GOOD", "GOOD"]);
                    setActionNotice("Good lift saved.");
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onContextMenu={(event) => event.preventDefault()}
                  draggable={false}
                  style={{ WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}
                  className="select-none touch-manipulation rounded border border-emerald-700 bg-emerald-300 px-7 py-3 text-3xl font-black text-black"
                >
                  G
                </button>
                <p className="select-none text-sm font-black uppercase tracking-[0.14em] text-emerald-300">GOOD LIFT</p>
              </div>

              <div className="flex flex-col items-center gap-1">
                <button
                  onClick={() => {
                    applyRefereeDecision(["NO", "NO", "NO"]);
                    setActionNotice("No lift saved.");
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onContextMenu={(event) => event.preventDefault()}
                  draggable={false}
                  style={{ WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}
                  className="select-none touch-manipulation rounded border border-rose-700 bg-rose-300 px-7 py-3 text-3xl font-black text-black"
                >
                  N
                </button>
                <p className="select-none text-sm font-black uppercase tracking-[0.14em] text-rose-300">NO LIFT</p>
              </div>
            </div>

            <button
              onClick={() => setShowDecisionButtons(false)}
              className="rounded border border-white/20 bg-white/10 px-3 py-1 text-lg text-white"
            >
              Hide buttons
            </button>
          </div>
        )}

        {!showDecisionButtons && (
          <button
            onClick={() => setShowDecisionButtons(true)}
            className="mt-3 rounded border border-white/20 bg-white/10 px-3 py-1 text-lg text-white"
          >
            Show buttons
          </button>
        )}

        <p className="mt-5 text-4xl">-</p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => {
              if (!currentLifter) {
                setActionNotice("Add/select a lifter first.");
                return;
              }
              startAttemptClock();
              setActionNotice("Bar loaded. 1:00 platform timer started.");
            }}
            className="rounded border border-white/20 bg-white/10 px-4 py-2 font-serif text-4xl leading-none"
          >
            Bar loaded
          </button>
          <button
            onClick={() => {
              resetSignals();
              setActionNotice("Signals reset.");
            }}
            className="rounded border border-white/20 bg-white/10 px-4 py-2 font-serif text-4xl leading-none"
          >
            Reset
          </button>
        </div>
        {actionNotice && <p className="mt-3 text-sm text-cyan-300">{actionNotice}</p>}
      </div>

      <hr className="my-6 border-white/15" />

      <div className="space-y-6">
        {activeNextAttempt && (
          <p className="text-center text-xs uppercase tracking-[0.2em] text-violet-300">
            Next Attempt Queue ({queuedAttemptRows.length})
          </p>
        )}
        {queuedAttemptRows.map(({ entry, lifter }, queueIndex) => {
          const queueLift = entry.lift;
          const queueAttemptIndex = entry.attemptIndex;
          const attempt = getAttempts(lifter, queueLift)[queueAttemptIndex];
          const previousAttempt = queueAttemptIndex > 0 ? getAttempts(lifter, queueLift)[queueAttemptIndex - 1] : null;
          const minQuickWeight = typeof previousAttempt?.weight === "number" ? previousAttempt.weight : 20;
          const baseWeight =
            typeof attempt?.weight === "number" ? attempt.weight : resolveAttemptWeight(lifter, queueLift, queueAttemptIndex);
          const quickWeights = buildQuickWeights(baseWeight, minQuickWeight);
          const draftKey = `${lifter.id}-${queueLift}-${queueAttemptIndex}`;
          const draft = quickWeightDraft[draftKey] ?? "";
          const queueKey = `${entry.lifterId}-${entry.lift}-${entry.attemptIndex}`;
          const startedAt = queueTimerStarts[queueKey] ?? now;
          const perLifterSignedSeconds = Math.ceil((startedAt + ONE_MINUTE_MS - now) / 1000);

          const applyWeight = (nextWeight: number) => {
            const result = updateAttemptForLifter(lifter.id, queueLift, queueAttemptIndex, nextWeight);
            if (result.ok) {
              setQuickWeightDraft((prev) => ({ ...prev, [draftKey]: String(nextWeight) }));
            }
            setActionNotice(result.message);
          };

          return (
            <div
              key={`${lifter.id}-${queueLift}-${queueAttemptIndex}`}
              className="border-t border-white/10 pt-4 text-center first:border-t-0 first:pt-0"
            >
              <div className="flex items-center justify-center gap-3">
                <h3 className="font-serif text-4xl font-bold uppercase">
                  {lifter.lot || "-"} {lifter.name}
                </h3>
                <span className="rounded-lg border border-violet-300/40 bg-violet-500/15 px-3 py-1 text-base font-semibold text-violet-100 md:text-lg">
                  {formatSignedTimer(perLifterSignedSeconds)}
                </span>
              </div>
              <p className="mt-1 text-sm uppercase tracking-[0.2em] text-violet-200">
                {queueLift} attempt {queueAttemptIndex + 1}
              </p>
              {queueIndex === 0 ? (
                <p className="mt-1 text-xs uppercase tracking-[0.15em] text-cyan-200">Current next attempt</p>
              ) : (
                <p className="mt-1 text-xs uppercase tracking-[0.15em] text-slate-400">Waiting in next-attempt list</p>
              )}
              <div className="mx-auto mt-3 grid max-w-5xl grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
                {quickWeights.map((w) => (
                  <button
                    key={`${lifter.id}-${w}`}
                    onClick={() => applyWeight(w)}
                    className="rounded border border-white/20 bg-white/10 py-1 text-2xl"
                  >
                    {w}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <input
                  value={draft}
                  onChange={(e) => setQuickWeightDraft((prev) => ({ ...prev, [draftKey]: e.target.value }))}
                  placeholder=""
                  className="h-12 w-28 rounded border border-white/20 bg-white/10 px-2 text-center text-2xl text-white"
                />
                <button
                  onClick={() => {
                    const currentValue = Number(draft || 0);
                    const nextValue = Number.isFinite(currentValue) && currentValue > 0 ? currentValue + 2.5 : baseWeight + 2.5;
                    applyWeight(Number(nextValue.toFixed(1)));
                  }}
                  className="h-12 w-14 rounded border border-white/20 bg-white/10 text-4xl leading-none"
                >
                  +
                </button>
                <button
                  onClick={() => {
                    const result = updateAttemptForLifter(lifter.id, queueLift, queueAttemptIndex, "");
                    setActionNotice(result.message);
                  }}
                  className="h-12 rounded border border-white/20 bg-white/10 px-4 font-serif text-4xl leading-none"
                >
                  Pass
                </button>
              </div>
            </div>
          );
        })}
        {queuedAttemptRows.length === 0 && (
          <p className="text-center text-sm text-slate-300">No pending next attempt declaration.</p>
        )}

        <div className="mx-auto max-w-4xl border-t border-white/10 pt-6">
          <div className="mb-3 flex justify-center">
            <button onClick={resetSignals} className="h-11 rounded border border-white/20 bg-white/10 px-4 text-white">
              Reset Signals
            </button>
          </div>

          <div className="rounded-2xl border border-white/15 bg-black/20 p-4">
            <p className="mb-3 text-center text-xs uppercase tracking-[0.2em] text-cyan-300">
              IPF Lifter Order ({currentLift.toUpperCase()} A{currentAttemptIndex + 1})
            </p>
            <div className="mb-3 flex justify-center">
              <button
                onClick={resetControlOrderToIPF}
                className="h-10 rounded-lg bg-cyan-500 px-4 text-sm font-semibold text-black"
              >
                Reset To IPF Order
              </button>
            </div>
            <div className="mb-3">
              <input
                value={ipfOrderSearchTerm}
                onChange={(e) => setIpfOrderSearchTerm(e.target.value)}
                placeholder="Search lifter in IPF order"
                className="h-10 w-full rounded-lg border border-white/20 bg-black/40 px-3 text-sm text-white"
              />
            </div>
            <div className="space-y-2">
              {visibleOrderLifters.map((lifter, index) => {
                const orderIndex = controlOrderLifters.findIndex((row) => row.id === lifter.id);
                return (
                <div
                  key={lifter.id}
                  draggable={editingOrderLifterId !== lifter.id}
                  onDragStart={() => setDraggingOrderIndex(orderIndex)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (draggingOrderIndex === null) return;
                    reorderCurrentStage(draggingOrderIndex, orderIndex);
                    setDraggingOrderIndex(null);
                  }}
                  onDragEnd={() => setDraggingOrderIndex(null)}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                    lifter.id === highlightedOrderLifterId
                      ? "border-cyan-300/60 bg-cyan-500/10"
                      : lifter.id === updatedOrderLifterId
                        ? "border-amber-300/60 bg-amber-500/10"
                      : "border-white/15 bg-white/5"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white">
                      {index + 1}. {lifter.name}
                    </p>
                    {editingOrderLifterId === lifter.id ? (
                      <div className="mt-2 grid gap-2 md:grid-cols-3">
                        <input
                          type="number"
                          step="2.5"
                          value={orderEditAttempt}
                          onChange={(e) => setOrderEditAttempt(e.target.value)}
                          placeholder={`${currentLift.toUpperCase()} A${currentAttemptIndex + 1}`}
                          className="h-9 rounded border border-white/20 bg-black/40 px-2 text-sm text-white"
                        />
                        <input
                          type="number"
                          value={orderEditBodyweight}
                          onChange={(e) => setOrderEditBodyweight(e.target.value)}
                          placeholder="Bodyweight"
                          className="h-9 rounded border border-white/20 bg-black/40 px-2 text-sm text-white"
                        />
                        <select
                          value={orderEditLot}
                          onChange={(e) => setOrderEditLot(e.target.value)}
                          className="h-9 rounded border border-white/20 bg-black/40 px-2 text-sm text-white"
                        >
                          <option value="" className="bg-slate-900">
                            Lot
                          </option>
                          {LOT_NUMBER_OPTIONS.map((lotNo) => (
                            <option key={lotNo} value={lotNo} className="bg-slate-900">
                              {lotNo}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-300">
                        Next: {getAttemptValue(lifter, currentLift, currentAttemptIndex) ?? "-"} kg | BW {typeof lifter.bodyweight === "number" ? lifter.bodyweight : "-"} | Lot {lifter.lot || "-"}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {editingOrderLifterId === lifter.id ? (
                      <>
                        <button
                          onClick={() => saveOrderEdit(lifter)}
                          className="h-9 rounded bg-emerald-500 px-3 text-sm font-semibold text-black"
                        >
                          Save
                        </button>
                        <button
                          onClick={cancelOrderEdit}
                          className="h-9 rounded bg-white/10 px-3 text-sm font-semibold text-white"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => reorderCurrentStage(orderIndex, Math.max(0, orderIndex - 1))}
                          className="h-9 rounded bg-white/10 px-3 text-sm font-semibold text-white"
                          disabled={orderIndex <= 0}
                        >
                          Up
                        </button>
                        <button
                          onClick={() =>
                            reorderCurrentStage(orderIndex, Math.min(controlOrderLifters.length - 1, orderIndex + 1))
                          }
                          className="h-9 rounded bg-white/10 px-3 text-sm font-semibold text-white"
                          disabled={orderIndex === -1 || orderIndex >= controlOrderLifters.length - 1}
                        >
                          Down
                        </button>
                        <button className="h-9 rounded border border-white/20 bg-black/20 px-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-200">
                          Drag
                        </button>
                        <button
                          onClick={() => openOrderEdit(lifter)}
                          className="h-9 rounded bg-purple-500 px-3 text-sm font-semibold text-white"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => markLifterDisqualified(lifter.id)}
                          className="h-9 rounded bg-rose-500 px-3 text-sm font-semibold text-white"
                        >
                          Disqualified
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => {
                        setCurrentLifterId(lifter.id);
                        setCurrentLift(currentLift);
                        setCurrentAttemptIndex(currentAttemptIndex);
                        setActionNotice(`Current lifter set: ${lifter.name}`);
                      }}
                      className="h-9 rounded bg-cyan-500 px-3 text-sm font-semibold text-black"
                    >
                      Set Current
                    </button>
                  </div>
                </div>
              );})}
              {visibleOrderLifters.length === 0 && <p className="text-center text-sm text-slate-400">No lifters found for this stage.</p>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const LifterManagementPage = () => {
  const { lifters, setLifters, currentLifterId, setCurrentLifterId, groups } = useAppContext();
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [lifterViewFilter, setLifterViewFilter] = useState<"ALL" | "ACTIVE" | "DISQUALIFIED">("ALL");
  const [customTeams, setCustomTeams] = useState<string[]>([]);
  const [teamState, setTeamState] = useState(INDIA_STATES[0] ?? "");
  const [teamDistrict, setTeamDistrict] = useState((INDIA_DISTRICTS[INDIA_STATES[0] ?? ""] ?? [""])[0]);
  const [customTeamName, setCustomTeamName] = useState("");
  const [form, setForm] = useState({
    name: "",
    sex: "Male" as "Male" | "Female",
    dob: "",
    bodyweight: "" as number | "",
    manualWeightClass: "",
    category: "Sub-Junior Men",
    group: groups[0]?.name ?? "",
    team: "",
    rackHeightSquat: "" as number | "",
    rackHeightBench: "" as number | "",
    lot: "" as number | "",
    squat1: "" as number | "",
    bench1: "" as number | "",
    deadlift1: "" as number | "",
    isEquipped: false,
    disqualified: false,
  });

  const categoryOptions = getCategoryOptions(form.sex);
  const selectedStateDistricts = INDIA_DISTRICTS[teamState] ?? [];
  const autoWeightClass = getIPFWeightClass(form.sex, form.bodyweight);
  const resolvedWeightClass = resolveWeightClass(form.sex, form.bodyweight, form.manualWeightClass);
  const visibleLifters = useMemo(() => {
    if (lifterViewFilter === "ACTIVE") return lifters.filter((lifter) => !lifter.disqualified);
    if (lifterViewFilter === "DISQUALIFIED") return lifters.filter((lifter) => lifter.disqualified);
    return lifters;
  }, [lifters, lifterViewFilter]);

  const resetForm = () => {
    setEditingId(null);
    setForm({
      name: "",
      sex: "Male",
      dob: "",
      bodyweight: "",
      manualWeightClass: "",
      category: "Sub-Junior Men",
      group: groups[0]?.name ?? "",
      team: "",
      rackHeightSquat: "",
      rackHeightBench: "",
      lot: "",
      squat1: "",
      bench1: "",
      deadlift1: "",
      isEquipped: false,
      disqualified: false,
    });
  };

  const applyStateDistrictTeam = () => {
    if (!teamState || !teamDistrict) return;
    setForm((prev) => ({ ...prev, team: `India - ${teamState} - ${teamDistrict}` }));
  };

  const createCustomTeam = () => {
    const next = customTeamName.trim();
    if (!next) return;
    if (!customTeams.includes(next)) {
      setCustomTeams((prev) => [...prev, next]);
    }
    setForm((prev) => ({ ...prev, team: next }));
    setCustomTeamName("");
  };

  const keepAttemptWithFirstWeight = (attempts: Attempt[], firstWeight: number | "") => {
    const next = [...attempts];
    const existingStatus = next[0]?.status;
    const status: AttemptStatus =
      firstWeight === ""
        ? "UNATTEMPTED"
        : existingStatus === "GOOD" || existingStatus === "NO"
          ? existingStatus
          : "PENDING";
    next[0] = { weight: firstWeight, status };
    if (!next[1]) next[1] = { weight: "", status: "UNATTEMPTED" };
    if (!next[2]) next[2] = { weight: "", status: "UNATTEMPTED" };
    return next;
  };

  const saveLifter = () => {
    if (!form.name.trim()) {
      setNotice("Lifter name is required.");
      return;
    }
    if (!editingId && lifters.length >= 500) {
      setNotice("Maximum 500 lifters allowed per competition.");
      return;
    }
    const category = categoryOptions.includes(form.category) ? form.category : categoryOptions[0];
    const payload = {
      name: form.name.trim(),
      sex: form.sex,
      dob: form.dob,
      bodyweight: form.bodyweight,
      manualWeightClass: form.manualWeightClass.trim(),
      weightClass: resolveWeightClass(form.sex, form.bodyweight, form.manualWeightClass),
      category,
      group: form.group,
      team: form.team || "Independent",
      rackHeightSquat: form.rackHeightSquat,
      rackHeightBench: form.rackHeightBench,
      lot: form.lot,
      isEquipped: form.isEquipped,
      disqualified: form.disqualified,
    };

    if (editingId) {
      const updated = lifters.map((l) =>
        l.id === editingId
          ? {
              ...l,
              ...payload,
              squatAttempts: keepAttemptWithFirstWeight(l.squatAttempts, form.squat1),
              benchAttempts: keepAttemptWithFirstWeight(l.benchAttempts, form.bench1),
              deadliftAttempts: keepAttemptWithFirstWeight(l.deadliftAttempts, form.deadlift1),
            }
          : l,
      );
      setLifters(updated);
      setNotice("Lifter updated.");
      resetForm();
      return;
    }

    const lifterToAdd: Lifter = {
      id: Date.now().toString(),
      ...payload,
      squatAttempts: emptyAttemptsFromFirst(form.squat1),
      benchAttempts: emptyAttemptsFromFirst(form.bench1),
      deadliftAttempts: emptyAttemptsFromFirst(form.deadlift1),
    };
    const updated = [...lifters, lifterToAdd];
    setLifters(updated);
    if (!currentLifterId) {
      const firstInOrder = orderLiftersByIPF(updated, "squat", 0)[0]?.id ?? lifterToAdd.id;
      setCurrentLifterId(firstInOrder);
    }
    setNotice("Lifter created.");
    resetForm();
  };

  const editLifter = (lifter: Lifter) => {
    setEditingId(lifter.id);
    setForm({
      name: lifter.name,
      sex: lifter.sex,
      dob: lifter.dob,
      bodyweight: lifter.bodyweight,
      manualWeightClass: lifter.manualWeightClass,
      category: lifter.category,
      group: lifter.group,
      team: lifter.team,
      rackHeightSquat: lifter.rackHeightSquat,
      rackHeightBench: lifter.rackHeightBench,
      lot: lifter.lot,
      squat1: lifter.squatAttempts[0]?.weight ?? "",
      bench1: lifter.benchAttempts[0]?.weight ?? "",
      deadlift1: lifter.deadliftAttempts[0]?.weight ?? "",
      isEquipped: lifter.isEquipped,
      disqualified: lifter.disqualified,
    });

    const teamParts = lifter.team.split(" - ");
    if (teamParts.length >= 3 && teamParts[0] === "India") {
      const state = teamParts[1];
      const district = teamParts[2];
      if (INDIA_STATES.includes(state)) {
        setTeamState(state);
        if ((INDIA_DISTRICTS[state] ?? []).includes(district)) {
          setTeamDistrict(district);
        }
      }
    }
  };

  const deleteLifter = (lifter: Lifter) => {
    const confirmed = window.confirm(`Delete lifter ${lifter.name}?`);
    if (!confirmed) return;
    const updated = lifters.filter((l) => l.id !== lifter.id);
    setLifters(updated);
    if (updated.length === 0) setCurrentLifterId(null);
    if (editingId === lifter.id) resetForm();
    setNotice(`Deleted ${lifter.name}.`);
  };

  const restoreLifter = (lifter: Lifter) => {
    if (!lifter.disqualified) return;
    const updated = lifters.map((row) => (row.id === lifter.id ? { ...row, disqualified: false } : row));
    setLifters(updated);
    if (!currentLifterId) {
      const firstInOrder = orderLiftersByIPF(updated, "squat", 0)[0]?.id ?? null;
      setCurrentLifterId(firstInOrder);
    }
    setNotice(`${lifter.name} restored to active lifters.`);
  };

  useEffect(() => {
    if (!selectedStateDistricts.length) {
      setTeamDistrict("");
      return;
    }
    if (!selectedStateDistricts.includes(teamDistrict)) {
      setTeamDistrict(selectedStateDistricts[0]);
    }
  }, [teamState, teamDistrict, selectedStateDistricts]);

  useEffect(() => {
    if (!groups.length) {
      setForm((prev) => ({ ...prev, group: "" }));
      return;
    }
    if (!form.group || !groups.some((g) => g.name === form.group)) {
      setForm((prev) => ({ ...prev, group: groups[0].name }));
    }
  }, [groups, form.group]);

  return (
    <section>
      <SectionHeader title="Manage Lifters" path="/lifters" />
      {notice && <p className="mb-4 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-100">{notice}</p>}

      {!editingId ? (
        <div className="rounded-2xl border border-white/15 bg-white/5 p-5">
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-cyan-300">Add Lifter</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Field placeholder="Lifter Name" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
          <select
            value={form.sex}
            onChange={(e) => {
              const nextSex = e.target.value as "Male" | "Female";
              const nextOptions = getCategoryOptions(nextSex);
              setForm((prev) => ({
                ...prev,
                sex: nextSex,
                category: nextOptions.includes(prev.category) ? prev.category : nextOptions[0],
              }));
            }}
            className="h-11 rounded-xl border border-white/20 bg-black/40 px-3"
          >
            <option value="Male" className="bg-slate-900">Male</option>
            <option value="Female" className="bg-slate-900">Female</option>
          </select>
          <Field type="date" value={form.dob} onChange={(e) => setForm((prev) => ({ ...prev, dob: e.target.value }))} />
          <div className="grid grid-cols-[1fr_140px] gap-2">
            <Field
              type="number"
              placeholder="Bodyweight"
              value={form.bodyweight}
              onChange={(e) => setForm((prev) => ({ ...prev, bodyweight: e.target.value === "" ? "" : Number(e.target.value) }))}
            />
            <input
              readOnly
              value={autoWeightClass || "Class"}
              aria-label="Auto bodyweight class"
              className="h-11 rounded-xl border border-cyan-300/40 bg-cyan-500/10 px-2 text-center text-sm font-semibold text-cyan-100"
            />
          </div>
          <select
            value={form.category}
            onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
            className="h-11 rounded-xl border border-white/20 bg-black/40 px-3"
          >
            {categoryOptions.map((c) => (
              <option key={c} value={c} className="bg-slate-900">
                {c}
              </option>
            ))}
          </select>
          <select
            value={form.group}
            onChange={(e) => setForm((prev) => ({ ...prev, group: e.target.value }))}
            className="h-11 rounded-xl border border-white/20 bg-black/40 px-3"
          >
            {groups.length === 0 && (
              <option value="" className="bg-slate-900">
                No Group
              </option>
            )}
            {groups.map((g) => (
              <option key={g.id} value={g.name} className="bg-slate-900">
                Group {g.name}
              </option>
            ))}
          </select>
          <select
            value={form.manualWeightClass}
            onChange={(e) => setForm((prev) => ({ ...prev, manualWeightClass: e.target.value }))}
            className="h-11 rounded-xl border border-white/20 bg-black/40 px-3"
          >
            <option value="" className="bg-slate-900">
              Auto Weight Class
            </option>
            {MANUAL_WEIGHT_CLASSES.map((wc) => (
              <option key={wc} value={wc} className="bg-slate-900">
                {wc}
              </option>
            ))}
          </select>
          <Field
            placeholder="Manual class (custom)"
            value={form.manualWeightClass}
            onChange={(e) => setForm((prev) => ({ ...prev, manualWeightClass: e.target.value }))}
          />
          <Field
            type="number"
            placeholder="Squat Rack Height"
            value={form.rackHeightSquat}
            onChange={(e) => setForm((prev) => ({ ...prev, rackHeightSquat: e.target.value === "" ? "" : Number(e.target.value) }))}
          />
          <Field
            type="number"
            placeholder="Bench Rack Height"
            value={form.rackHeightBench}
            onChange={(e) => setForm((prev) => ({ ...prev, rackHeightBench: e.target.value === "" ? "" : Number(e.target.value) }))}
          />
          <select
            value={form.lot}
            onChange={(e) => setForm((prev) => ({ ...prev, lot: e.target.value === "" ? "" : Number(e.target.value) }))}
            className="h-11 rounded-xl border border-white/20 bg-black/40 px-3"
          >
            <option value="" className="bg-slate-900">
              Lot Number
            </option>
            {LOT_NUMBER_OPTIONS.map((lotNo) => (
              <option key={lotNo} value={lotNo} className="bg-slate-900">
                {lotNo}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
          <p className="mb-3 text-xs uppercase tracking-[0.18em] text-cyan-300">Team (India State to District)</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <select
              value={teamState}
              onChange={(e) => setTeamState(e.target.value)}
              className="h-11 rounded-xl border border-white/20 bg-black/40 px-3"
            >
              {INDIA_STATES.map((state) => (
                <option key={state} value={state} className="bg-slate-900">
                  {state}
                </option>
              ))}
            </select>
            <select
              value={teamDistrict}
              onChange={(e) => setTeamDistrict(e.target.value)}
              className="h-11 rounded-xl border border-white/20 bg-black/40 px-3"
            >
              {selectedStateDistricts.map((district) => (
                <option key={district} value={district} className="bg-slate-900">
                  {district}
                </option>
              ))}
            </select>
            <button onClick={applyStateDistrictTeam} className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-black">
              Use State/District Team
            </button>
            <Field placeholder="Selected Team" value={form.team} onChange={(e) => setForm((prev) => ({ ...prev, team: e.target.value }))} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Field
              placeholder="Create New Team"
              value={customTeamName}
              onChange={(e) => setCustomTeamName(e.target.value)}
            />
            <button onClick={createCustomTeam} className="rounded-xl bg-purple-500 px-4 py-2 text-sm font-semibold">
              Create Team
            </button>
            {customTeams.length > 0 && (
              <select
                value={form.team}
                onChange={(e) => setForm((prev) => ({ ...prev, team: e.target.value }))}
                className="h-11 min-w-60 rounded-xl border border-white/20 bg-black/40 px-3"
              >
                <option value="" className="bg-slate-900">
                  Select Created Team
                </option>
                {customTeams.map((team) => (
                  <option key={team} value={team} className="bg-slate-900">
                    {team}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
          <p className="mb-3 text-xs uppercase tracking-[0.18em] text-cyan-300">1st Attempts (SQ / BP / DL)</p>
          <div className="grid gap-3 md:grid-cols-3">
            <Field
              type="number"
              placeholder="SQ 1"
              value={form.squat1}
              onChange={(e) => setForm((prev) => ({ ...prev, squat1: e.target.value === "" ? "" : Number(e.target.value) }))}
            />
            <Field
              type="number"
              placeholder="BP 1"
              value={form.bench1}
              onChange={(e) => setForm((prev) => ({ ...prev, bench1: e.target.value === "" ? "" : Number(e.target.value) }))}
            />
            <Field
              type="number"
              placeholder="DL 1"
              value={form.deadlift1}
              onChange={(e) => setForm((prev) => ({ ...prev, deadlift1: e.target.value === "" ? "" : Number(e.target.value) }))}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.isEquipped}
              onChange={(e) => setForm((prev) => ({ ...prev, isEquipped: e.target.checked }))}
            />
            Equipped
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.disqualified}
              onChange={(e) => setForm((prev) => ({ ...prev, disqualified: e.target.checked }))}
            />
            Disqualified
          </label>
        </div>

        <p className="mt-3 text-sm text-cyan-200">Final class: {resolvedWeightClass || "-"}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={saveLifter} className="rounded-xl bg-cyan-500 px-4 py-2 font-semibold text-black">
            Add Lifter
          </button>
        </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-cyan-300/20 bg-cyan-500/5 p-4 text-sm text-cyan-100">
          Editing is active in lifter list. Save or cancel the row edit to continue adding new lifters.
        </div>
      )}

      <div className="mt-5 overflow-x-auto rounded-2xl border border-white/15 bg-black/20">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-3">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Lifter View</p>
          <button
            onClick={() => setLifterViewFilter("ALL")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              lifterViewFilter === "ALL" ? "bg-cyan-500 text-black" : "bg-white/10 text-slate-100"
            }`}
          >
            All ({lifters.length})
          </button>
          <button
            onClick={() => setLifterViewFilter("ACTIVE")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              lifterViewFilter === "ACTIVE" ? "bg-cyan-500 text-black" : "bg-white/10 text-slate-100"
            }`}
          >
            Active ({lifters.filter((lifter) => !lifter.disqualified).length})
          </button>
          <button
            onClick={() => setLifterViewFilter("DISQUALIFIED")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              lifterViewFilter === "DISQUALIFIED" ? "bg-rose-500 text-white" : "bg-white/10 text-slate-100"
            }`}
          >
            Disqualified ({lifters.filter((lifter) => lifter.disqualified).length})
          </button>
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-white/5 text-left text-slate-300">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Sex</th>
              <th className="px-4 py-3">DOB</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Group</th>
              <th className="px-4 py-3">Team</th>
              <th className="px-4 py-3">Lot</th>
              <th className="px-4 py-3">Rack S/B</th>
              <th className="px-4 py-3">SQ/BP/DL 1</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleLifters.map((l) => {
              const isEditing = editingId === l.id;
              return (
                <tr key={l.id} className="border-t border-white/10">
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <input
                        value={form.name}
                        onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                        className="h-9 w-32 rounded-lg border border-white/20 bg-black/40 px-2 text-sm"
                      />
                    ) : (
                      l.name
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <select
                        value={form.sex}
                        onChange={(e) => {
                          const nextSex = e.target.value as "Male" | "Female";
                          const nextOptions = getCategoryOptions(nextSex);
                          setForm((prev) => ({
                            ...prev,
                            sex: nextSex,
                            category: nextOptions.includes(prev.category) ? prev.category : nextOptions[0],
                          }));
                        }}
                        className="h-9 rounded-lg border border-white/20 bg-black/40 px-2 text-sm"
                      >
                        <option value="Male" className="bg-slate-900">Male</option>
                        <option value="Female" className="bg-slate-900">Female</option>
                      </select>
                    ) : (
                      l.sex
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <input
                        type="date"
                        value={form.dob}
                        onChange={(e) => setForm((prev) => ({ ...prev, dob: e.target.value }))}
                        className="h-9 rounded-lg border border-white/20 bg-black/40 px-2 text-sm"
                      />
                    ) : (
                      l.dob || "-"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <select
                        value={form.category}
                        onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                        className="h-9 rounded-lg border border-white/20 bg-black/40 px-2 text-sm"
                      >
                        {getCategoryOptions(form.sex).map((category) => (
                          <option key={category} value={category} className="bg-slate-900">
                            {category}
                          </option>
                        ))}
                      </select>
                    ) : (
                      l.category || "-"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <div className="flex min-w-44 gap-2">
                        <input
                          type="number"
                          value={form.bodyweight}
                          onChange={(e) => setForm((prev) => ({ ...prev, bodyweight: e.target.value === "" ? "" : Number(e.target.value) }))}
                          placeholder="BW"
                          className="h-9 w-20 rounded-lg border border-white/20 bg-black/40 px-2 text-sm"
                        />
                        <input
                          value={form.manualWeightClass}
                          onChange={(e) => setForm((prev) => ({ ...prev, manualWeightClass: e.target.value }))}
                          placeholder="Class"
                          className="h-9 w-24 rounded-lg border border-white/20 bg-black/40 px-2 text-sm"
                        />
                      </div>
                    ) : (
                      l.weightClass || "-"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <select
                        value={form.group}
                        onChange={(e) => setForm((prev) => ({ ...prev, group: e.target.value }))}
                        className="h-9 rounded-lg border border-white/20 bg-black/40 px-2 text-sm"
                      >
                        <option value="" className="bg-slate-900">No Group</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.name} className="bg-slate-900">
                            Group {g.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      l.group || "-"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <input
                        value={form.team}
                        onChange={(e) => setForm((prev) => ({ ...prev, team: e.target.value }))}
                        className="h-9 min-w-40 rounded-lg border border-white/20 bg-black/40 px-2 text-sm"
                      />
                    ) : (
                      l.team || "-"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <select
                        value={form.lot}
                        onChange={(e) => setForm((prev) => ({ ...prev, lot: e.target.value === "" ? "" : Number(e.target.value) }))}
                        className="h-9 rounded-lg border border-white/20 bg-black/40 px-2 text-sm"
                      >
                        <option value="" className="bg-slate-900">
                          Lot
                        </option>
                        {LOT_NUMBER_OPTIONS.map((lotNo) => (
                          <option key={lotNo} value={lotNo} className="bg-slate-900">
                            {lotNo}
                          </option>
                        ))}
                      </select>
                    ) : (
                      l.lot || "-"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <div className="flex gap-2">
                        <input
                          type="number"
                          value={form.rackHeightSquat}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, rackHeightSquat: e.target.value === "" ? "" : Number(e.target.value) }))
                          }
                          placeholder="S"
                          className="h-9 w-14 rounded-lg border border-white/20 bg-black/40 px-2 text-sm"
                        />
                        <input
                          type="number"
                          value={form.rackHeightBench}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, rackHeightBench: e.target.value === "" ? "" : Number(e.target.value) }))
                          }
                          placeholder="B"
                          className="h-9 w-14 rounded-lg border border-white/20 bg-black/40 px-2 text-sm"
                        />
                      </div>
                    ) : (
                      <>{l.rackHeightSquat || "-"} / {l.rackHeightBench || "-"}</>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <div className="flex min-w-52 gap-2">
                        <input
                          type="number"
                          value={form.squat1}
                          onChange={(e) => setForm((prev) => ({ ...prev, squat1: e.target.value === "" ? "" : Number(e.target.value) }))}
                          placeholder="SQ"
                          className="h-9 w-16 rounded-lg border border-white/20 bg-black/40 px-2 text-sm"
                        />
                        <input
                          type="number"
                          value={form.bench1}
                          onChange={(e) => setForm((prev) => ({ ...prev, bench1: e.target.value === "" ? "" : Number(e.target.value) }))}
                          placeholder="BP"
                          className="h-9 w-16 rounded-lg border border-white/20 bg-black/40 px-2 text-sm"
                        />
                        <input
                          type="number"
                          value={form.deadlift1}
                          onChange={(e) =>
                            setForm((prev) => ({ ...prev, deadlift1: e.target.value === "" ? "" : Number(e.target.value) }))
                          }
                          placeholder="DL"
                          className="h-9 w-16 rounded-lg border border-white/20 bg-black/40 px-2 text-sm"
                        />
                      </div>
                    ) : (
                      <>
                        {l.squatAttempts[0]?.weight || "-"} / {l.benchAttempts[0]?.weight || "-"} / {l.deadliftAttempts[0]?.weight || "-"}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {isEditing ? (
                        <>
                          <button onClick={saveLifter} className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-black">
                            Save
                          </button>
                          <button onClick={resetForm} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold">
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button onClick={() => editLifter(l)} className="rounded-lg bg-purple-500 px-3 py-1.5 text-xs font-semibold">
                          Edit
                        </button>
                      )}
                      {l.disqualified && !isEditing && (
                        <button
                          onClick={() => restoreLifter(l)}
                          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-black"
                        >
                          Restore
                        </button>
                      )}
                      <button onClick={() => deleteLifter(l)} className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {visibleLifters.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-5 text-center text-slate-300">
                  No lifters in this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const GroupManagementPage = () => {
  const {
    groups,
    setGroups,
    lifters,
    setLifters,
    setCompetitionStarted,
    setCurrentLift,
    setCurrentAttemptIndex,
    setCurrentLifterId,
    setCompetitionMode,
    setActiveCompetitionGroupName,
    setNextAttemptQueue,
  } = useAppContext();
  const [groupName, setGroupName] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeGroupFilter, setActiveGroupFilter] = useState("");
  const [groupNotice, setGroupNotice] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [editingLifterId, setEditingLifterId] = useState<string | null>(null);
  const [editingLifterDraft, setEditingLifterDraft] = useState<{
    name: string;
    sex: "Male" | "Female";
    bodyweight: number | "";
    team: string;
    group: string;
    category: string;
  } | null>(null);
  const [selectedLifterId, setSelectedLifterId] = useState(lifters[0]?.id ?? "");
  const [selectedGroupName, setSelectedGroupName] = useState(groups[0]?.name ?? "");
  const [checkedLifterIds, setCheckedLifterIds] = useState<string[]>([]);
  const [bulkTargetGroupName, setBulkTargetGroupName] = useState(groups[0]?.name ?? "");
  const [doubleCategoryType, setDoubleCategoryType] = useState<"SUBJR_JR" | "JR_SR" | "SR_M1">("JR_SR");
    const [startCompGroupId, setStartCompGroupId] = useState<string | null>(null);
    const [compLifts, setCompLifts] = useState<Record<LiftType, boolean>>({ squat: true, bench: true, deadlift: true });

  const filteredGroups = useMemo(() => {
    const query = searchTerm.trim().toUpperCase();
    if (!query) return groups;
    return groups.filter((g) => g.name.toUpperCase().includes(query));
  }, [groups, searchTerm]);

  const visibleLifters = useMemo(() => {
    if (!activeGroupFilter) return lifters;
    return lifters.filter((l) => l.group === activeGroupFilter);
  }, [lifters, activeGroupFilter]);

  useEffect(() => {
    if (!lifters.length) {
      setSelectedLifterId("");
      return;
    }
    if (!selectedLifterId || !lifters.some((l) => l.id === selectedLifterId)) {
      setSelectedLifterId(lifters[0].id);
    }
  }, [lifters, selectedLifterId]);

  useEffect(() => {
    if (!groups.length) {
      setSelectedGroupName("");
      setBulkTargetGroupName("");
      return;
    }
    if (!selectedGroupName || !groups.some((g) => g.name === selectedGroupName)) {
      setSelectedGroupName(groups[0].name);
    }
    if (!bulkTargetGroupName || !groups.some((g) => g.name === bulkTargetGroupName)) {
      setBulkTargetGroupName(groups[0].name);
    }
  }, [groups, selectedGroupName, bulkTargetGroupName]);

  useEffect(() => {
    setCheckedLifterIds((prev) => prev.filter((id) => visibleLifters.some((lifter) => lifter.id === id)));
  }, [visibleLifters]);

  useEffect(() => {
    if (!activeGroupFilter) return;
    if (!groups.some((g) => g.name === activeGroupFilter)) {
      setActiveGroupFilter("");
    }
  }, [groups, activeGroupFilter]);

  const createGroup = () => {
    const nextName = groupName.trim().toUpperCase();
    if (!nextName) return;
    if (groups.some((g) => g.name.toUpperCase() === nextName)) {
      setGroupNotice("Group already exists.");
      return;
    }
    setGroups([...groups, { id: `group-${Date.now()}`, name: nextName, currentLift: "squat" }]);
    setSelectedGroupName(nextName);
    setActiveGroupFilter(nextName);
    setGroupName("");
    setGroupNotice(`Group ${nextName} created.`);
  };

  const assignLifter = () => {
    if (!selectedLifterId || !selectedGroupName) return;
    const updated = lifters.map((l) => (l.id === selectedLifterId ? { ...l, group: selectedGroupName } : l));
    setLifters(updated);
    setGroupNotice("Lifter moved successfully.");
  };

  const startEditGroup = (group: Group) => {
    setEditingGroupId(group.id);
    setEditingGroupName(group.name);
  };

  const setGroupLiftStage = (groupId: string, lift: LiftType) => {
    const updated = groups.map((group) => (group.id === groupId ? { ...group, currentLift: lift } : group));
    setGroups(updated);
    setGroupNotice(`Group stage updated to ${lift.toUpperCase()}.`);
  };

  const handleStartGroupCompetition = (group: Group) => {
    const enabledLifts = (Object.entries(compLifts) as [LiftType, boolean][]).filter(([, v]) => v).map(([k]) => k);
    if (enabledLifts.length === 0) {
      setGroupNotice("Select at least one lift to start the competition.");
      return;
    }
    const firstLift: LiftType = enabledLifts.includes("squat") ? "squat" : enabledLifts.includes("bench") ? "bench" : "deadlift";
    const groupLifters = lifters.filter((l) => l.group === group.name && !l.disqualified);
    if (groupLifters.length === 0) {
      setGroupNotice("No lifters in this group to start a competition.");
      return;
    }
    const newMode: CompetitionMode = enabledLifts.length === 1 && enabledLifts[0] === "bench" ? "BENCH_ONLY" : "FULL_GAME";
    setNextAttemptQueue([]);
    setActiveCompetitionGroupName(group.name);
    setCompetitionMode(newMode);
    setCurrentLift(firstLift);
    setCurrentAttemptIndex(0);
    const orderedGroupLifters = orderLiftersByIPF(groupLifters, firstLift, 0);
    if (orderedGroupLifters[0]) setCurrentLifterId(orderedGroupLifters[0].id);
    setCompetitionStarted(true);
    setStartCompGroupId(null);
    setGroupNotice(`Competition started for Group ${group.name} — ${enabledLifts.map((l) => l.toUpperCase()).join(", ")}.`);
  };

  const saveEditGroup = () => {
    if (!editingGroupId) return;
    const nextName = editingGroupName.trim().toUpperCase();
    if (!nextName) return;

    const currentGroup = groups.find((g) => g.id === editingGroupId);
    if (!currentGroup) return;

    const duplicate = groups.some((g) => g.id !== editingGroupId && g.name.toUpperCase() === nextName);
    if (duplicate) {
      setGroupNotice("Group name already exists.");
      return;
    }

    const updatedGroups = groups.map((g) => (g.id === editingGroupId ? { ...g, name: nextName } : g));
    const updatedLifters = lifters.map((l) => (l.group === currentGroup.name ? { ...l, group: nextName } : l));

    setGroups(updatedGroups);
    setLifters(updatedLifters);
    if (selectedGroupName === currentGroup.name) setSelectedGroupName(nextName);
    setEditingGroupId(null);
    setEditingGroupName("");
    setGroupNotice(`Group renamed to ${nextName}.`);
  };

  const deleteGroup = (group: Group) => {
    const fallbackGroup = groups.find((g) => g.id !== group.id);
    const confirmed = fallbackGroup
      ? window.confirm(`Delete Group ${group.name}? Lifters will move to Group ${fallbackGroup.name}.`)
      : window.confirm(`Delete Group ${group.name}? This is the last group and assigned lifters will become ungrouped.`);
    if (!confirmed) return;

    const updatedGroups = groups.filter((g) => g.id !== group.id);
    const updatedLifters = lifters.map((l) =>
      l.group === group.name ? { ...l, group: fallbackGroup?.name ?? "" } : l,
    );

    setGroups(updatedGroups);
    setLifters(updatedLifters);
    if (selectedGroupName === group.name) setSelectedGroupName(fallbackGroup?.name ?? "");
    if (activeGroupFilter === group.name) setActiveGroupFilter(fallbackGroup?.name ?? "");
    if (editingGroupId === group.id) {
      setEditingGroupId(null);
      setEditingGroupName("");
    }
    if (updatedGroups.length === 0) {
      setGroupNotice("All groups deleted. Lifters are now ungrouped.");
    } else {
      setGroupNotice(`Group ${group.name} deleted.`);
    }
  };

  const startEditLifter = (lifter: Lifter) => {
    setEditingLifterId(lifter.id);
    setEditingLifterDraft({
      name: lifter.name,
      sex: lifter.sex,
      bodyweight: lifter.bodyweight,
      team: lifter.team,
      group: lifter.group,
      category: lifter.category,
    });
  };

  const cancelEditLifter = () => {
    setEditingLifterId(null);
    setEditingLifterDraft(null);
  };

  const saveEditLifter = () => {
    if (!editingLifterId || !editingLifterDraft) return;
    if (!editingLifterDraft.name.trim()) {
      setGroupNotice("Lifter name is required.");
      return;
    }

    const updated = lifters.map((l) => {
      if (l.id !== editingLifterId) return l;
      return {
        ...l,
        name: editingLifterDraft.name.trim(),
        sex: editingLifterDraft.sex,
        bodyweight: editingLifterDraft.bodyweight,
        group: editingLifterDraft.group,
        team: editingLifterDraft.team,
        category: editingLifterDraft.category,
        weightClass: resolveWeightClass(editingLifterDraft.sex, editingLifterDraft.bodyweight, l.manualWeightClass),
      };
    });

    setLifters(updated);
    setGroupNotice("Lifter updated successfully.");
    cancelEditLifter();
  };

  const moveCheckedLiftersToGroup = () => {
    if (!bulkTargetGroupName) {
      setGroupNotice("Select a target group first.");
      return;
    }
    if (checkedLifterIds.length === 0) {
      setGroupNotice("Select at least one lifter.");
      return;
    }

    const updated = lifters.map((lifter) =>
      checkedLifterIds.includes(lifter.id) ? { ...lifter, group: bulkTargetGroupName } : lifter,
    );
    setLifters(updated);
    setCheckedLifterIds([]);
    setGroupNotice(`Moved ${checkedLifterIds.length} lifter(s) to Group ${bulkTargetGroupName}.`);
  };

  const markCheckedAsDoubleCategory = () => {
    if (checkedLifterIds.length === 0) {
      setGroupNotice("Select at least one lifter.");
      return;
    }
    const getTargetCategory = (sex: "Male" | "Female") => {
      const options = getDoubleCategoryOptions(sex);
      if (doubleCategoryType === "SUBJR_JR") return options[0];
      if (doubleCategoryType === "JR_SR") return options[1];
      return options[2];
    };
    const updated = lifters.map((lifter) => {
      if (!checkedLifterIds.includes(lifter.id)) return lifter;
      return { ...lifter, category: getTargetCategory(lifter.sex) };
    });
    setLifters(updated);
    setGroupNotice(`Set dual category for ${checkedLifterIds.length} lifter(s). Attempts auto-apply to both categories.`);
  };

  return (
    <section>
      <SectionHeader title="Groups" path="/groups" />
      {groupNotice && (
        <p className="mb-4 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-100">
          {groupNotice}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/15 bg-white/5 p-5">
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-cyan-300">Create Group</p>
          <div className="flex gap-2">
            <Field value={groupName} placeholder="Group name (A, B, C...)" onChange={(e) => setGroupName(e.target.value)} />
            <button onClick={createGroup} className="rounded-xl bg-cyan-500 px-4 text-sm font-semibold text-black">
              Create
            </button>
          </div>
          <div className="mt-4 space-y-2 text-sm text-slate-300">
            {filteredGroups.map((g) => (
              <p key={g.id}>
                Group {g.name} - {lifters.filter((l) => l.group === g.name).length} lifter(s) - {g.currentLift.toUpperCase()}
              </p>
            ))}
            {filteredGroups.length === 0 && <p>No matching groups.</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-white/15 bg-white/5 p-5">
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-cyan-300">Add Lifter To Group</p>
          <div className="space-y-3">
            <select
              value={selectedLifterId}
              onChange={(e) => setSelectedLifterId(e.target.value)}
              className="h-11 w-full rounded-xl border border-white/20 bg-black/40 px-3"
            >
              {lifters.map((l) => (
                <option key={l.id} value={l.id} className="bg-slate-900">
                  {l.name}
                </option>
              ))}
            </select>
            <select
              value={selectedGroupName}
              onChange={(e) => setSelectedGroupName(e.target.value)}
              className="h-11 w-full rounded-xl border border-white/20 bg-black/40 px-3"
            >
              {groups.length === 0 && (
                <option value="" className="bg-slate-900">
                  No Group
                </option>
              )}
              {groups.map((g) => (
                <option key={g.id} value={g.name} className="bg-slate-900">
                  Group {g.name}
                </option>
              ))}
            </select>
            <button
              onClick={assignLifter}
              disabled={groups.length === 0}
              className="rounded-xl bg-purple-500 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add To Group
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/15 bg-white/5 p-5">
        <p className="mb-3 text-xs uppercase tracking-[0.2em] text-cyan-300">Search, Edit, Delete Groups</p>
        <div className="mb-4 md:w-80">
          <Field
            value={searchTerm}
            placeholder="Search groups"
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          {filteredGroups.map((group) => (
            <div
              key={group.id}
              className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/20 p-3 md:flex-row md:items-center md:justify-between"
            >
                <button
                  onClick={() => setActiveGroupFilter((prev) => (prev === group.name ? "" : group.name))}
                  className="w-fit text-left text-sm text-slate-200"
                >
                  <span className="font-semibold">Group {group.name}</span> - {lifters.filter((l) => l.group === group.name).length} lifter(s)
                  <span className="ml-2 text-cyan-300">{activeGroupFilter === group.name ? "(Showing)" : "(Tap to show)"}</span>
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={group.currentLift}
                    onChange={(e) => setGroupLiftStage(group.id, e.target.value as LiftType)}
                    className="h-9 rounded-lg border border-white/20 bg-black/40 px-2 text-xs"
                  >
                    <option value="squat" className="bg-slate-900">Squat Stage</option>
                    <option value="bench" className="bg-slate-900">Bench Stage</option>
                    <option value="deadlift" className="bg-slate-900">Deadlift Stage</option>
                  </select>
                  <button
                    onClick={() => setActiveGroupFilter(group.name)}
                    className="rounded-lg bg-white/10 px-3 py-2 text-sm"
                  >
                    View Lifters
                  </button>

                  {editingGroupId === group.id ? (
                    <>
                      <input
                        value={editingGroupName}
                        onChange={(e) => setEditingGroupName(e.target.value)}
                        className="h-10 rounded-lg border border-white/20 bg-black/40 px-3 text-sm"
                      />
                      <button onClick={saveEditGroup} className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-black">
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setEditingGroupId(null);
                          setEditingGroupName("");
                        }}
                        className="rounded-lg bg-white/10 px-3 py-2 text-sm"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setStartCompGroupId(startCompGroupId === group.id ? null : group.id)}
                        className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-bold text-black"
                      >
                        Start Competition
                      </button>
                      <button
                        onClick={() => startEditGroup(group)}
                        className="rounded-lg bg-purple-500 px-3 py-2 text-sm font-semibold"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteGroup(group)}
                        className="rounded-lg bg-red-500 px-3 py-2 text-sm font-semibold"
                      >
                        Delete
                      </button>
                    </>
                  )}
                  {startCompGroupId === group.id && (
                    <div className="mt-3 w-full rounded-xl border border-emerald-400/40 bg-emerald-900/30 p-4">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">Select Lifts to Compete</p>
                      <div className="mb-3 flex flex-wrap gap-4">
                        {(["squat", "bench", "deadlift"] as LiftType[]).map((lift) => (
                          <label key={lift} className="flex cursor-pointer items-center gap-2 text-sm text-white">
                            <input
                              type="checkbox"
                              checked={compLifts[lift]}
                              onChange={(e) => setCompLifts((prev) => ({ ...prev, [lift]: e.target.checked }))}
                              className="h-4 w-4 accent-emerald-400"
                            />
                            {lift === "squat" ? "Squats" : lift === "bench" ? "Bench Press" : "Deadlift"}
                          </label>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleStartGroupCompetition(group)}
                          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-black"
                        >
                          Confirm Start
                        </button>
                        <button
                          onClick={() => setStartCompGroupId(null)}
                          className="rounded-lg bg-white/10 px-4 py-2 text-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/15 bg-white/5 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Group Lifter Filter</p>
          {activeGroupFilter && (
            <button onClick={() => setActiveGroupFilter("")} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs">
              Clear Filter
            </button>
          )}
        </div>
        <p className="mb-3 text-sm text-slate-300">
          {activeGroupFilter ? `Showing lifters in Group ${activeGroupFilter}` : "Showing all lifters"}
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select
            value={bulkTargetGroupName}
            onChange={(e) => setBulkTargetGroupName(e.target.value)}
            className="h-10 rounded-lg border border-white/20 bg-black/40 px-3 text-sm"
          >
            <option value="" className="bg-slate-900">Select target group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.name} className="bg-slate-900">
                Group {group.name}
              </option>
            ))}
          </select>
          <button
            onClick={moveCheckedLiftersToGroup}
            className="rounded-lg bg-cyan-500 px-3 py-2 text-xs font-semibold text-black"
          >
            Move Checked Lifters
          </button>
          <button
            onClick={markCheckedAsDoubleCategory}
            className="rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white"
          >
            Set Checked Dual Category
          </button>
          <select
            value={doubleCategoryType}
            onChange={(e) => setDoubleCategoryType(e.target.value as "SUBJR_JR" | "JR_SR" | "SR_M1")}
            className="h-10 rounded-lg border border-white/20 bg-black/40 px-3 text-xs"
          >
            <option value="SUBJR_JR" className="bg-slate-900">Sub-Junior + Junior</option>
            <option value="JR_SR" className="bg-slate-900">Junior + Senior</option>
            <option value="SR_M1" className="bg-slate-900">Senior + Master</option>
          </select>
          <button
            onClick={() => setCheckedLifterIds(visibleLifters.map((lifter) => lifter.id))}
            className="rounded-lg bg-white/10 px-3 py-2 text-xs"
          >
            Check All
          </button>
          <button
            onClick={() => setCheckedLifterIds([])}
            className="rounded-lg bg-white/10 px-3 py-2 text-xs"
          >
            Clear Checked
          </button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-left text-slate-300">
              <tr>
                <th className="px-4 py-3">Select</th>
                <th className="px-4 py-3">Lifter</th>
                <th className="px-4 py-3">Group</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Weight Class</th>
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleLifters.map((l) => {
                const isEditing = editingLifterId === l.id && editingLifterDraft;
                return (
                  <tr key={l.id} className="border-t border-white/10">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={checkedLifterIds.includes(l.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setCheckedLifterIds((prev) => (prev.includes(l.id) ? prev : [...prev, l.id]));
                          } else {
                            setCheckedLifterIds((prev) => prev.filter((id) => id !== l.id));
                          }
                        }}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          value={editingLifterDraft.name}
                          onChange={(e) =>
                            setEditingLifterDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                          }
                          className="h-9 w-full min-w-36 rounded-lg border border-white/20 bg-black/40 px-2 text-sm"
                        />
                      ) : (
                        l.name
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <select
                          value={editingLifterDraft.group}
                          onChange={(e) =>
                            setEditingLifterDraft((prev) => (prev ? { ...prev, group: e.target.value } : prev))
                          }
                          className="h-9 min-w-32 rounded-lg border border-white/20 bg-black/40 px-2 text-sm"
                        >
                          <option value="" className="bg-slate-900">
                            Ungrouped
                          </option>
                          {groups.map((g) => (
                            <option key={g.id} value={g.name} className="bg-slate-900">
                              Group {g.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        l.group || "Ungrouped"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <select
                          value={editingLifterDraft.category}
                          onChange={(e) =>
                            setEditingLifterDraft((prev) => (prev ? { ...prev, category: e.target.value } : prev))
                          }
                          className="h-9 min-w-44 rounded-lg border border-white/20 bg-black/40 px-2 text-sm"
                        >
                          {getCategoryOptions(editingLifterDraft.sex).map((category) => (
                            <option key={category} value={category} className="bg-slate-900">
                              {category}
                            </option>
                          ))}
                        </select>
                      ) : (
                        l.category
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing
                        ? getIPFWeightClass(editingLifterDraft.sex, editingLifterDraft.bodyweight) || "-"
                        : l.weightClass || "-"}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          value={editingLifterDraft.team}
                          onChange={(e) =>
                            setEditingLifterDraft((prev) => (prev ? { ...prev, team: e.target.value } : prev))
                          }
                          className="h-9 w-full min-w-28 rounded-lg border border-white/20 bg-black/40 px-2 text-sm"
                        />
                      ) : (
                        l.team || "-"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <div className="flex gap-2">
                          <select
                            value={editingLifterDraft.sex}
                            onChange={(e) =>
                              setEditingLifterDraft((prev) =>
                                prev ? { ...prev, sex: e.target.value as "Male" | "Female" } : prev,
                              )
                            }
                            className="h-9 rounded-lg border border-white/20 bg-black/40 px-2 text-sm"
                          >
                            <option value="Male" className="bg-slate-900">
                              Male
                            </option>
                            <option value="Female" className="bg-slate-900">
                              Female
                            </option>
                          </select>
                          <input
                            type="number"
                            value={editingLifterDraft.bodyweight}
                            onChange={(e) =>
                              setEditingLifterDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      bodyweight: e.target.value === "" ? "" : Number(e.target.value),
                                    }
                                  : prev,
                              )
                            }
                            placeholder="BW"
                            className="h-9 w-20 rounded-lg border border-white/20 bg-black/40 px-2 text-sm"
                          />
                          <button
                            onClick={saveEditLifter}
                            className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-black"
                          >
                            Save
                          </button>
                          <button onClick={cancelEditLifter} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEditLifter(l)}
                          className="rounded-lg bg-purple-500 px-3 py-1.5 text-xs font-semibold"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {visibleLifters.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-4 text-center text-slate-300">
                    No lifters found for this group.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};

const RefereePage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    competitions,
    activeCompetitionId,
    switchCompetition,
    lifters,
    groups,
    currentLifterId,
    refereeSignals,
    refereeInputLocked,
    currentLift,
    currentAttemptIndex,
    competitionStarted,
    includeCollars,
    competitionMode,
    timerPhase,
    timerEndsAt,
    nextAttemptQueue,
    activeCompetitionGroupName,
    resetSignals,
    connectedRefereeSlots,
  } = useAppContext();
  const connectedCount = [connectedRefereeSlots.left, connectedRefereeSlots.center, connectedRefereeSlots.right].filter(Boolean).length;

  useEffect(() => {
    const requestedCompetitionId = searchParams.get("cid");
    if (requestedCompetitionId && requestedCompetitionId !== activeCompetitionId) {
      const exists = competitions.some((competition) => competition.id === requestedCompetitionId);
      if (exists) {
        switchCompetition(requestedCompetitionId);
      }
    }
  }, [searchParams, activeCompetitionId, competitions, switchCompetition]);

  const [qrModal, setQrModal] = useState<{ slot: RefereeSlot; title: string; url: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    if (!qrModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setQrModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qrModal]);

  const getRefereeBootstrapPayload = (): PersistedState => ({
    lifters,
    groups,
    currentLifterId,
    refereeSignals,
    refereeInputLocked,
    currentLift,
    currentAttemptIndex,
    competitionStarted,
    includeCollars,
    competitionMode,
    nextAttemptQueue,
    timerPhase,
    timerEndsAt,
    activeCompetitionGroupName,
  });

  const buildRefereeLink = (slot: RefereeSlot) => {
    const cidParam = activeCompetitionId ? `?cid=${encodeURIComponent(activeCompetitionId)}` : "";
    const url = `${window.location.origin}${window.location.pathname}#/signals/${slot}${cidParam}`;
    return { url, seedValue: "" };
  };

  const openRefereeScreen = (slot: RefereeSlot) => {
    const { url, seedValue } = buildRefereeLink(slot);
    const popup = window.open(url, "_blank", "width=900,height=700");
    if (!popup) {
      const fallbackParams = new URLSearchParams();
      if (activeCompetitionId) fallbackParams.set("cid", activeCompetitionId);
      if (seedValue) fallbackParams.set("seed", seedValue);
      navigate(`/signals/${slot}${fallbackParams.toString() ? `?${fallbackParams.toString()}` : ""}`);
      return;
    }

    const bootstrapPayload = getRefereeBootstrapPayload();

    // Retry postMessage so referee popup gets state even on slow mobile webviews.
    let tries = 0;
    const postBootstrap = () => {
      if (popup.closed || tries >= 8) return;
      popup.postMessage({ type: "POWERLIFTING_BOOTSTRAP", payload: bootstrapPayload }, window.location.origin);
      tries += 1;
      window.setTimeout(postBootstrap, 250);
    };
    postBootstrap();
  };

  const openQrForSlot = (slot: RefereeSlot, title: string) => {
    setLinkCopied(false);
    const { url } = buildRefereeLink(slot);
    setQrModal({ slot, title, url });
  };

  const copyRefereeLink = async () => {
    if (!qrModal) return;
    try {
      await navigator.clipboard.writeText(qrModal.url);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setLinkCopied(false);
    }
  };

  return (
    <section>
      <SectionHeader title="Referee Signals" path="/signals" />
      <div className="mb-3 inline-flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-200">
        Referees Connected: {connectedCount} / 3
      </div>
      <p className="mb-4 text-sm text-slate-300">
        Tap a referee card for a phone QR code, or use <span className="text-cyan-300">Open in new window</span> from the
        dialog.
      </p>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {REFEREE_SLOT_CONFIG.map((slot) => {
          const signal = refereeSignals[slot.index];
          const isConnected = connectedRefereeSlots[slot.key];
          return (
            <button
              key={slot.key}
              type="button"
              onClick={() => openQrForSlot(slot.key, slot.label)}
              className={`min-w-[210px] flex-1 rounded-2xl border p-6 text-center transition hover:border-cyan-300/60 hover:bg-cyan-500/10 ${
                isConnected ? "border-emerald-400/40 bg-emerald-500/10" : "border-white/15 bg-white/5"
              }`}
            >
              <p className="text-2xl font-semibold text-white">{slot.label}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-300">Referee · tap for QR</p>
              <div className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${isConnected ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700/50 text-slate-400"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
                {isConnected ? "Connected" : "Offline"}
              </div>
              <div
                className={`mx-auto mt-5 h-16 w-16 rounded-xl border border-white/20 ${
                  signal === null ? "bg-slate-700" : signal === "GOOD" ? "bg-emerald-500" : "bg-red-500"
                }`}
              />
              <p className="mt-3 text-sm font-semibold text-slate-100">{signal ?? "PENDING"}</p>
            </button>
          );
        })}
      </div>
      <button onClick={resetSignals} className="mt-5 rounded-xl bg-white/10 px-4 py-2 text-sm">
        Reset All Signals
      </button>

      {qrModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="referee-qr-title"
          onClick={() => setQrModal(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/15 bg-[#0b1222] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="referee-qr-title" className="text-center text-lg font-semibold text-white">
              {qrModal.title} referee
            </h2>
            <p className="mt-1 text-center text-sm text-slate-400">Scan with a phone camera to open this station.</p>
            <div className="mt-4 flex justify-center rounded-xl bg-white p-4">
              <QRCodeSVG value={qrModal.url} size={220} level="M" includeMargin />
            </div>
            <p className="mt-3 max-h-24 overflow-y-auto break-all text-center text-[10px] leading-relaxed text-slate-500">
              {qrModal.url}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => openRefereeScreen(qrModal.slot)}
                className="rounded-xl bg-cyan-500 py-3 text-sm font-semibold text-black"
              >
                Open in new window
              </button>
              <button
                type="button"
                onClick={() => void copyRefereeLink()}
                className="rounded-xl border border-white/20 bg-white/5 py-3 text-sm font-semibold text-white"
              >
                {linkCopied ? "Copied link" : "Copy link"}
              </button>
              <button
                type="button"
                onClick={() => setQrModal(null)}
                className="rounded-xl py-2 text-sm font-medium text-slate-400 hover:text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};

const RefereeStationPage = () => {
  const { station } = useParams();
  const [searchParams] = useSearchParams();
  const config = getRefereeConfig(station);
  const {
    competitions,
    activeCompetitionId,
    switchCompetition,
    refereeSignals,
    setRefereeSignals,
    applyRefereeDecision,
    publishRefereeSignal,
    trackRefereePresence,
    untrackRefereePresence,
  } = useAppContext();
  const [decisionEndsAt, setDecisionEndsAt] = useState<number | null>(null);
  const [pendingDecision, setPendingDecision] = useState<Exclude<RefSignal, null> | null>(null);
  const [now, setNow] = useState(Date.now());
  const holdTimeoutRef = useRef<number | null>(null);
  const commitTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const requestedCompetitionId = searchParams.get("cid");
    if (requestedCompetitionId && requestedCompetitionId !== activeCompetitionId) {
      const exists = competitions.some((competition) => competition.id === requestedCompetitionId);
      if (exists) {
        switchCompetition(requestedCompetitionId);
      }
      return;
    }

    // If station opens directly on another device, auto-load first competition.
    if (!activeCompetitionId && competitions.length > 0) {
      switchCompetition(competitions[0].id);
    }
  }, [searchParams, activeCompetitionId, competitions, switchCompetition]);

  useEffect(() => {
    if (!decisionEndsAt) return;
    const ticker = window.setInterval(() => setNow(Date.now()), 80);
    return () => window.clearInterval(ticker);
  }, [decisionEndsAt]);

  useEffect(() => {
    return () => {
      if (holdTimeoutRef.current) {
        window.clearTimeout(holdTimeoutRef.current);
      }
      if (commitTimeoutRef.current) {
        window.clearTimeout(commitTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!config || !activeCompetitionId) return;
    const timer = window.setTimeout(() => {
      trackRefereePresence(config.index);
    }, 500);
    return () => {
      window.clearTimeout(timer);
      untrackRefereePresence();
    };
  }, [activeCompetitionId, config, trackRefereePresence, untrackRefereePresence]);

  useEffect(() => {
    if (refereeSignals.every((signal) => signal !== null)) {
      const timer = window.setTimeout(() => applyRefereeDecision(), 240);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [refereeSignals, applyRefereeDecision]);

  if (!config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#05070f] text-white">
        <p className="text-slate-400">Invalid referee station.</p>
      </div>
    );
  }

  const cancelPendingDecision = () => {
    if (holdTimeoutRef.current) {
      window.clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    if (commitTimeoutRef.current) {
      window.clearTimeout(commitTimeoutRef.current);
      commitTimeoutRef.current = null;
    }
    setPendingDecision(null);
    setDecisionEndsAt(null);
  };

  const startDecisionHold = (decision: Exclude<RefSignal, null>, event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (pendingDecision) return;
    const commitAt = Date.now() + REFEREE_CONFIRM_DELAY_MS;
    setPendingDecision(decision);
    setDecisionEndsAt(commitAt);
    holdTimeoutRef.current = window.setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(80);
      const nextSignals = refereeSignals.map((signal, idx) => (idx === config.index ? decision : signal));
      publishRefereeSignal(config.index, decision);
      commitTimeoutRef.current = window.setTimeout(() => {
        setRefereeSignals(nextSignals);
        commitTimeoutRef.current = null;
      }, 90);
      holdTimeoutRef.current = null;
      setPendingDecision(null);
      setDecisionEndsAt(null);
    }, REFEREE_CONFIRM_DELAY_MS);
  };

  const countdown = decisionEndsAt ? Math.max(0, (decisionEndsAt - now) / 1000) : 0;
  const currentSignal = refereeSignals[config.index];

  const signalColor =
    currentSignal === "GOOD"
      ? "text-emerald-400"
      : currentSignal === "NO"
      ? "text-red-400"
      : "text-slate-400";

  return (
    <div className="flex min-h-screen flex-col bg-[#05070f] text-white select-none">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500">Referee Station</p>
          <p className="text-lg font-bold text-white">{config.label}</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Connected
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-8">
        {pendingDecision ? (
          <div className="text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-300">
              Hold {pendingDecision}…
            </p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-amber-200">{countdown.toFixed(1)}s</p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-xs uppercase tracking-widest text-slate-500">Current</p>
            <p className={`mt-1 text-2xl font-bold ${signalColor}`}>{currentSignal ?? "PENDING"}</p>
          </div>
        )}

        <div className="grid w-full max-w-sm gap-4">
          <button
            onPointerDown={(event) => startDecisionHold("GOOD", event)}
            onPointerUp={cancelPendingDecision}
            onPointerLeave={cancelPendingDecision}
            onPointerCancel={cancelPendingDecision}
            className="h-28 touch-manipulation rounded-2xl bg-emerald-500 text-2xl font-extrabold text-black shadow-lg shadow-emerald-500/20 active:scale-95 transition-transform"
          >
            GOOD LIFT
          </button>
          <button
            onPointerDown={(event) => startDecisionHold("NO", event)}
            onPointerUp={cancelPendingDecision}
            onPointerLeave={cancelPendingDecision}
            onPointerCancel={cancelPendingDecision}
            className="h-28 touch-manipulation rounded-2xl bg-red-500 text-2xl font-extrabold text-white shadow-lg shadow-red-500/20 active:scale-95 transition-transform"
          >
            NO LIFT
          </button>
        </div>

        <p className="text-center text-xs text-slate-600">Hold button to confirm your decision</p>
      </div>
    </div>
  );
};

const ScreenPage = () => {
  const {
    lifters,
    groups,
    currentLifterId,
    refereeSignals,
    refereeInputLocked,
    currentLift,
    currentAttemptIndex,
    competitionStarted,
    includeCollars,
    competitionMode,
    timerPhase,
    timerEndsAt,
    nextAttemptQueue,
    activeCompetitionGroupName,
    competitions,
    activeCompetitionId,
  } = useAppContext();
  const [screenType, setScreenType] = useState("signal_results_plate");

  const openDisplayScreen = () => {
    const activeCompetitionName =
      competitions.find((c) => c.id === activeCompetitionId)?.name ?? "Competition";
    const seededCompetition = normalizeCompetitionRecord({
      id: activeCompetitionId ?? `comp-${Date.now()}`,
      name: activeCompetitionName,
      createdAt: Date.now(),
      lifters,
      groups,
      currentLifterId,
      refereeSignals,
      refereeInputLocked,
      currentLift,
      currentAttemptIndex,
      competitionStarted,
      includeCollars,
      competitionMode,
      nextAttemptQueue,
      timerPhase,
      timerEndsAt,
      activeCompetitionGroupName,
    });
    const seedValue = encodeUrlSeed(seededCompetition);
    const seedParam = seedValue ? `&seed=${encodeURIComponent(seedValue)}` : "";
    const cidParam = activeCompetitionId ? `&cid=${encodeURIComponent(activeCompetitionId)}` : "";
    const url = `${window.location.origin}${window.location.pathname}#/display/full?layout=${screenType}&live=1${cidParam}${seedParam}`;
    const popup = window.open(url, "_blank", "width=1280,height=720");

    if (!popup) return;

    const bootstrapPayload: PersistedState = {
      lifters,
      groups,
      currentLifterId,
      refereeSignals,
      refereeInputLocked,
      currentLift,
      currentAttemptIndex,
      competitionStarted,
      includeCollars,
      competitionMode,
      nextAttemptQueue,
      timerPhase,
      timerEndsAt,
      activeCompetitionGroupName,
    };

    // Retry a few times so the new tab receives state even if it boots slowly on mobile webviews.
    let tries = 0;
    const postBootstrap = () => {
      if (popup.closed || tries >= 8) return;
      popup.postMessage({ type: "POWERLIFTING_BOOTSTRAP", payload: bootstrapPayload }, window.location.origin);
      tries += 1;
      window.setTimeout(postBootstrap, 250);
    };

    postBootstrap();
  };

  return (
    <section>
      <SectionHeader title="Display Screens" path="/screen" />
      <div className="rounded-2xl border border-white/15 bg-white/5 p-5">
        <label className="mb-2 block text-sm text-slate-300">Screen Template</label>
        <select
          value={screenType}
          onChange={(e) => setScreenType(e.target.value)}
          className="h-11 w-full rounded-xl border border-white/20 bg-black/40 px-3 md:w-auto"
        >
          <option value="signal_results_plate" className="bg-slate-900">1. Referee Signal + Results + IPF Plate</option>
          <option value="signal_results" className="bg-slate-900">2. Referee Signal + Results</option>
          <option value="order_attempts" className="bg-slate-900">3. Lifter Order With Attempts</option>
          <option value="results_all" className="bg-slate-900">4. Results All</option>
          <option value="ipf_plate" className="bg-slate-900">5. IPF Plate Only</option>
        </select>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            onClick={openDisplayScreen}
            className="rounded-xl bg-cyan-500 px-4 py-2 font-semibold text-black"
          >
            Open Live Screen
          </button>
        </div>
      </div>
    </section>
  );
};

const bestLift = (attempts: Attempt[]) =>
  attempts.reduce((best, cur) => {
    if (cur.status !== "GOOD" || cur.weight === "") return best;
    return cur.weight > best ? cur.weight : best;
  }, 0);

const IPF_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5];

const PLATE_COLORS: Record<string, string> = {
  "25": "#dc2626",
  "20": "#2563eb",
  "15": "#eab308",
  "10": "#16a34a",
  "5": "#f8fafc",
  "2.5": "#111827",
  "1.25": "#6b7280",
  "0.5": "#94a3b8",
};

const PLATE_HEIGHT: Record<string, number> = {
  "25": 140,
  "20": 132,
  "15": 124,
  "10": 116,
  "5": 98,
  "2.5": 88,
  "1.25": 78,
  "0.5": 70,
};

const PLATE_WIDTH: Record<string, number> = {
  "25": 24,
  "20": 22,
  "15": 20,
  "10": 18,
  "5": 16,
  "2.5": 14,
  "1.25": 12,
  "0.5": 10,
};

const buildPlateBreakdown = (weight: number, includeCollars: boolean) => {
  const collarWeight = includeCollars ? COLLAR_PAIR_KG : 0;
  if (!Number.isFinite(weight) || weight < BAR_WEIGHT_KG + collarWeight) return [] as number[];
  let perSide = (weight - BAR_WEIGHT_KG - collarWeight) / 2;
  if (perSide <= 0) return [] as number[];
  const loaded: number[] = [];
  for (const plate of IPF_PLATES) {
    while (perSide + 0.0001 >= plate) {
      loaded.push(plate);
      perSide -= plate;
    }
  }
  return loaded;
};

const formatPerSideLoading = (plates: number[], includeCollars: boolean) => {
  const parts = plates.map((plate) => `${plate}`);
  if (includeCollars) parts.push("collar");
  return parts.length ? parts.join(" + ") : includeCollars ? "collar" : "bar only";
};

const formatAttemptWeight = (attempt: Attempt) => (attempt.weight === "" ? "-" : `${attempt.weight}`);

const AttemptDisplayCell = ({ attempt }: { attempt: Attempt }) => {
  const isNoLift = attempt.status === "NO";
  const isGood = attempt.status === "GOOD";
  const isPending = attempt.status === "PENDING";
  return (
    <td
      className={`px-2 py-2 text-center text-base font-semibold md:text-lg ${
        isGood
          ? "bg-green-500/20 text-green-100"
          : isNoLift
            ? "bg-red-500/20 text-red-100"
            : isPending
              ? "bg-amber-500/20 text-amber-100"
              : "bg-white/5 text-slate-300"
      }`}
    >
      <span className={isNoLift ? "line-through decoration-2" : ""}>{formatAttemptWeight(attempt)}</span>
    </td>
  );
};

const PlateStack = ({ weight, includeCollars }: { weight: number; includeCollars: boolean }) => {
  const perSide = buildPlateBreakdown(weight, includeCollars);
  const leftSide = [...perSide].reverse();

  const renderPlate = (plate: number, index: number, side: "left" | "right") => {
    const color = PLATE_COLORS[String(plate)] || "#64748b";
    const textIsDark = plate === 15 || plate === 5;
    return (
      <div
        key={`${side}-${plate}-${index}`}
        className="relative flex items-start justify-center rounded-sm border border-black/30"
        style={{
          width: `${PLATE_WIDTH[String(plate)]}px`,
          height: `${PLATE_HEIGHT[String(plate)]}px`,
          backgroundColor: color,
          boxShadow: "inset 0 0 10px rgba(255,255,255,0.28)",
        }}
      >
        <span className={`pt-1 text-[10px] font-bold ${textIsDark ? "text-black" : "text-white"}`}>{plate}</span>
      </div>
    );
  };

  const collarNode = (side: "left" | "right") => (
    <div
      key={`collar-${side}`}
      className="flex h-[66px] w-[12px] items-center justify-center rounded-sm border border-black/40 bg-slate-500"
      style={{ boxShadow: "inset 0 0 8px rgba(255,255,255,0.35)" }}
    />
  );

  return (
    <div className="w-full rounded-2xl border border-black/15 bg-white/90 p-4 text-black">
      <p className="text-sm font-semibold tracking-wide">
        BAR LOADING: {weight.toFixed(1)} kg {includeCollars ? "(with collar)" : "(without collar)"}
      </p>
      <div className="mt-4 flex items-center justify-center gap-2">
        <div className="flex items-end gap-[2px]">
          {includeCollars && collarNode("left")}
          {leftSide.map((plate, index) => renderPlate(plate, index, "left"))}
        </div>
        <div className="relative h-4 w-[200px] rounded-full bg-gradient-to-r from-slate-700 via-slate-500 to-slate-700">
          <div className="absolute right-0 top-1/2 h-6 w-3 -translate-y-1/2 rounded bg-slate-400" />
          <div className="absolute left-0 top-1/2 h-6 w-3 -translate-y-1/2 rounded bg-slate-400" />
        </div>
        <div className="flex items-end gap-[2px]">
          {perSide.map((plate, index) => renderPlate(plate, index, "right"))}
          {includeCollars && collarNode("right")}
        </div>
      </div>
      <p className="mt-4 text-center font-serif text-2xl font-bold md:text-5xl">{formatPerSideLoading(perSide, includeCollars)}</p>
    </div>
  );
};

const ResultsPage = () => {
  const { lifters, setLifters } = useAppContext();
  const [searchTerm, setSearchTerm] = useState("");
  const [notice, setNotice] = useState("");
  const [attemptDrafts, setAttemptDrafts] = useState<Record<string, string>>({});

  const updateAttemptCell = (
    lifterId: string,
    lift: LiftType,
    attemptIndex: number,
    patch: Partial<Attempt>,
  ): { ok: boolean; message: string } => {
    const lifterIndex = lifters.findIndex((l) => l.id === lifterId);
    if (lifterIndex < 0) return { ok: false, message: "Lifter not found." };
    const source = lifters[lifterIndex];
    const attempts = [...getAttempts(source, lift)];
    const baseAttempt = attempts[attemptIndex] ?? { weight: "", status: "UNATTEMPTED" as AttemptStatus };
    const nextAttempt = { ...baseAttempt, ...patch };

    if (nextAttempt.weight !== "" && Math.round(Number(nextAttempt.weight) * 10) % 25 !== 0) {
      return { ok: false, message: "Use 2.5kg increments for attempt weight." };
    }

    if (nextAttempt.weight === "" && (nextAttempt.status === "GOOD" || nextAttempt.status === "NO")) {
      return { ok: false, message: "Set a weight before marking Good or No." };
    }

    attempts[attemptIndex] = nextAttempt;
    const updated = [...lifters];
    updated[lifterIndex] = setAttempts(source, lift, attempts);
    setLifters(updated);
    return { ok: true, message: "Attempt updated." };
  };

  const getDraftKey = (lifterId: string, lift: LiftType, attemptIndex: number) => `${lifterId}-${lift}-${attemptIndex}`;

  const commitAttemptWeight = (lifterId: string, lift: LiftType, attemptIndex: number, fallbackWeight: number | "") => {
    const key = getDraftKey(lifterId, lift, attemptIndex);
    const rawDraft = attemptDrafts[key];
    if (typeof rawDraft === "undefined") return;

    const normalized = rawDraft.trim();
    const nextWeight: number | "" = normalized === "" ? "" : Number(normalized);
    if (normalized !== "" && !Number.isFinite(nextWeight)) {
      setNotice("Enter a valid number.");
      return;
    }

    const result = updateAttemptCell(lifterId, lift, attemptIndex, {
      weight: normalized === "" ? "" : Number(Number(nextWeight).toFixed(1)),
    });
    setNotice(result.message);
    if (!result.ok) return;

    const fallbackValue = fallbackWeight === "" ? "" : String(fallbackWeight);
    if (normalized === fallbackValue) {
      setAttemptDrafts((prev) => {
        const { [key]: _ignored, ...rest } = prev;
        return rest;
      });
      return;
    }

    setAttemptDrafts((prev) => {
      const { [key]: _ignored, ...rest } = prev;
      return rest;
    });
  };

  const filteredLifters = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return lifters;
    return lifters.filter((lifter) => {
      const haystack = `${lifter.name} ${lifter.team} ${lifter.group} ${lifter.weightClass}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [lifters, searchTerm]);

  const ranking = useMemo(
    () =>
      [...lifters]
        .map((l) => {
          const squat = bestLift(l.squatAttempts);
          const bench = bestLift(l.benchAttempts);
          const deadlift = bestLift(l.deadliftAttempts);
          const total = squat + bench + deadlift;
          const glPoints = l.bodyweight && total ? Number(((total / Number(l.bodyweight)) * 10).toFixed(2)) : 0;
          return { ...l, squat, bench, deadlift, total, glPoints };
        })
        .sort((a, b) => b.glPoints - a.glPoints),
    [lifters],
  );

  return (
    <section>
      <SectionHeader title="Results (GL Points)" path="/results" />
      <div className="mb-4 flex flex-wrap gap-3">
        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search lifter, team, group"
          className="h-11 w-full max-w-sm rounded-xl border border-white/20 bg-white/5 px-3 text-sm text-white outline-none ring-cyan-400 transition focus:ring"
        />
      </div>
      {notice && <p className="mb-3 text-sm text-amber-200">{notice}</p>}
      <div className="overflow-x-auto rounded-2xl border border-white/15 bg-black/20">
        <table className="min-w-[1600px] text-sm">
          <thead className="bg-white/5 text-left text-slate-300">
            <tr>
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Lifter</th>
              <th className="px-4 py-3">Group</th>
              <th className="px-4 py-3">Team</th>
              <th className="px-4 py-3">SQ1</th>
              <th className="px-4 py-3">SQ2</th>
              <th className="px-4 py-3">SQ3</th>
              <th className="px-4 py-3">BP1</th>
              <th className="px-4 py-3">BP2</th>
              <th className="px-4 py-3">BP3</th>
              <th className="px-4 py-3">DL1</th>
              <th className="px-4 py-3">DL2</th>
              <th className="px-4 py-3">DL3</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">GL</th>
            </tr>
          </thead>
          <tbody>
            {ranking
              .filter((ranked) => filteredLifters.some((row) => row.id === ranked.id))
              .map((r, idx) => {
                const renderEditor = (lift: LiftType, attemptIndex: number) => {
                  const attempt = getAttempts(r, lift)[attemptIndex] ?? { weight: "", status: "UNATTEMPTED" as AttemptStatus };
                  const statusClass =
                    attempt.status === "GOOD"
                      ? "bg-green-500/20"
                      : attempt.status === "NO"
                        ? "bg-red-500/20"
                        : attempt.status === "PENDING"
                          ? "bg-amber-500/20"
                          : "bg-white/5";
                  return (
                    <td key={`${r.id}-${lift}-${attemptIndex}`} className="px-2 py-2 align-top">
                      <div className={`rounded-lg border border-white/10 p-2 ${statusClass}`}>
                        <input
                          type="number"
                          step="2.5"
                          value={attemptDrafts[getDraftKey(r.id, lift, attemptIndex)] ?? (attempt.weight === "" ? "" : attempt.weight)}
                          onChange={(e) =>
                            setAttemptDrafts((prev) => ({
                              ...prev,
                              [getDraftKey(r.id, lift, attemptIndex)]: e.target.value,
                            }))
                          }
                          onBlur={() => commitAttemptWeight(r.id, lift, attemptIndex, attempt.weight)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.currentTarget.blur();
                            }
                          }}
                          className={`h-8 w-full rounded border border-white/20 bg-black/30 px-2 text-xs text-white ${
                            attempt.status === "NO" ? "line-through" : ""
                          }`}
                        />
                        <select
                          value={attempt.status}
                          onChange={(e) => {
                            const result = updateAttemptCell(r.id, lift, attemptIndex, {
                              status: e.target.value as AttemptStatus,
                            });
                            setNotice(result.message);
                          }}
                          className="mt-1 h-8 w-full rounded border border-white/20 bg-black/40 px-1 text-xs text-white"
                        >
                          <option value="UNATTEMPTED" className="bg-slate-900">UNATTEMPTED</option>
                          <option value="PENDING" className="bg-slate-900">PENDING</option>
                          <option value="GOOD" className="bg-slate-900">GOOD</option>
                          <option value="NO" className="bg-slate-900">NO</option>
                        </select>
                      </div>
                    </td>
                  );
                };

                return (
                  <tr key={r.id} className="border-t border-white/10">
                    <td className="px-4 py-3">{idx + 1}</td>
                    <td className="px-4 py-3 font-semibold">{r.name}</td>
                    <td className="px-4 py-3">{r.group || "-"}</td>
                    <td className="px-4 py-3">{r.team || "-"}</td>
                    {renderEditor("squat", 0)}
                    {renderEditor("squat", 1)}
                    {renderEditor("squat", 2)}
                    {renderEditor("bench", 0)}
                    {renderEditor("bench", 1)}
                    {renderEditor("bench", 2)}
                    {renderEditor("deadlift", 0)}
                    {renderEditor("deadlift", 1)}
                    {renderEditor("deadlift", 2)}
                    <td className="px-4 py-3 font-semibold">{r.total} kg</td>
                    <td className="px-4 py-3">{r.glPoints}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const SettingsPage = () => {
  const { lifters, setLifters } = useAppContext();

  return (
    <section>
      <SectionHeader title="Settings & Backup" path="/settings" />
      <div className="rounded-2xl border border-white/15 bg-white/5 p-5">
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => {
              const blob = new Blob([JSON.stringify(lifters, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "lifters-backup.json";
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="rounded-xl bg-cyan-500 px-4 py-2 font-semibold text-black"
          >
            Export Backup
          </button>
          <label className="rounded-xl bg-white/10 px-4 py-2 text-sm">
            Import Backup
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const text = await file.text();
                setLifters(JSON.parse(text));
              }}
            />
          </label>
        </div>
      </div>
    </section>
  );
};

const DisplayFullPage = () => {
  const {
    lifters,
    currentLifterId,
    setCurrentLifterId,
    refereeSignals,
    currentLift,
    currentAttemptIndex,
    competitionStarted,
    includeCollars,
    timerPhase,
    timerEndsAt,
    activeCompetitionGroupName,
  } = useAppContext();
  const [searchParams] = useSearchParams();
  const rawLayout = searchParams.get("layout") || "signal_results_plate";
  const displayMode =
    rawLayout === "full" || rawLayout === "bar_loading"
      ? "signal_results_plate"
      : rawLayout === "results"
        ? "results_all"
        : rawLayout;
  const forceLive = searchParams.get("live") === "1";
  const [showSignalOverlay, setShowSignalOverlay] = useState(false);
  const [displaySignals, setDisplaySignals] = useState<RefSignal[]>([null, null, null]);
  const [overlayPhase, setOverlayPhase] = useState<"circles" | "lift" | null>(null);
  const [displayTheme, setDisplayTheme] = useState<DisplayThemeKey>("black");

  const cycleDisplayTheme = () => {
    setDisplayTheme((prev) => {
      const currentIdx = DISPLAY_THEME_ORDER.indexOf(prev);
      const nextIdx = (currentIdx + 1) % DISPLAY_THEME_ORDER.length;
      return DISPLAY_THEME_ORDER[nextIdx];
    });
  };
  const activeTheme = DISPLAY_THEME_CONFIG[displayTheme];
  const isDarkTheme = activeTheme.tone === "dark";
  const displayRootClass = `relative min-h-screen px-3 py-4 md:px-6 ${activeTheme.rootClass}`;
  const displayRootStyle: CSSProperties = {
    textRendering: "optimizeLegibility",
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
    fontVariantNumeric: "tabular-nums",
  };
  const themeButtonClass = activeTheme.buttonClass;
  const sortedLifters = useMemo(
    () =>
      [...lifters].sort((a, b) => {
        const lotA = typeof a.lot === "number" ? a.lot : Number.POSITIVE_INFINITY;
        const lotB = typeof b.lot === "number" ? b.lot : Number.POSITIVE_INFINITY;
        if (lotA !== lotB) return lotA - lotB;
        return a.name.localeCompare(b.name);
      }),
    [lifters],
  );
  const currentLifter = lifters.find((l) => l.id === currentLifterId) ?? sortedLifters[0] ?? null;
  const currentWeight = currentLifter ? resolveAttemptWeight(currentLifter, currentLift, currentAttemptIndex) : 20;
  const loadingWeight = currentWeight;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!timerEndsAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [timerEndsAt]);

  const displayTimerSeconds = timerEndsAt ? Math.max(0, Math.ceil((timerEndsAt - now) / 1000)) : 0;

  useEffect(() => {
    if (!currentLifterId && currentLifter) {
      setCurrentLifterId(currentLifter.id);
    }
  }, [currentLifterId, currentLifter, setCurrentLifterId]);

  useEffect(() => {
    if (refereeSignals.every((signal) => signal !== null)) {
      setDisplaySignals(refereeSignals);
      const allGood = refereeSignals.every((s) => s === "GOOD");
      if (allGood) {
        setOverlayPhase("circles");
        const t1 = window.setTimeout(() => setOverlayPhase("lift"), 2000);
        const t2 = window.setTimeout(() => { setOverlayPhase(null); }, 3000);
        return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
      } else {
        setShowSignalOverlay(true);
        const t = window.setTimeout(() => setShowSignalOverlay(false), 3000);
        return () => window.clearTimeout(t);
      }
    }
    return undefined;
  }, [refereeSignals]);

  const ranking = useMemo(
    () =>
      [...lifters]
        .map((l) => {
          const squat = bestLift(l.squatAttempts);
          const bench = bestLift(l.benchAttempts);
          const deadlift = bestLift(l.deadliftAttempts);
          const total = squat + bench + deadlift;
          const points = l.bodyweight && total ? Number(((total / Number(l.bodyweight)) * 10).toFixed(2)) : 0;
          return { ...l, total, points };
        })
        .sort((a, b) => b.points - a.points),
    [lifters],
  );

  const displaySessionLifters = useMemo(
    () =>
      activeCompetitionGroupName !== null
        ? lifters.filter((l) => l.group === activeCompetitionGroupName)
        : lifters,
    [lifters, activeCompetitionGroupName],
  );

  const orderedByCurrentRound = useMemo(
    () => orderLiftersByIPF(displaySessionLifters, currentLift, currentAttemptIndex),
    [displaySessionLifters, currentLift, currentAttemptIndex],
  );

  if (displayMode === "ipf_plate") {
    return (
      <div className={displayRootClass} style={displayRootStyle}>
        {!competitionStarted && !forceLive && (
          <div
            className={`mb-3 inline-block rounded border px-3 py-1 text-xs font-semibold ${
              isDarkTheme
                ? "border-amber-500/50 bg-amber-400/15 text-amber-200"
                : "border-amber-600 bg-amber-100 text-amber-900"
            }`}
          >
            Competition not started. Preview mode is active.
          </div>
        )}
        <div className="mx-auto w-full max-w-7xl">
          <p className="mb-2 text-center text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300 md:text-base">
            Design by SUMIT BHANJA
          </p>
          <div className="mb-4 text-center">
            <p className="text-lg font-semibold uppercase tracking-[0.2em] text-cyan-200 md:text-2xl">
              {currentLift.toUpperCase()} ATTEMPT {currentAttemptIndex + 1}
            </p>
            <p className="mt-2 text-[clamp(2rem,6vw,4.6rem)] font-black uppercase leading-tight">{currentLifter?.name || "NO LIFTER"}</p>
            <p className="mt-2 text-[clamp(2.6rem,8vw,5.5rem)] font-bold leading-tight">{loadingWeight.toFixed(1)} kg</p>
            {timerPhase === "ATTEMPT" && timerEndsAt && (
              <p className="mt-2 text-xl font-bold text-cyan-300 md:text-3xl">
                Timer: {Math.floor(displayTimerSeconds / 60)}:{String(displayTimerSeconds % 60).padStart(2, "0")}
              </p>
            )}
          </div>

          <PlateStack weight={loadingWeight} includeCollars={includeCollars} />
        </div>

        <button
          onClick={cycleDisplayTheme}
          className={themeButtonClass}
        >
          Theme: {activeTheme.label}
        </button>
      </div>
    );
  }

  // Viewport-fitted display screen — no page scroll, all content fits inside h-screen.
  if (["signal_results_plate", "signal_results", "order_attempts", "results_all"].includes(displayMode)) {
    const hasPlate = displayMode === "signal_results_plate";
    const hasSignals = ["signal_results_plate", "signal_results"].includes(displayMode);
    return (
      <div
        className={`relative flex h-screen flex-col overflow-hidden ${activeTheme.rootClass}`}
        style={displayRootStyle}
      >
        {/* ── Top header strip ── */}
        <div className="flex-none border-b border-white/10 px-3 py-2 md:px-5 md:py-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="text-[clamp(0.95rem,2.2vw,1.6rem)] font-black uppercase leading-tight tracking-tight">
              {currentLifter?.name || "NO LIFTER"}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-right">
              <p className="text-[clamp(0.75rem,1.6vw,1.1rem)] font-semibold uppercase text-cyan-300">
                {currentLift.toUpperCase()} · ATT {currentAttemptIndex + 1}
              </p>
              <p className="text-[clamp(0.9rem,2vw,1.4rem)] font-bold">
                {loadingWeight.toFixed(1)} kg
              </p>
              {timerPhase === "ATTEMPT" && timerEndsAt && (
                <p className="text-[clamp(0.8rem,1.8vw,1.2rem)] font-bold text-amber-300">
                  ⏱ {Math.floor(displayTimerSeconds / 60)}:{String(displayTimerSeconds % 60).padStart(2, "0")}
                </p>
              )}
            </div>
          </div>
          {!competitionStarted && !forceLive && (
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-amber-400">
              Preview mode — competition not started
            </p>
          )}
        </div>

        {/* ── Middle: plate + referee signal circles ── */}
        {(hasPlate || hasSignals) && (
          <div className="flex-none flex flex-wrap items-center gap-3 border-b border-white/10 px-3 py-2 md:px-5 md:py-3">
            {hasPlate && (
              <div className="flex-1 min-w-0">
                <PlateStack weight={loadingWeight} includeCollars={includeCollars} />
              </div>
            )}
            {hasSignals && (
              <div className="flex flex-none items-center gap-3 md:gap-5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Referees</p>
                {refereeSignals.map((signal, idx) => (
                  <div
                    key={idx}
                    className={`h-10 w-10 rounded-full border-2 transition-all duration-300 md:h-14 md:w-14 ${
                      signal === null
                        ? "border-slate-600 bg-slate-800"
                        : signal === "GOOD"
                          ? "border-white bg-white shadow-[0_0_18px_rgba(255,255,255,0.8)]"
                          : "border-red-500 bg-red-600 shadow-[0_0_18px_rgba(239,68,68,0.8)]"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Bottom: results / order table — scrolls internally ── */}
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2 md:px-5 md:py-3">
          {displayMode === "order_attempts" ? (
            <div className="flex h-full flex-col gap-3">
              <div className="rounded-xl border border-white/20 bg-black/30 p-3 text-center">
                <p className="text-[clamp(0.8rem,1.8vw,1.3rem)] font-semibold uppercase tracking-[0.2em] text-cyan-200">
                  {currentLift.toUpperCase()} ATTEMPT {currentAttemptIndex + 1}
                </p>
              </div>
              <div className="grid flex-none gap-2 md:grid-cols-3">
                {orderedByCurrentRound.slice(0, 3).map((lifter, idx) => {
                  const attemptWeight = getAttemptValue(lifter, currentLift, currentAttemptIndex);
                  return (
                    <div
                      key={lifter.id}
                      className={`rounded-xl border p-3 md:p-4 ${
                        lifter.id === currentLifterId ? "border-cyan-300/80 bg-cyan-500/15" : "border-white/20 bg-black/30"
                      }`}
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-200">#{idx + 1}</p>
                      <p className="mt-1 text-[clamp(1rem,2.5vw,2rem)] font-black uppercase leading-tight">{lifter.name || "-"}</p>
                      <p className="mt-1 text-[clamp(0.9rem,2vw,1.6rem)] font-bold">
                        {attemptWeight === null ? "-" : `${attemptWeight.toFixed(1)} kg`}
                      </p>
                      <p className="mt-1 text-xs text-slate-300">
                        BW {typeof lifter.bodyweight === "number" ? lifter.bodyweight : "-"} · Lot {typeof lifter.lot === "number" ? lifter.lot : "-"}
                      </p>
                    </div>
                  );
                })}
              </div>
              <div className="rounded-xl border border-white/15 bg-black/20 p-3">
                <p className="mb-2 text-[10px] uppercase tracking-widest text-cyan-300">Other Lifters</p>
                <div className="space-y-1">
                  {orderedByCurrentRound.slice(3).map((lifter, idx) => {
                    const attemptWeight = getAttemptValue(lifter, currentLift, currentAttemptIndex);
                    return (
                      <div
                        key={lifter.id}
                        className={`flex items-center justify-between rounded-lg border px-3 py-1.5 text-sm ${
                          lifter.id === currentLifterId ? "border-cyan-300/70 bg-cyan-500/10" : "border-white/10 bg-white/5"
                        }`}
                      >
                        <span className="font-semibold">{idx + 4}. {lifter.name}</span>
                        <span className="text-slate-300 text-xs">
                          {attemptWeight === null ? "-" : `${attemptWeight.toFixed(1)} kg`} · BW {typeof lifter.bodyweight === "number" ? lifter.bodyweight : "-"} · Lot {typeof lifter.lot === "number" ? lifter.lot : "-"}
                        </span>
                      </div>
                    );
                  })}
                  {orderedByCurrentRound.length === 0 && (
                    <p className="text-sm text-slate-400">No lifters added yet.</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full overflow-auto rounded-xl border border-white/15 bg-black/20">
              <table className="w-full min-w-[900px] text-xs md:text-sm">
                <thead className="sticky top-0 bg-slate-900 text-left text-slate-300">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Lifter</th>
                    <th className="px-3 py-2 hidden md:table-cell">Group</th>
                    <th className="px-3 py-2 hidden md:table-cell">Team</th>
                    <th className="px-3 py-2">SQ1</th>
                    <th className="px-3 py-2">SQ2</th>
                    <th className="px-3 py-2">SQ3</th>
                    <th className="px-3 py-2">BP1</th>
                    <th className="px-3 py-2">BP2</th>
                    <th className="px-3 py-2">BP3</th>
                    <th className="px-3 py-2">DL1</th>
                    <th className="px-3 py-2">DL2</th>
                    <th className="px-3 py-2">DL3</th>
                    <th className="px-3 py-2 font-semibold">Total</th>
                    <th className="px-3 py-2 hidden md:table-cell">GL</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((lifter, idx) => (
                    <tr
                      key={lifter.id}
                      className={`border-t border-white/10 ${lifter.id === currentLifterId ? "bg-cyan-500/10" : ""}`}
                    >
                      <td className="px-3 py-2">{idx + 1}</td>
                      <td className="px-3 py-2 font-semibold">{lifter.name || "-"}</td>
                      <td className="px-3 py-2 hidden md:table-cell">{lifter.group || "-"}</td>
                      <td className="px-3 py-2 hidden md:table-cell">{lifter.team || "-"}</td>
                      <AttemptDisplayCell attempt={lifter.squatAttempts[0]} />
                      <AttemptDisplayCell attempt={lifter.squatAttempts[1]} />
                      <AttemptDisplayCell attempt={lifter.squatAttempts[2]} />
                      <AttemptDisplayCell attempt={lifter.benchAttempts[0]} />
                      <AttemptDisplayCell attempt={lifter.benchAttempts[1]} />
                      <AttemptDisplayCell attempt={lifter.benchAttempts[2]} />
                      <AttemptDisplayCell attempt={lifter.deadliftAttempts[0]} />
                      <AttemptDisplayCell attempt={lifter.deadliftAttempts[1]} />
                      <AttemptDisplayCell attempt={lifter.deadliftAttempts[2]} />
                      <td className="px-3 py-2 font-semibold">{lifter.total} kg</td>
                      <td className="px-3 py-2 hidden md:table-cell">{lifter.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── IPF Good Lift: Phase 1 — 3 white circles (2 s) ── */}
        {overlayPhase === "circles" && (
          <div className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center bg-black">
            <div className="flex gap-6 md:gap-12 lg:gap-20">
              {[0, 1, 2].map((idx) => (
                <motion.div
                  key={idx}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: idx * 0.28, type: "spring", stiffness: 220, damping: 14 }}
                  className="h-24 w-24 rounded-full bg-white shadow-[0_0_80px_rgba(255,255,255,0.95)] md:h-40 md:w-40 lg:h-52 lg:w-52"
                />
              ))}
            </div>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.9, duration: 0.4 }}
              className="mt-10 text-[clamp(1.4rem,4vw,3rem)] font-black uppercase tracking-[0.35em] text-white"
            >
              GOOD LIFT
            </motion.p>
          </div>
        )}

        {/* ── IPF Good Lift: Phase 2 — lift-specific animation (1.5 s) ── */}
        {overlayPhase === "lift" && (
          <div className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center bg-black">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 280, damping: 16 }}
              className="flex flex-col items-center gap-6 text-center"
            >
              <p className="text-[clamp(3rem,10vw,7rem)] font-black uppercase leading-none tracking-tight text-white">
                GOOD LIFT
              </p>

              {currentLift === "bench" && (
                <div className="relative flex items-center justify-center">
                  <motion.div
                    animate={{ y: [0, -30, 0, -20, 0] }}
                    transition={{ duration: 1.4, ease: "easeInOut" }}
                    className="relative flex items-center"
                  >
                    <div className="h-6 w-6 rounded bg-amber-400 md:h-8 md:w-8" />
                    <div className="h-3 w-32 rounded-full bg-white md:h-4 md:w-56" />
                    <div className="h-6 w-6 rounded bg-amber-400 md:h-8 md:w-8" />
                  </motion.div>
                </div>
              )}

              {currentLift === "squat" && (
                <div className="flex items-end justify-center gap-6">
                  <motion.div
                    animate={{ scaleY: [0.5, 1, 0.5, 1] }}
                    style={{ transformOrigin: "bottom", height: "clamp(60px,10vw,120px)" }}
                    transition={{ duration: 1.4, ease: "easeInOut" }}
                    className="w-10 rounded-t-full bg-white md:w-16"
                  />
                  <motion.div
                    animate={{ scaleY: [0.5, 1, 0.5, 1] }}
                    style={{ transformOrigin: "bottom", height: "clamp(80px,12vw,140px)" }}
                    transition={{ duration: 1.4, ease: "easeInOut", delay: 0.05 }}
                    className="w-10 rounded-t-full bg-cyan-400 md:w-16"
                  />
                  <motion.div
                    animate={{ scaleY: [0.5, 1, 0.5, 1] }}
                    style={{ transformOrigin: "bottom", height: "clamp(60px,10vw,120px)" }}
                    transition={{ duration: 1.4, ease: "easeInOut", delay: 0.1 }}
                    className="w-10 rounded-t-full bg-white md:w-16"
                  />
                </div>
              )}

              {currentLift === "deadlift" && (
                <div className="flex items-center justify-center">
                  <motion.div
                    animate={{ y: [30, -30] }}
                    transition={{ duration: 1.3, ease: "easeOut" }}
                    className="relative flex items-center"
                  >
                    <div className="h-8 w-8 rounded-full border-4 border-amber-400 bg-transparent md:h-12 md:w-12" />
                    <div className="h-3 w-40 rounded-full bg-white md:h-4 md:w-64" />
                    <div className="h-8 w-8 rounded-full border-4 border-amber-400 bg-transparent md:h-12 md:w-12" />
                  </motion.div>
                </div>
              )}

              <p className="text-[clamp(1rem,3vw,2rem)] font-bold uppercase tracking-[0.3em] text-cyan-300">
                {currentLift === "bench" ? "BENCH PRESS" : currentLift === "squat" ? "SQUAT" : "DEADLIFT"}
              </p>
            </motion.div>
          </div>
        )}

        {/* ── NO lift overlay — full-screen colored circles ── */}
        {showSignalOverlay && (
          <div className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center bg-black">
            <motion.p
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-10 text-[clamp(2rem,6vw,4.5rem)] font-black uppercase tracking-[0.25em] text-red-400"
            >
              NO LIFT
            </motion.p>
            <div className="flex gap-6 md:gap-12 lg:gap-20">
              {displaySignals.map((signal, idx) => (
                <motion.div
                  key={idx}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: idx * 0.2, type: "spring", stiffness: 220, damping: 14 }}
                  className={`h-24 w-24 rounded-full md:h-40 md:w-40 lg:h-52 lg:w-52 ${
                    signal === "NO"
                      ? "bg-red-600 shadow-[0_0_80px_rgba(239,68,68,0.95)]"
                      : "bg-white shadow-[0_0_80px_rgba(255,255,255,0.9)]"
                  }`}
                />
              ))}
            </div>
          </div>
        )}

        <button
          onClick={cycleDisplayTheme}
          className={themeButtonClass.replace("top-4", "bottom-4")}
        >
          Theme: {activeTheme.label}
        </button>
      </div>
    );
  }

  return (
    <div
      className={`relative min-h-screen px-4 py-5 ${activeTheme.rootClass}`}
      style={{ ...displayRootStyle, fontFamily: "Times New Roman, serif" }}
    >
      {!competitionStarted && !forceLive && (
        <div
          className={`mb-3 inline-block rounded border px-3 py-1 text-xs font-semibold ${
            isDarkTheme
              ? "border-amber-500/50 bg-amber-400/15 text-amber-200"
              : "border-amber-600 bg-amber-100 text-amber-900"
          }`}
        >
          Competition not started. Preview mode is active.
        </div>
      )}
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-slate-700 md:text-sm">
          Design by SUMIT BHANJA
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-4xl font-bold italic uppercase md:text-6xl">{currentLifter?.name || "No Lifter"}</h1>
            <div className="text-right">
              <p className="text-xl font-semibold md:text-4xl">Height: {currentLift === "bench" ? currentLifter?.rackHeightBench || "-" : currentLifter?.rackHeightSquat || "-"}</p>
              {timerPhase === "ATTEMPT" && timerEndsAt && (
                <p className="mt-1 text-2xl font-bold md:text-4xl">Timer {Math.floor(displayTimerSeconds / 60)}:{String(displayTimerSeconds % 60).padStart(2, "0")}</p>
              )}
            </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="text-6xl font-bold md:text-8xl">{currentWeight.toFixed(1)} kg</p>
            <p className="mt-1 text-base font-semibold md:text-2xl">
              {includeCollars ? "With collar" : "Without collar"}: {loadingWeight.toFixed(1)} kg
            </p>
            <p className="mt-3 text-2xl font-semibold uppercase md:text-4xl">
              {currentLift.toUpperCase()} ATTEMPT {currentAttemptIndex + 1}
            </p>
          </div>
          <PlateStack weight={loadingWeight} includeCollars={includeCollars} />
        </div>
      </div>

      {showSignalOverlay && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-white/30 bg-black/80 p-6"
          >
            <p className="mb-4 text-center text-lg font-semibold text-white">Referee Signal</p>
            <div className="flex gap-5">
              {displaySignals.map((signal, idx) => (
                <div
                  key={idx}
                  className={`h-24 w-24 rounded-full ${
                    signal === "NO" ? "bg-red-500 shadow-[0_0_30px_rgba(239,68,68,0.9)]" : "bg-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.85)]"
                  }`}
                />
              ))}
            </div>
          </motion.div>
        </div>
      )}

      <Link to="/control" className="fixed bottom-4 right-4 rounded bg-black/70 px-3 py-2 text-sm text-white">
        Back
      </Link>

      <button onClick={cycleDisplayTheme} className={themeButtonClass}>
        Theme: {activeTheme.label}
      </button>
    </div>
  );
};

const DB_SETUP_SQL = `-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)

CREATE TABLE IF NOT EXISTS competitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  mode text NOT NULL DEFAULT 'FULL_GAME',
  include_collars boolean NOT NULL DEFAULT true,
  started boolean NOT NULL DEFAULT false,
  active_group_name text DEFAULT NULL,
  current_lifter_id uuid DEFAULT NULL,
  current_lift text NOT NULL DEFAULT 'squat',
  current_attempt_index integer NOT NULL DEFAULT 0,
  timer_phase text NOT NULL DEFAULT 'IDLE',
  timer_ends_at bigint DEFAULT NULL,
  display_layout text NOT NULL DEFAULT 'signal_results_plate',
  display_theme text NOT NULL DEFAULT 'black',
  next_attempt_queue jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  current_lift text NOT NULL DEFAULT 'squat',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lifters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  sex text NOT NULL DEFAULT 'Male',
  dob text NOT NULL DEFAULT '',
  bodyweight numeric DEFAULT NULL,
  weight_class text NOT NULL DEFAULT '',
  manual_weight_class text NOT NULL DEFAULT '',
  is_equipped boolean NOT NULL DEFAULT false,
  disqualified boolean NOT NULL DEFAULT false,
  category text NOT NULL DEFAULT 'Senior',
  group_name text NOT NULL DEFAULT '',
  team text NOT NULL DEFAULT '',
  rack_height_squat numeric DEFAULT NULL,
  rack_height_bench numeric DEFAULT NULL,
  lot integer DEFAULT NULL,
  squat_attempts jsonb NOT NULL DEFAULT '[{"weight":"","status":"PENDING"},{"weight":"","status":"PENDING"},{"weight":"","status":"PENDING"}]',
  bench_attempts jsonb NOT NULL DEFAULT '[{"weight":"","status":"PENDING"},{"weight":"","status":"PENDING"},{"weight":"","status":"PENDING"}]',
  deadlift_attempts jsonb NOT NULL DEFAULT '[{"weight":"","status":"PENDING"},{"weight":"","status":"PENDING"},{"weight":"","status":"PENDING"}]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS referee_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  position integer NOT NULL,
  signal text DEFAULT NULL,
  device_id text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(competition_id, position)
);

CREATE TABLE IF NOT EXISTS referee_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  device_id text NOT NULL DEFAULT '',
  position integer NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(competition_id, position)
);

CREATE INDEX IF NOT EXISTS idx_groups_competition_id ON groups(competition_id);
CREATE INDEX IF NOT EXISTS idx_lifters_competition_id ON lifters(competition_id);
CREATE INDEX IF NOT EXISTS idx_referee_signals_competition_id ON referee_signals(competition_id);
CREATE INDEX IF NOT EXISTS idx_referee_devices_competition_id ON referee_devices(competition_id);

ALTER TABLE competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifters ENABLE ROW LEVEL SECURITY;
ALTER TABLE referee_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE referee_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "competitions_select" ON competitions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "competitions_insert" ON competitions FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "competitions_update" ON competitions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "competitions_delete" ON competitions FOR DELETE TO anon, authenticated USING (true);
CREATE POLICY "groups_select" ON groups FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "groups_insert" ON groups FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "groups_update" ON groups FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "groups_delete" ON groups FOR DELETE TO anon, authenticated USING (true);
CREATE POLICY "lifters_select" ON lifters FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "lifters_insert" ON lifters FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "lifters_update" ON lifters FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "lifters_delete" ON lifters FOR DELETE TO anon, authenticated USING (true);
CREATE POLICY "referee_signals_select" ON referee_signals FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "referee_signals_insert" ON referee_signals FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "referee_signals_update" ON referee_signals FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "referee_signals_delete" ON referee_signals FOR DELETE TO anon, authenticated USING (true);
CREATE POLICY "referee_devices_select" ON referee_devices FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "referee_devices_insert" ON referee_devices FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "referee_devices_update" ON referee_devices FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "referee_devices_delete" ON referee_devices FOR DELETE TO anon, authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE referee_signals;
ALTER PUBLICATION supabase_realtime ADD TABLE referee_devices;`;

const DbSetupBanner = () => {
  const [dbReady, setDbReady] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    let interval: number;
    const check = async () => {
      try {
        const { supabase } = await import("./lib/supabase");
        const { error } = await supabase.from("competitions").select("id").limit(1).maybeSingle();
        const ready = !error || error.code !== "PGRST205";
        setDbReady(ready);
        if (ready) window.clearInterval(interval);
      } catch {
        setDbReady(false);
      }
    };
    check();
    interval = window.setInterval(check, 5000);
    return () => window.clearInterval(interval);
  }, []);

  const copySQL = async () => {
    try {
      await navigator.clipboard.writeText(DB_SETUP_SQL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (dbReady === null || dbReady === true) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-amber-400/30 bg-[#1a1200] px-4 py-3">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <p className="text-sm font-semibold text-amber-200">Database not set up yet</p>
          <p className="hidden text-xs text-amber-300/70 sm:block">— App will work offline using local storage until the database is configured.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShow((v) => !v)}
            className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/20"
          >
            {show ? "Hide SQL" : "View Setup SQL"}
          </button>
          <button
            onClick={copySQL}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-black transition hover:bg-amber-400"
          >
            {copied ? "Copied!" : "Copy SQL"}
          </button>
        </div>
      </div>
      {show && (
        <div className="mx-auto mt-3 max-w-4xl">
          <p className="mb-2 text-xs text-amber-300/80">
            Run this in your <span className="font-semibold">Supabase Dashboard → SQL Editor</span> to enable full database sync and real-time referee signals.
          </p>
          <pre className="max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-slate-300">
            {DB_SETUP_SQL}
          </pre>
        </div>
      )}
    </div>
  );
};

const AppRoutes = () => (
  <Routes>
    <Route path="/display/full" element={<DisplayFullPage />} />
    <Route path="/signals/:station" element={<RefereeStationPage />} />
    <Route element={<DashboardLayout />}>
      <Route path="/" element={<CompetitionPage />} />
      <Route path="/competitions" element={<CompetitionPage />} />
      <Route path="/control" element={<ControlPage />} />
      <Route
        path="/lifters"
        element={
          <CompetitionGate>
            <LifterManagementPage />
          </CompetitionGate>
        }
      />
      <Route
        path="/groups"
        element={
          <CompetitionGate>
            <GroupManagementPage />
          </CompetitionGate>
        }
      />
      <Route path="/signals" element={<RefereePage />} />
      <Route path="/screen" element={<ScreenPage />} />
      <Route
        path="/results"
        element={
          <CompetitionGate>
            <ResultsPage />
          </CompetitionGate>
        }
      />
      <Route path="/settings" element={<SettingsPage />} />
    </Route>
  </Routes>
);

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <AppRoutes />
        <DbSetupBanner />
      </HashRouter>
    </AppProvider>
  );
}
