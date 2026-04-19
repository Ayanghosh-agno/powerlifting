export type LiftType = "squat" | "bench" | "deadlift";
export type AttemptStatus = "PENDING" | "GOOD" | "NO" | "UNATTEMPTED";
export type TimerPhase = "IDLE" | "ATTEMPT" | "NEXT_ATTEMPT";
export type CompetitionMode = "FULL_GAME" | "BENCH_ONLY";
export type Attempt = { weight: number | ""; status: AttemptStatus };
export type RefSignal = "GOOD" | "NO" | null;
export type RefereeSlot = "left" | "center" | "right";
export type DisplayThemeKey = "black" | "white" | "royal" | "emerald" | "sepia" | "crimson" | "graphite";

export type Group = { id: string; name: string; currentLift: LiftType };

export type NextAttemptEntry = { lifterId: string; lift: LiftType; attemptIndex: number };

export type Lifter = {
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
  group: string | string[];
  team: string;
  rackHeightSquat: number | "";
  rackHeightBench: number | "";
  lot: number | "";
  squatAttempts: Attempt[];
  benchAttempts: Attempt[];
  deadliftAttempts: Attempt[];
};

export type CompetitionRecord = {
  id: string;
  name: string;
  createdAt: number;
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
  activeCompetitionGroupName: string | null;
  nextAttemptQueue: NextAttemptEntry[];
};

export type PersistedState = {
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
  activeCompetitionGroupName: string | null;
  nextAttemptQueue: NextAttemptEntry[];
};
