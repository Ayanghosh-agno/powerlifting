import { useEffect, useRef, useCallback } from "react";
import { isSupabaseConfigured, supabase } from "./supabase";
import { dbCompetitions, dbGroups, dbLifters, dbRefereeSignals } from "./db";

type RefSignal = "GOOD" | "NO" | null;
type LiftType = "squat" | "bench" | "deadlift";
type AttemptStatus = "PENDING" | "GOOD" | "NO" | "UNATTEMPTED";
type Attempt = { weight: number | ""; status: AttemptStatus };
type TimerPhase = "IDLE" | "ATTEMPT" | "NEXT_ATTEMPT";
type CompetitionMode = "FULL_GAME" | "BENCH_ONLY";
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
  group: string | string[];
  team: string;
  rackHeightSquat: number | "";
  rackHeightBench: number | "";
  lot: number | "";
  squatAttempts: Attempt[];
  benchAttempts: Attempt[];
  deadliftAttempts: Attempt[];
};

type Group = { id: string; name: string; currentLift: LiftType };

type CompetitionRecord = {
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
  manualOrderByStage: Record<string, string[]>;
};

export type ConnectedRefereeSlots = {
  left: boolean;
  center: boolean;
  right: boolean;
};

function lifterToDb(lifter: Lifter, competitionId: string) {
  const groupArray = Array.isArray(lifter.group) ? lifter.group : (lifter.group ? [lifter.group] : []);
  const firstGroup = groupArray.length > 0 ? groupArray[0] : "";

  return {
    id: lifter.id,
    competition_id: competitionId,
    name: lifter.name,
    sex: lifter.sex,
    dob: lifter.dob,
    bodyweight: lifter.bodyweight === "" ? null : lifter.bodyweight,
    weight_class: lifter.weightClass,
    manual_weight_class: lifter.manualWeightClass,
    is_equipped: lifter.isEquipped,
    disqualified: lifter.disqualified,
    category: lifter.category,
    group_name: firstGroup,
    group_names: groupArray,
    team: lifter.team,
    rack_height_squat: lifter.rackHeightSquat === "" ? null : lifter.rackHeightSquat,
    rack_height_bench: lifter.rackHeightBench === "" ? null : lifter.rackHeightBench,
    lot: lifter.lot === "" ? null : lifter.lot,
    squat_attempts: lifter.squatAttempts,
    bench_attempts: lifter.benchAttempts,
    deadlift_attempts: lifter.deadliftAttempts,
  };
}

function dbToLifter(row: Record<string, unknown>): Lifter {
  const groupNames = row.group_names as unknown[];
  const group: string | string[] =
    Array.isArray(groupNames) && groupNames.length > 0
      ? groupNames.length === 1
        ? (groupNames[0] as string)
        : (groupNames as string[])
      : "";

  return {
    id: row.id as string,
    name: row.name as string,
    sex: row.sex as "Male" | "Female",
    dob: row.dob as string,
    bodyweight: row.bodyweight != null ? Number(row.bodyweight) : "",
    weightClass: row.weight_class as string,
    manualWeightClass: row.manual_weight_class as string,
    isEquipped: row.is_equipped as boolean,
    disqualified: row.disqualified as boolean,
    category: row.category as string,
    group,
    team: row.team as string,
    rackHeightSquat: row.rack_height_squat != null ? Number(row.rack_height_squat) : "",
    rackHeightBench: row.rack_height_bench != null ? Number(row.rack_height_bench) : "",
    lot: row.lot != null ? Number(row.lot) : "",
    squatAttempts: row.squat_attempts as Attempt[],
    benchAttempts: row.bench_attempts as Attempt[],
    deadliftAttempts: row.deadlift_attempts as Attempt[],
  };
}

function groupToDb(group: Group, competitionId: string) {
  return {
    id: group.id,
    competition_id: competitionId,
    name: group.name,
    current_lift: group.currentLift,
  };
}

function dbToGroup(row: Record<string, unknown>): Group {
  return {
    id: row.id as string,
    name: row.name as string,
    currentLift: row.current_lift as LiftType,
  };
}

function parseManualOrderByStageColumn(raw: unknown): Record<string, string[]> {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(val) && val.every((id) => typeof id === "string")) {
      out[key] = val;
    }
  }
  return out;
}

