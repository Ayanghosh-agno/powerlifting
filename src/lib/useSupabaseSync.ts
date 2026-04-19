import { useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";
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
  group: string;
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
};

export type ConnectedRefereeSlots = {
  left: boolean;
  center: boolean;
  right: boolean;
};

function lifterToDb(lifter: Lifter, competitionId: string) {
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
    group_name: lifter.group,
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
    group: row.group_name as string,
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
  };
}

type SyncCallbacks = {
  onCompetitionsLoaded: (competitions: CompetitionRecord[]) => void;
  onRefereeSignalsChanged: (signals: RefSignal[]) => void;
  onDevicesChanged: (devices: ConnectedRefereeSlots) => void;
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
  deviceId: string
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

  const { onCompetitionsLoaded, onRefereeSignalsChanged, onDevicesChanged } = callbacks;

  useEffect(() => {
    let cancelled = false;

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
  }, []);

  useEffect(() => {
    if (!dbReadyRef.current || !activeCompetitionId) return;
    const comp = competitions.find((c) => c.id === activeCompetitionId);
    if (!comp) return;

    const serialized = JSON.stringify(competitionToDb(comp));
    if (serialized === lastSavedCompRef.current) return;
    lastSavedCompRef.current = serialized;

    if (compSaveRef.current) clearTimeout(compSaveRef.current);
    compSaveRef.current = setTimeout(async () => {
      try {
        await dbCompetitions.upsert(competitionToDb(comp));
      } catch {
      }
    }, 800);
  }, [
    activeCompetitionId,
    competitions,
  ]);

  useEffect(() => {
    if (!dbReadyRef.current || !activeCompetitionId) return;
    const serialized = JSON.stringify(lifters.map((l) => l.id + l.name));
    if (serialized === lastSavedLiftersRef.current) return;
    lastSavedLiftersRef.current = serialized;

    if (lifterSaveRef.current) clearTimeout(lifterSaveRef.current);
    lifterSaveRef.current = setTimeout(async () => {
      try {
        await dbLifters.upsertAll(
          activeCompetitionId,
          lifters.map((l) => lifterToDb(l, activeCompetitionId))
        );
      } catch {
      }
    }, 800);
  }, [activeCompetitionId, lifters]);

  useEffect(() => {
    if (!dbReadyRef.current || !activeCompetitionId) return;
    const serialized = JSON.stringify(groups);
    if (serialized === lastSavedGroupsRef.current) return;
    lastSavedGroupsRef.current = serialized;

    if (groupSaveRef.current) clearTimeout(groupSaveRef.current);
    groupSaveRef.current = setTimeout(async () => {
      try {
        await dbGroups.upsertAll(
          activeCompetitionId,
          groups.map((g) => groupToDb(g, activeCompetitionId))
        );
      } catch {
      }
    }, 800);
  }, [activeCompetitionId, groups]);

  useEffect(() => {
    if (!activeCompetitionId) return;

    const refreshSignals = async () => {
      try {
        const rows = await dbRefereeSignals.listForCompetition(activeCompetitionId);
        const signals: RefSignal[] = [null, null, null];
        for (const row of rows) {
          if (row.position >= 0 && row.position <= 2) {
            signals[row.position] = (row.signal as RefSignal) ?? null;
          }
        }
        onRefereeSignalsChanged(signals);
      } catch {
      }
    };

    const channel = supabase
      .channel(`referee-signals-${activeCompetitionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "referee_signals",
          filter: `competition_id=eq.${activeCompetitionId}`,
        },
        refreshSignals
      )
      .subscribe();

    refreshSignals();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeCompetitionId, onRefereeSignalsChanged]);

  useEffect(() => {
    if (!activeCompetitionId) return;

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
        onDevicesChanged(rebuildSlots(ch.presenceState<{ position: number }>()));
      })
      .on("presence", { event: "join" }, () => {
        onDevicesChanged(rebuildSlots(ch.presenceState<{ position: number }>()));
      })
      .on("presence", { event: "leave" }, () => {
        onDevicesChanged(rebuildSlots(ch.presenceState<{ position: number }>()));
      })
      .subscribe();

    presenceChannelRef.current = ch;

    return () => {
      presenceChannelRef.current = null;
      supabase.removeChannel(ch);
    };
  }, [activeCompetitionId, onDevicesChanged]);

  const publishSignal = useCallback(
    async (position: number, signal: RefSignal) => {
      if (!activeCompetitionId) return;
      try {
        await dbRefereeSignals.upsertSignal(activeCompetitionId, position, signal, deviceId);
      } catch {
      }
    },
    [activeCompetitionId, deviceId]
  );

  const clearSignals = useCallback(async () => {
    if (!activeCompetitionId) return;
    try {
      await dbRefereeSignals.clearAll(activeCompetitionId);
    } catch {
    }
  }, [activeCompetitionId]);

  const createCompetitionInDb = useCallback(async (comp: CompetitionRecord) => {
    try {
      await dbCompetitions.upsert(competitionToDb(comp));
      dbReadyRef.current = true;
    } catch {
    }
  }, []);

  const deleteCompetitionFromDb = useCallback(async (id: string) => {
    try {
      await dbCompetitions.remove(id);
    } catch {
    }
  }, []);

  const updateCompetitionNameInDb = useCallback(async (id: string, name: string) => {
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
    dbReady: dbReadyRef.current,
    trackPresence,
    untrackPresence,
  };
}
