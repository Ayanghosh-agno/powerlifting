import React, { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { DbRefereeSession } from "@/lib/types";
import { dbRefereeSessions } from "@/lib/db";

interface SessionManagerProps {
  competitionId: string;
  onSessionCreated?: (sessionId: string) => void;
  onSessionsRefreshed?: () => void;
}

export function SessionManager({
  competitionId,
  onSessionCreated,
  onSessionsRefreshed,
}: SessionManagerProps) {
  const [activeSessions, setActiveSessions] = useState<DbRefereeSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  useEffect(() => {
    loadSessions();
  }, [competitionId]);

  const loadSessions = async () => {
    try {
      const sessions = await dbRefereeSessions.getActiveForCompetition(competitionId);
      setActiveSessions(sessions);
      if (sessions.length > 0) {
        setCurrentSessionId(sessions[0].id);
      }
    } catch (error) {
      console.error("Failed to load sessions:", error);
    }
  };

  const createNewSession = async () => {
    setIsLoading(true);
    try {
      const session = await dbRefereeSessions.create(competitionId);
      setCurrentSessionId(session.id);
      setActiveSessions((prev) => [session, ...prev]);
      onSessionCreated?.(session.id);
      toast.success("New session created");
    } catch (error) {
      console.error("Failed to create session:", error);
      toast.error("Failed to create session");
    } finally {
      setIsLoading(false);
    }
  };

  const refreshSessions = async () => {
    setIsLoading(true);
    try {
      await dbRefereeSessions.invalidateAll(competitionId);
      setActiveSessions([]);
      setCurrentSessionId(null);
      onSessionsRefreshed?.();
      toast.success("All sessions invalidated. Create a new session to continue.");
    } catch (error) {
      console.error("Failed to refresh sessions:", error);
      toast.error("Failed to refresh sessions");
    } finally {
      setIsLoading(false);
    }
  };

  const copySessionLink = async (sessionId: string) => {
    const baseUrl = window.location.origin;
    const link = `${baseUrl}/#/referee-session/${sessionId}?cid=${encodeURIComponent(competitionId)}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Session link copied to clipboard");
    } catch (error) {
      console.error("Failed to copy:", error);
      toast.error("Failed to copy link");
    }
  };

  return (
    <Card className="p-6 border-2">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Referee Sessions</h3>
          <Badge variant="outline">
            {activeSessions.length} Active
          </Badge>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={createNewSession}
            disabled={isLoading}
            className="flex-1"
          >
            Create New Session
          </Button>
          <Button
            onClick={refreshSessions}
            disabled={isLoading}
            variant="outline"
            size="icon"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        {currentSessionId && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="text-xs text-gray-600 mb-2">Current Session ID</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm bg-white px-3 py-1 rounded border border-gray-200 font-mono overflow-auto">
                {currentSessionId}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copySessionLink(currentSessionId)}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {activeSessions.length > 1 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-gray-600">Other Active Sessions</h4>
            <div className="space-y-1 max-h-24 overflow-auto">
              {activeSessions.slice(1).map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between text-xs p-2 bg-gray-50 rounded border border-gray-200"
                >
                  <code className="font-mono">{session.id.slice(0, 8)}...</code>
                  <span className="text-gray-600">
                    {new Date(session.created_at).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-xs text-gray-600 pt-2 border-t">
          <p>
            Click "Create New Session" to generate unique access links for referees. Each session
            expires after 24 hours.
          </p>
        </div>
      </div>
    </Card>
  );
}