function competitionToDb(comp: CompetitionRecord) {
  return {
    id: comp.id,
    name: comp.name,
    mode: comp.competitionMode,
    include_collars: comp.includeCollars,
    started: comp.competitionStarted,
    active_group_name: comp.activeCompetitionGroupName,
    current_lifter_id: comp.currentLifterId,
    current_lift: comp.currentLift,
    current_attempt_index: comp.currentAttemptIndex,
    timer_phase: comp.timerPhase,
    timer_ends_at: comp.timerEndsAt,
    display_layout: "signal_results_plate",
    display_theme: "black",
    next_attempt_queue: comp.nextAttemptQueue,
    manual_order_by_stage: comp.manualOrderByStage ?? {},
  };
}

export type CompetitionSessionFromDb = {
  currentLifterId: string | null;
  currentLift: LiftType;
  currentAttemptIndex: number;
  competitionStarted: boolean;
  includeCollars: boolean;
  timerPhase: TimerPhase;
  timerEndsAt: number | null;
  competitionMode: CompetitionMode;
  activeCompetitionGroupName: string | null;
  nextAttemptQueue: NextAttemptEntry[];
  manualOrderByStage: Record<string, string[]>;
  lifters: Lifter[];
  groups: Group[];
};

function dbCompetitionToSession(
  dbComp: {
    current_lifter_id: string | null;
    current_lift: string;
    current_attempt_index: number;
    started: boolean;
    include_collars: boolean;
    timer_phase: string;
    timer_ends_at: number | null;
    mode: string;
    active_group_name: string | null;
    next_attempt_queue: unknown;
    manual_order_by_stage?: unknown;
  },
  lifterRows: Record<string, unknown>[],
  groupRows: Record<string, unknown>[],
): CompetitionSessionFromDb {
  return {
    currentLifterId: dbComp.current_lifter_id,
    currentLift: dbComp.current_lift as LiftType,
    currentAttemptIndex: dbComp.current_attempt_index,
    competitionStarted: dbComp.started,
    includeCollars: dbComp.include_collars,
    timerPhase: dbComp.timer_phase as TimerPhase,
    timerEndsAt: dbComp.timer_ends_at,
    competitionMode: dbComp.mode as CompetitionMode,
    activeCompetitionGroupName: dbComp.active_group_name,
    nextAttemptQueue: (dbComp.next_attempt_queue ?? []) as NextAttemptEntry[],
    manualOrderByStage: parseManualOrderByStageColumn(dbComp.manual_order_by_stage),
    lifters: lifterRows.map((row) => dbToLifter(row)),
    groups: groupRows.map((row) => dbToGroup(row)),
  };
}

/** Stable key for remote session snapshots — skip apply + outbound saves when unchanged. */
function sessionFingerprint(session: CompetitionSessionFromDb, competitionId: string): string {
  return JSON.stringify({
    platform: {
      currentLifterId: session.currentLifterId,
      currentLift: session.currentLift,
      currentAttemptIndex: session.currentAttemptIndex,
      competitionStarted: session.competitionStarted,
      includeCollars: session.includeCollars,
      timerPhase: session.timerPhase,
      timerEndsAt: session.timerEndsAt,
      competitionMode: session.competitionMode,
      activeCompetitionGroupName: session.activeCompetitionGroupName,
      nextAttemptQueue: session.nextAttemptQueue,
      manualOrderByStage: session.manualOrderByStage,
    },
    lifters: session.lifters.map((l) => lifterToDb(l, competitionId)),
    groups: session.groups,
  });
}

const SESSION_REFETCH_DEBOUNCE_MS = 600;
const LIFTER_SAVE_DEBOUNCE_MS = 800;

type DbLifterRow = ReturnType<typeof lifterToDb>;
type DbGroupRow = ReturnType<typeof groupToDb>;

function serializeLifters(lifters: Lifter[], competitionId: string) {
  return JSON.stringify(lifters.map((l) => lifterToDb(l, competitionId)));
}

function serializeGroups(groups: Group[]) {
  return JSON.stringify(groups);
}

function diffLifterRows(
  previousSerialized: string,
  lifters: Lifter[],
  competitionId: string,
): { changed: DbLifterRow[]; removedIds: string[] } {
  const previous: DbLifterRow[] = previousSerialized ? JSON.parse(previousSerialized) : [];
  const previousById = new Map(previous.map((row) => [row.id, JSON.stringify(row)]));
  const changed: DbLifterRow[] = [];
  const currentIds = new Set<string>();

  for (const lifter of lifters) {
    currentIds.add(lifter.id);
    const row = lifterToDb(lifter, competitionId);
    if (previousById.get(lifter.id) !== JSON.stringify(row)) {
      changed.push(row);
    }
  }

  const removedIds = previous.filter((row) => !currentIds.has(row.id)).map((row) => row.id);
  return { changed, removedIds };
}

