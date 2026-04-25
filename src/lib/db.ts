import { supabase } from "./supabase";
import type { DbRefereeSession, DbSignalHistory } from "./types";

export type DbCompetition = {
  id: string;
  name: string;
  mode: string;
  include_collars: boolean;
  started: boolean;
  active_group_name: string | null;
  current_lifter_id: string | null;
  current_lift: string;
  current_attempt_index: number;
  timer_phase: string;
  timer_ends_at: number | null;
  display_layout: string;
  display_theme: string;
  next_attempt_queue: unknown[];
  created_at: string;
  updated_at: string;
};

export type DbGroup = {
  id: string;
  competition_id: string;
  name: string;
  current_lift: string;
  created_at: string;
};

export type DbLifter = {
  id: string;
  competition_id: string;
  name: string;
  sex: string;
  dob: string;
  bodyweight: number | null;
  weight_class: string;
  manual_weight_class: string;
  is_equipped: boolean;
  disqualified: boolean;
  category: string;
  group_name: string;
  group_names: unknown[];
  team: string;
  rack_height_squat: number | null;
  rack_height_bench: number | null;
  lot: number | null;
  squat_attempts: unknown[];
  bench_attempts: unknown[];
  deadlift_attempts: unknown[];
  created_at: string;
  updated_at: string;
};

export type DbRefereeSignal = {
  id: string;
  competition_id: string;
  position: number;
  signal: string | null;
  device_id: string;
  session_id: string | null;
  last_updated_by_device_id: string | null;
  submitted_at: string | null;
  updated_at: string;
};

export type DbRefereeDevice = {
  id: string;
  competition_id: string;
  device_id: string;
  position: number;
  last_seen_at: string;
};

