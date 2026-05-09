import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { dbRefereeSessions } from "@/lib/db";
import { isSupabaseConfigured } from "@/lib/supabase";

interface UseRefereSessionValidationResult {
  sessionId: string | null;
  isValid: boolean;
  isLoading: boolean;
  error: string | null;
  competitionId: string | null;
}

export function useRefereSessionValidation(): UseRefereSessionValidationResult {
  const [searchParams] = useSearchParams();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isValid, setIsValid] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [competitionId] = useState<string | null>(
    searchParams.get("cid") || searchParams.get("competition_id")
  );

  useEffect(() => {
    const validateSessionFromUrl = async () => {
      try {
        const urlSessionId = searchParams.get("session") || searchParams.get("sid");
        const cidFromUrl = searchParams.get("cid") || searchParams.get("competition_id");
        setSessionId(urlSessionId);

        // Local/offline mode: allow referee links without DB-backed session records.
        if (!isSupabaseConfigured) {
          setIsValid(true);
          setError(null);
          setIsLoading(false);
          return;
        }

        if (!urlSessionId) {
          setIsValid(false);
          setError("No session provided. Please create a referee session and regenerate the QR link.");
          setIsLoading(false);
          return;
        }

        const session = await dbRefereeSessions.validate(urlSessionId);
        if (session) {
          if (cidFromUrl && session.competition_id !== cidFromUrl) {
            setIsValid(false);
            setError("Session does not match this competition. Please generate a new referee session.");
          } else {
            setIsValid(true);
            setError(null);
          }
        } else {
          setIsValid(false);
          setError("Session expired or invalid. Please create a new referee session before opening this station.");
        }
      } catch (err) {
        console.error("Session validation error:", err);
        setIsValid(false);
        setError("Failed to validate session. Please check your connection and try again.");
      } finally {
        setIsLoading(false);
      }
    };

    validateSessionFromUrl();
  }, [searchParams]);

  return { sessionId, isValid, isLoading, error, competitionId };
}