function diffGroupRows(previousSerialized: string, groups: Group[], competitionId: string) {
  const previous: DbGroupRow[] = previousSerialized ? JSON.parse(previousSerialized) : [];
  const previousById = new Map(previous.map((row) => [row.id, JSON.stringify(row)]));
  const changed: DbGroupRow[] = [];
  const currentIds = new Set<string>();

  for (const group of groups) {
    currentIds.add(group.id);
    const row = groupToDb(group, competitionId);
    if (previousById.get(group.id) !== JSON.stringify(row)) {
      changed.push(row);
    }
  }

  const removedIds = previous.filter((row) => !currentIds.has(row.id)).map((row) => row.id);
  return { changed, removedIds };
}

export type SessionPersistSnapshot = {
  lifters: Lifter[];
  groups: Group[];
  currentLifterId: string | null;
  currentLift: LiftType;
  currentAttemptIndex: number;
  competitionStarted: boolean;
  includeCollars: boolean;
  timerPhase: TimerPhase;
  timerEndsAt: number | null;
  competitionMode: CompetitionMode;
  activeCompetitionGroupName: string | null;
  nextAttemptQueue: NextAttemptEntry[];
  manualOrderByStage: Record<string, string[]>;
};

type SyncCallbacks = {
  onCompetitionsLoaded: (competitions: CompetitionRecord[]) => void;
  onRefereeSignalsChanged: (signals: RefSignal[]) => void;
  onDevicesChanged: (devices: ConnectedRefereeSlots) => void;
  onCompetitionSessionFromDb: (session: CompetitionSessionFromDb) => void;
};

const POSITION_TO_SLOT: Record<number, "left" | "center" | "right"> = {
  0: "left",
  1: "center",
  2: "right",
};

