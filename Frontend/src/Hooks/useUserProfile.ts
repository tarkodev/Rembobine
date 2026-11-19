import { useQuery } from '@tanstack/react-query';
import { useSettings } from '../Context/SettingsContext';
import { api } from '../lib/api';
import { useAuth } from './useAuth.tsx';

export function useProfile() {
  const { enableAccountAndSharing } = useSettings();
  const { user, session } = useAuth();
  return useQuery({
    queryKey: ['profile', user?.id],
    queryFn: async () => {
      if (!session) return null;
      const profile = await api.getProfile(session.access_token);
      if (profile?.error) throw new Error(profile.error);
      return profile;
    },
    enabled: enableAccountAndSharing && !!user && !!session,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    placeholderData: (previousData) => previousData,
  });
}
