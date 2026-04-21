import { useQuery } from "@tanstack/react-query";
import type { AuthUser } from "@/App";
import { qk } from "./keys";

export function useCurrentUser() {
  return useQuery<AuthUser>({
    queryKey: qk.auth.me(),
    staleTime: 5 * 60 * 1000,
  });
}