export function useSupabaseSync(
  activeCompetitionId: string | null,
  competitions: CompetitionRecord[],
  lifters: Lifter[],
  groups: Group[],
  refereeSignals: RefSignal[],
  callbacks: SyncCallbacks,
  deviceId: string,
  readOnly = false,
  sessionId: string | null = null,
  authLoading = false,
  authUserId: string | null = null,
) {
  const dbReadyRef = useRef(false);
  const lastSavedCompRef = useRef<string>("");
  const lastSavedLiftersRef = useRef<string>("");
  const lastSavedGroupsRef = useRef<string>("");
  const signalSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lifterSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastAppliedSessionFingerprintRef = useRef<string>("");
  const sessionRefsSeededRef = useRef(false);

  const markLocalSessionFingerprint = useCallback(
    (session: CompetitionSessionFromDb) => {
      if (!activeCompetitionId) return;
      lastAppliedSessionFingerprintRef.current = sessionFingerprint(session, activeCompetitionId);
    },
    [activeCompetitionId],
  );

  const markLocalSessionFromState = useCallback(() => {
    if (!activeCompetitionId) return;
    const comp = competitions.find((c) => c.id === activeCompetitionId);
    if (!comp) return;
    markLocalSessionFingerprint({
      currentLifterId: comp.currentLifterId,
      currentLift: comp.currentLift,
      currentAttemptIndex: comp.currentAttemptIndex,
      competitionStarted: comp.competitionStarted,
      includeCollars: comp.includeCollars,
      timerPhase: comp.timerPhase,
      timerEndsAt: comp.timerEndsAt,
      competitionMode: comp.competitionMode,
      activeCompetitionGroupName: comp.activeCompetitionGroupName,
      nextAttemptQueue: comp.nextAttemptQueue,
      manualOrderByStage: comp.manualOrderByStage ?? {},
      lifters,
      groups,
    });
  }, [activeCompetitionId, competitions, lifters, groups, markLocalSessionFingerprint]);

  const { onCompetitionsLoaded, onRefereeSignalsChanged, onDevicesChanged, onCompetitionSessionFromDb } =
    callbacks;

  useEffect(() => {
    if (!isSupabaseConfigured) {
      dbReadyRef.current = true;
      return;
    }

    if (authLoading) {
      return;
    }

    let cancelled = false;
    dbReadyRef.current = false;

    async function loadFromDb() {
      try {
        const dbComps = await dbCompetitions.list();
        if (cancelled) return;

        if (dbComps.length === 0) {
          dbReadyRef.current = true;
          return;
        }

        const loadedComps: CompetitionRecord[] = [];
        for (const dbComp of dbComps) {
          const [dbLifterRows, dbGroupRows] = await Promise.all([
            dbLifters.listForCompetition(dbComp.id),
            dbGroups.listForCompetition(dbComp.id),
          ]);
          loadedComps.push({
            id: dbComp.id,
            name: dbComp.name,
            createdAt: new Date(dbComp.created_at).getTime(),
            lifters: dbLifterRows.map((r) => dbToLifter(r as Record<string, unknown>)),
            groups: dbGroupRows.map((r) => dbToGroup(r as Record<string, unknown>)),
            currentLifterId: dbComp.current_lifter_id,
            refereeSignals: [null, null, null],
            refereeInputLocked: false,
            currentLift: dbComp.current_lift as LiftType,
            currentAttemptIndex: dbComp.current_attempt_index,
            competitionStarted: dbComp.started,
            includeCollars: dbComp.include_collars,
            timerPhase: dbComp.timer_phase as TimerPhase,
            timerEndsAt: dbComp.timer_ends_at,
            competitionMode: dbComp.mode as CompetitionMode,
            activeCompetitionGroupName: dbComp.active_group_name,
            nextAttemptQueue: (dbComp.next_attempt_queue ?? []) as NextAttemptEntry[],
            manualOrderByStage: parseManualOrderByStageColumn(dbComp.manual_order_by_stage),
          });
        }

        if (!cancelled) {
          dbReadyRef.current = true;
          onCompetitionsLoaded(loadedComps);
        }
      } catch {
        dbReadyRef.current = false;
      }
    }

    loadFromDb();
    return () => {
      cancelled = true;
    };
    // Wait for Supabase auth to resolve, then reload when identity changes after sign-in.
  }, [authLoading, authUserId]);

  useEffect(() => {
    lastSavedCompRef.current = "";
    lastSavedLiftersRef.current = "";
    lastSavedGroupsRef.current = "";
    sessionRefsSeededRef.current = false;
  }, [activeCompetitionId]);

  useEffect(() => {
    if (!isSupabaseConfigured || !dbReadyRef.current || !activeCompetitionId) return;
    if (sessionRefsSeededRef.current) return;
    const comp = competitions.find((c) => c.id === activeCompetitionId);
    if (!comp) return;
    if (serializeLifters(lifters, activeCompetitionId) !== serializeLifters(comp.lifters, activeCompetitionId)) {
      return;
    }

    lastSavedCompRef.current = JSON.stringify(competitionToDb(comp));
    lastSavedLiftersRef.current = serializeLifters(lifters, activeCompetitionId);
    lastSavedGroupsRef.current = serializeGroups(groups);
    lastAppliedSessionFingerprintRef.current = sessionFingerprint(
      {
        currentLifterId: comp.currentLifterId,
        currentLift: comp.currentLift,
        currentAttemptIndex: comp.currentAttemptIndex,
        competitionStarted: comp.competitionStarted,
        includeCollars: comp.includeCollars,
        timerPhase: comp.timerPhase,
        timerEndsAt: comp.timerEndsAt,
        competitionMode: comp.competitionMode,
        activeCompetitionGroupName: comp.activeCompetitionGroupName,
        nextAttemptQueue: comp.nextAttemptQueue,
        manualOrderByStage: comp.manualOrderByStage ?? {},
        lifters,
        groups,
      },
      activeCompetitionId,
    );
    sessionRefsSeededRef.current = true;
  }, [activeCompetitionId, competitions, lifters, groups]);

  useEffect(() => {
    if (readOnly || !isSupabaseConfigured || !dbReadyRef.current || !activeCompetitionId) return;
    const comp = competitions.find((c) => c.id === activeCompetitionId);
    if (!comp) return;

    const serialized = JSON.stringify(competitionToDb(comp));
    if (serialized === lastSavedCompRef.current) return;

    if (compSaveRef.current) clearTimeout(compSaveRef.current);
    compSaveRef.current = setTimeout(async () => {
      compSaveRef.current = null;
      try {
        await dbCompetitions.upsert(competitionToDb(comp));
        lastSavedCompRef.current = serialized;
        markLocalSessionFromState();
      } catch (error) {
        console.error("[Powerlifting:SessionSync] competition save failed", { activeCompetitionId, error });
      }
    }, LIFTER_SAVE_DEBOUNCE_MS);
  }, [readOnly, activeCompetitionId, competitions, markLocalSessionFromState]);

  useEffect(() => {
    if (readOnly || !isSupabaseConfigured || !dbReadyRef.current || !activeCompetitionId) return;
    const serialized = serializeLifters(lifters, activeCompetitionId);
    if (serialized === lastSavedLiftersRef.current) return;

    if (lifterSaveRef.current) clearTimeout(lifterSaveRef.current);
    lifterSaveRef.current = setTimeout(async () => {
      lifterSaveRef.current = null;
      try {
        const { changed, removedIds } = diffLifterRows(
          lastSavedLiftersRef.current,
          lifters,
          activeCompetitionId,
        );
        if (changed.length === 0 && removedIds.length === 0) {
          lastSavedLiftersRef.current = serialized;
          return;
        }
        if (changed.length > 0) {
          await dbLifters.upsertMany(activeCompetitionId, changed);
        }
        if (removedIds.length > 0) {
          await dbLifters.deleteByIds(activeCompetitionId, removedIds);
        }
        lastSavedLiftersRef.current = serialized;
        markLocalSessionFromState();
      } catch (error) {
        console.error("[Powerlifting:SessionSync] lifters save failed", { activeCompetitionId, error });
      }
    }, LIFTER_SAVE_DEBOUNCE_MS);
  }, [readOnly, activeCompetitionId, lifters, markLocalSessionFromState]);

  useEffect(() => {
    if (readOnly || !isSupabaseConfigured || !dbReadyRef.current || !activeCompetitionId) return;
    const serialized = serializeGroups(groups);
    if (serialized === lastSavedGroupsRef.current) return;

    if (groupSaveRef.current) clearTimeout(groupSaveRef.current);
    groupSaveRef.current = setTimeout(async () => {
      groupSaveRef.current = null;
      try {
        const { changed, removedIds } = diffGroupRows(
          lastSavedGroupsRef.current,
          groups,
          activeCompetitionId,
        );
        if (changed.length === 0 && removedIds.length === 0) {
          lastSavedGroupsRef.current = serialized;
          return;
        }
        if (changed.length > 0) {
          await dbGroups.upsertMany(activeCompetitionId, changed);
        }
        if (removedIds.length > 0) {
          await dbGroups.deleteByIds(activeCompetitionId, removedIds);
        }
        lastSavedGroupsRef.current = serialized;
        markLocalSessionFromState();
      } catch (error) {
        console.error("[Powerlifting:SessionSync] groups save failed", { activeCompetitionId, error });
      }
    }, LIFTER_SAVE_DEBOUNCE_MS);
  }, [readOnly, activeCompetitionId, groups, markLocalSessionFromState]);

  const persistSessionSnapshot = useCallback(
    async (snapshot: SessionPersistSnapshot) => {
      if (readOnly || !isSupabaseConfigured || !dbReadyRef.current || !activeCompetitionId) return;

      const compMeta = competitions.find((c) => c.id === activeCompetitionId);
      if (!compMeta) {
        console.warn("[Powerlifting:SessionSync] persist skipped — active competition not in list", {
          activeCompetitionId,
        });
        return;
      }

      if (compSaveRef.current) {
        clearTimeout(compSaveRef.current);
        compSaveRef.current = null;
      }
      if (lifterSaveRef.current) {
        clearTimeout(lifterSaveRef.current);
        lifterSaveRef.current = null;
      }

      const compRecord: CompetitionRecord = {
        id: activeCompetitionId,
        name: compMeta.name,
        createdAt: compMeta.createdAt,
        lifters: snapshot.lifters,
        groups: snapshot.groups,
        currentLifterId: snapshot.currentLifterId,
        refereeSignals: [null, null, null],
        refereeInputLocked: false,
        currentLift: snapshot.currentLift,
        currentAttemptIndex: snapshot.currentAttemptIndex,
        competitionStarted: snapshot.competitionStarted,
        includeCollars: snapshot.includeCollars,
        timerPhase: snapshot.timerPhase,
        timerEndsAt: snapshot.timerEndsAt,
        competitionMode: snapshot.competitionMode,
        activeCompetitionGroupName: snapshot.activeCompetitionGroupName,
        nextAttemptQueue: snapshot.nextAttemptQueue,
        manualOrderByStage: snapshot.manualOrderByStage,
      };

      try {
        const lifterSerialized = serializeLifters(snapshot.lifters, activeCompetitionId);
        const { changed: changedLifters, removedIds: removedLifterIds } = diffLifterRows(
          lastSavedLiftersRef.current,
          snapshot.lifters,
          activeCompetitionId,
        );
        const compSerialized = JSON.stringify(competitionToDb(compRecord));
        const compChanged = compSerialized !== lastSavedCompRef.current;

        const writes: Promise<void>[] = [];
        if (compChanged) {
          writes.push(dbCompetitions.upsert(competitionToDb(compRecord)));
        }
        if (changedLifters.length > 0) {
          writes.push(dbLifters.upsertMany(activeCompetitionId, changedLifters));
        }
        if (removedLifterIds.length > 0) {
          writes.push(dbLifters.deleteByIds(activeCompetitionId, removedLifterIds));
        }
        if (writes.length > 0) {
          await Promise.all(writes);
        }

        if (compChanged) {
          lastSavedCompRef.current = compSerialized;
        }
        if (changedLifters.length > 0 || removedLifterIds.length > 0) {
          lastSavedLiftersRef.current = lifterSerialized;
        }
        markLocalSessionFingerprint({
          currentLifterId: snapshot.currentLifterId,
          currentLift: snapshot.currentLift,
          currentAttemptIndex: snapshot.currentAttemptIndex,
          competitionStarted: snapshot.competitionStarted,
          includeCollars: snapshot.includeCollars,
          timerPhase: snapshot.timerPhase,
          timerEndsAt: snapshot.timerEndsAt,
          competitionMode: snapshot.competitionMode,
          activeCompetitionGroupName: snapshot.activeCompetitionGroupName,
          nextAttemptQueue: snapshot.nextAttemptQueue,
          manualOrderByStage: snapshot.manualOrderByStage,
          lifters: snapshot.lifters,
          groups: snapshot.groups,
        });
      } catch (error) {
        console.error("[Powerlifting:SessionSync] immediate persist failed", {
          activeCompetitionId,
          currentLifterId: snapshot.currentLifterId,
          error,
        });
      }
    },
    [readOnly, activeCompetitionId, competitions, markLocalSessionFingerprint],
  );

  useEffect(() => {
    if (!isSupabaseConfigured || !activeCompetitionId) return;

    const signalsSnapshot: RefSignal[] = [null, null, null];

    const applyRow = (row: { position: number; signal: string | null }) => {
      if (row.position >= 0 && row.position <= 2) {
        signalsSnapshot[row.position] = (row.signal as RefSignal) ?? null;
      }
    };

    const fetchAll = async () => {
      try {
        const rows = await dbRefereeSignals.listForCompetition(activeCompetitionId);
        signalsSnapshot[0] = null;
        signalsSnapshot[1] = null;
        signalsSnapshot[2] = null;
        for (const row of rows) applyRow(row);
        onRefereeSignalsChanged([...signalsSnapshot]);
      } catch {
      }
    };

    // Never trust incremental merges alone: the in-memory snapshot can stay stale across a
    // table clear (DELETE bursts / missed old row) or tab backgrounding. Re-fetch the full
    // row set after any realtime change so only DB truth drives left/center/right.
    let signalsRefetchTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSignalsRefetch = () => {
      if (signalsRefetchTimer) clearTimeout(signalsRefetchTimer);
      signalsRefetchTimer = setTimeout(() => {
        signalsRefetchTimer = null;
        void fetchAll();
      }, 80);
    };

    const channel = supabase
      .channel(`referee-signals-${activeCompetitionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "referee_signals",
          filter: `competition_id=eq.${activeCompetitionId}`,
        },
        () => {
          scheduleSignalsRefetch();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "referee_signals",
          filter: `competition_id=eq.${activeCompetitionId}`,
        },
        () => {
          scheduleSignalsRefetch();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "referee_signals",
          filter: `competition_id=eq.${activeCompetitionId}`,
        },
        () => {
          scheduleSignalsRefetch();
        }
      )
      .subscribe();

    fetchAll();

    return () => {
      if (signalsRefetchTimer) clearTimeout(signalsRefetchTimer);
      supabase.removeChannel(channel);
    };
  }, [activeCompetitionId, onRefereeSignalsChanged]);

  useEffect(() => {
    if (!isSupabaseConfigured || !activeCompetitionId) return;

    lastAppliedSessionFingerprintRef.current = "";

    let cancelled = false;
    let sessionRefetchTimer: ReturnType<typeof setTimeout> | null = null;

    const fetchAndApplySession = async (reason: string) => {
      try {
        const dbComp = await dbCompetitions.getById(activeCompetitionId);
        if (cancelled) return;
        if (!dbComp) {
          console.warn("[Powerlifting:SessionSync]", "competition row not found", {
            competitionId: activeCompetitionId,
            reason,
          });
          return;
        }

        const [dbLifterRows, dbGroupRows] = await Promise.all([
          dbLifters.listForCompetition(activeCompetitionId),
          dbGroups.listForCompetition(activeCompetitionId),
        ]);
        if (cancelled) return;

        const session = dbCompetitionToSession(
          dbComp,
          dbLifterRows as Record<string, unknown>[],
          dbGroupRows as Record<string, unknown>[],
        );

        const fingerprint = sessionFingerprint(session, activeCompetitionId);
        if (fingerprint === lastAppliedSessionFingerprintRef.current) {
          return;
        }

        // Mark remote snapshot as saved so writers do not immediately re-upsert the same payload.
        if (!readOnly) {
          const compRecord: CompetitionRecord = {
            id: dbComp.id,
            name: dbComp.name,
            createdAt: new Date(dbComp.created_at).getTime(),
            lifters: session.lifters,
            groups: session.groups,
            currentLifterId: session.currentLifterId,
            refereeSignals: [null, null, null],
            refereeInputLocked: false,
            currentLift: session.currentLift,
            currentAttemptIndex: session.currentAttemptIndex,
            competitionStarted: session.competitionStarted,
            includeCollars: session.includeCollars,
            timerPhase: session.timerPhase,
            timerEndsAt: session.timerEndsAt,
            competitionMode: session.competitionMode,
            activeCompetitionGroupName: session.activeCompetitionGroupName,
            nextAttemptQueue: session.nextAttemptQueue,
            manualOrderByStage: session.manualOrderByStage,
          };
          lastSavedCompRef.current = JSON.stringify(competitionToDb(compRecord));
          lastSavedLiftersRef.current = serializeLifters(session.lifters, activeCompetitionId);
          lastSavedGroupsRef.current = serializeGroups(session.groups);
          sessionRefsSeededRef.current = true;
        }

        lastAppliedSessionFingerprintRef.current = fingerprint;

        const currentName =
          session.lifters.find((l) => l.id === session.currentLifterId)?.name ?? "(unknown)";
        console.log("[Powerlifting:SessionSync]", "apply session from DB", {
          competitionId: activeCompetitionId,
          reason,
          currentLifterId: session.currentLifterId,
          currentLifterName: currentName,
          currentLift: session.currentLift,
          currentAttemptIndex: session.currentAttemptIndex,
          lifterCount: session.lifters.length,
        });

        onCompetitionSessionFromDb(session);
      } catch (error) {
        console.error("[Powerlifting:SessionSync]", "fetch failed", {
          competitionId: activeCompetitionId,
          reason,
          error,
        });
      }
    };

    const scheduleSessionRefetch = (reason: string) => {
      if (sessionRefetchTimer) clearTimeout(sessionRefetchTimer);
      sessionRefetchTimer = setTimeout(() => {
        sessionRefetchTimer = null;
        void fetchAndApplySession(reason);
      }, SESSION_REFETCH_DEBOUNCE_MS);
    };

    const channel = supabase
      .channel(`competition-session-${activeCompetitionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "competitions",
          filter: `id=eq.${activeCompetitionId}`,
        },
        () => {
          scheduleSessionRefetch("realtime:competitions UPDATE");
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "lifters",
          filter: `competition_id=eq.${activeCompetitionId}`,
        },
        () => {
          scheduleSessionRefetch("realtime:lifters INSERT");
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "lifters",
          filter: `competition_id=eq.${activeCompetitionId}`,
        },
        () => {
          scheduleSessionRefetch("realtime:lifters UPDATE");
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "lifters",
          filter: `competition_id=eq.${activeCompetitionId}`,
        },
        () => {
          scheduleSessionRefetch("realtime:lifters DELETE");
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "groups",
          filter: `competition_id=eq.${activeCompetitionId}`,
        },
        () => {
          scheduleSessionRefetch("realtime:groups INSERT");
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "groups",
          filter: `competition_id=eq.${activeCompetitionId}`,
        },
        () => {
          scheduleSessionRefetch("realtime:groups UPDATE");
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "groups",
          filter: `competition_id=eq.${activeCompetitionId}`,
        },
        () => {
          scheduleSessionRefetch("realtime:groups DELETE");
        },
      )
      .subscribe((status) => {
        console.log("[Powerlifting:SessionSync]", "realtime channel status", {
          competitionId: activeCompetitionId,
          status,
        });
      });

    void fetchAndApplySession("initial subscribe");

    return () => {
      cancelled = true;
      lastAppliedSessionFingerprintRef.current = "";
      if (sessionRefetchTimer) clearTimeout(sessionRefetchTimer);
      supabase.removeChannel(channel);
    };
  }, [activeCompetitionId, readOnly, onCompetitionSessionFromDb]);

  useEffect(() => {
    if (!isSupabaseConfigured || !activeCompetitionId) return;

    let cancelled = false;

    const rebuildSlots = (state: Record<string, { position: number }[]>) => {
      const slots: ConnectedRefereeSlots = { left: false, center: false, right: false };
      for (const presences of Object.values(state)) {
        for (const p of presences) {
          const slot = POSITION_TO_SLOT[p.position];
          if (slot) slots[slot] = true;
        }
      }
      return slots;
    };

    const ch = supabase
      .channel(`referee-presence-observer-${activeCompetitionId}`)
      .on("presence", { event: "sync" }, () => {
        if (!cancelled) onDevicesChanged(rebuildSlots(ch.presenceState<{ position: number }>()));
      })
      .on("presence", { event: "join" }, () => {
        if (!cancelled) onDevicesChanged(rebuildSlots(ch.presenceState<{ position: number }>()));
      })
      .on("presence", { event: "leave" }, () => {
        if (!cancelled) onDevicesChanged(rebuildSlots(ch.presenceState<{ position: number }>()));
      })
      .subscribe();

    if (!cancelled) {
      presenceChannelRef.current = ch;
    }

    return () => {
      cancelled = true;
      presenceChannelRef.current = null;
      supabase.removeChannel(ch);
    };
  }, [activeCompetitionId, onDevicesChanged]);

  const publishSignal = useCallback(
    async (position: number, signal: RefSignal) => {
      if (!isSupabaseConfigured || !activeCompetitionId) return;
      try {
        await dbRefereeSignals.upsertSignal(activeCompetitionId, position, signal, deviceId, sessionId);
      } catch (error) {
        // Important: don't silently swallow signal-write failures.
        // On the referee phones, this explains why presence says "Connected"
        // but `referee_signals` rows never appear.
        console.error("Failed to publish referee signal", {
          activeCompetitionId,
          position,
          signal,
          sessionId,
          deviceId,
          error,
        });
      }
    },
    [activeCompetitionId, deviceId, sessionId]
  );

  const clearSignals = useCallback(async () => {
    if (!isSupabaseConfigured || !activeCompetitionId) return;
    try {
      await dbRefereeSignals.clearAll(activeCompetitionId);
    } catch (error) {
      console.error("Error clearing signals:", error);
    }
  }, [activeCompetitionId]);

  const createCompetitionInDb = useCallback(async (comp: CompetitionRecord) => {
    if (!isSupabaseConfigured) return;
    try {
      await dbCompetitions.upsert(competitionToDb(comp));
      dbReadyRef.current = true;
    } catch {
    }
  }, []);

  const deleteCompetitionFromDb = useCallback(async (id: string) => {
    if (!isSupabaseConfigured) return;
    try {
      await dbCompetitions.remove(id);
    } catch {
    }
  }, []);

  const updateCompetitionNameInDb = useCallback(async (id: string, name: string) => {
    if (!isSupabaseConfigured) return;
    try {
      await dbCompetitions.update(id, { name });
    } catch {
    }
  }, []);

  const trackPresence = useCallback(async (position: number) => {
    const ch = presenceChannelRef.current;
    if (!ch) return;
    try {
      await ch.track({ position });
    } catch {
    }
  }, []);

  const untrackPresence = useCallback(() => {
    const ch = presenceChannelRef.current;
    if (!ch) return;
    try {
      ch.untrack();
    } catch {
    }
  }, []);

  return {
    publishSignal,
    clearSignals,
    createCompetitionInDb,
    deleteCompetitionFromDb,
    updateCompetitionNameInDb,
    persistSessionSnapshot,
    dbReady: dbReadyRef.current,
    trackPresence,
    untrackPresence,
  };
}
