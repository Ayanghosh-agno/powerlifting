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
          // Keep referee stations usable if session token is unavailable but competition is known.
          if (cidFromUrl) {
            setIsValid(true);
            setError(null);
          } else {
            setError("No session provided. Please use a valid referee link.");
          }
          setIsLoading(false);
          return;
        }

        const session = await dbRefereeSessions.validate(urlSessionId);
        if (session) {
          setIsValid(true);
          setError(null);
        } else {
          // Allow loading with competition context even if the specific token expires.
          if (cidFromUrl) {
            setIsValid(true);
            setError(null);
          } else {
            setIsValid(false);
            setError("Session expired or invalid. Please request a new link from the referee coordinator.");
          }
        }
      } catch (err) {
        console.error("Session validation error:", err);
        if (cidFromUrl) {
          setIsValid(true);
          setError(null);
        } else {
          setIsValid(false);
          setError("Failed to validate session. Please check your connection and try again.");
        }
      } finally {
        setIsLoading(false);
      }
    };

    validateSessionFromUrl();
  }, [searchParams]);

  return { sessionId, isValid, isLoading, error, competitionId };
}