export const dbCompetitions = {
  async list(): Promise<DbCompetition[]> {
    const { data, error } = await supabase
      .from("competitions")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async create(comp: Omit<DbCompetition, "created_at" | "updated_at">): Promise<DbCompetition> {
    const { data, error } = await supabase
      .from("competitions")
      .insert(comp)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async upsert(comp: Omit<DbCompetition, "created_at" | "updated_at">): Promise<void> {
    const { error } = await supabase
      .from("competitions")
      .upsert({ ...comp, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (error) throw error;
  },

  async update(id: string, patch: Partial<DbCompetition>): Promise<void> {
    const { error } = await supabase
      .from("competitions")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from("competitions").delete().eq("id", id);
    if (error) throw error;
  },
};

export const dbGroups = {
  async listForCompetition(competitionId: string): Promise<DbGroup[]> {
    const { data, error } = await supabase
      .from("groups")
      .select("*")
      .eq("competition_id", competitionId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async upsertAll(competitionId: string, groups: Omit<DbGroup, "created_at">[]): Promise<void> {
    if (groups.length === 0) {
      await supabase.from("groups").delete().eq("competition_id", competitionId);
      return;
    }
    const rows = groups.map((g) => ({ ...g, competition_id: competitionId }));
    const { error } = await supabase
      .from("groups")
      .upsert(rows, { onConflict: "id" });
    if (error) throw error;

    const currentIds = groups.map((g) => g.id);
    await supabase
      .from("groups")
      .delete()
      .eq("competition_id", competitionId)
      .not("id", "in", `(${currentIds.map((id) => `"${id}"`).join(",")})`);
  },
};

export const dbLifters = {
  async listForCompetition(competitionId: string): Promise<DbLifter[]> {
    const { data, error } = await supabase
      .from("lifters")
      .select("*")
      .eq("competition_id", competitionId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async upsertAll(competitionId: string, lifters: Omit<DbLifter, "created_at" | "updated_at">[]): Promise<void> {
    if (lifters.length === 0) {
      await supabase.from("lifters").delete().eq("competition_id", competitionId);
      return;
    }
    const rows = lifters.map((l) => ({
      ...l,
      competition_id: competitionId,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from("lifters")
      .upsert(rows, { onConflict: "id" });
    if (error) throw error;

    const currentIds = lifters.map((l) => l.id);
    await supabase
      .from("lifters")
      .delete()
      .eq("competition_id", competitionId)
      .not("id", "in", `(${currentIds.map((id) => `"${id}"`).join(",")})`);
  },
};

export const dbRefereeSignals = {
  async listForCompetition(competitionId: string): Promise<DbRefereeSignal[]> {
    const { data, error } = await supabase
      .from("referee_signals")
      .select("*")
      .eq("competition_id", competitionId)
      .order("position", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async upsertSignal(
    competitionId: string,
    position: number,
    signal: string | null,
    deviceId: string,
    sessionId?: string | null
  ): Promise<void> {
    const { error } = await supabase
      .from("referee_signals")
      .upsert(
        {
          competition_id: competitionId,
          position,
          signal,
          device_id: deviceId,
          session_id: sessionId || null,
          last_updated_by_device_id: deviceId,
          submitted_at: signal ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "competition_id,position" }
      );
    if (error) throw error;
  },

  async clearAll(competitionId: string): Promise<void> {
    const { error } = await supabase
      .from("referee_signals")
      .delete()
      .eq("competition_id", competitionId);
    if (error) throw error;
  },
};

export const dbRefereeDevices = {
  async listForCompetition(competitionId: string): Promise<DbRefereeDevice[]> {
    const { data, error } = await supabase
      .from("referee_devices")
      .select("*")
      .eq("competition_id", competitionId);
    if (error) throw error;
    return data ?? [];
  },

  async heartbeat(competitionId: string, position: number, deviceId: string): Promise<void> {
    const { error } = await supabase
      .from("referee_devices")
      .upsert(
        {
          competition_id: competitionId,
          device_id: deviceId,
          position,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "competition_id,position" }
      );
    if (error) throw error;
  },

  async remove(competitionId: string, position: number): Promise<void> {
    const { error } = await supabase
      .from("referee_devices")
      .delete()
      .eq("competition_id", competitionId)
      .eq("position", position);
    if (error) throw error;
  },
};

export const dbRefereeSessions = {
  async create(competitionId: string): Promise<DbRefereeSession> {
    await supabase
      .from("referee_sessions")
      .delete()
      .eq("competition_id", competitionId);

    const { data, error } = await supabase
      .from("referee_sessions")
      .insert({
        competition_id: competitionId,
        is_active: true,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async validate(sessionId: string): Promise<DbRefereeSession | null> {
    const { data, error } = await supabase
      .from("referee_sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const now = new Date();
    const expiresAt = new Date(data.expires_at);
    if (now > expiresAt || !data.is_active) return null;
    return data;
  },

  async getActiveForCompetition(competitionId: string): Promise<DbRefereeSession[]> {
    const { data, error } = await supabase
      .from("referee_sessions")
      .select("*")
      .eq("competition_id", competitionId)
      .eq("is_active", true)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async invalidateAll(competitionId: string): Promise<void> {
    const { error } = await supabase
      .from("referee_sessions")
      .delete()
      .eq("competition_id", competitionId);
    if (error) throw error;
  },

  async invalidateSession(sessionId: string): Promise<void> {
    const { error } = await supabase
      .from("referee_sessions")
      .update({ is_active: false })
      .eq("id", sessionId);
    if (error) throw error;
  },
};

export const dbSignalHistory = {
  async create(
    sessionId: string,
    competitionId: string,
    position: number,
    signal: "GOOD" | "NO",
    deviceId: string
  ): Promise<DbSignalHistory> {
    const { data, error } = await supabase
      .from("signal_history")
      .insert({
        session_id: sessionId,
        competition_id: competitionId,
        position,
        signal,
        device_id: deviceId,
        submitted_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async markDelivered(historyId: string): Promise<void> {
    const { error } = await supabase
      .from("signal_history")
      .update({ delivered_at: new Date().toISOString() })
      .eq("id", historyId);
    if (error) throw error;
  },

  async listForCompetition(competitionId: string): Promise<DbSignalHistory[]> {
    const { data, error } = await supabase
      .from("signal_history")
      .select("*")
      .eq("competition_id", competitionId)
      .order("submitted_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async listRecentDeliveries(competitionId: string, limit: number = 10): Promise<DbSignalHistory[]> {
    const { data, error } = await supabase
      .from("signal_history")
      .select("*")
      .eq("competition_id", competitionId)
      .not("delivered_at", "is", null)
      .order("delivered_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  },
};
