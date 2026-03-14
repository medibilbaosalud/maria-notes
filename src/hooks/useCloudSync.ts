import { useEffect, useState } from 'react';
import { getSupabaseAuthSnapshot, onSupabaseAuthChange } from '../services/supabase';

const hasCloudConfig = (): boolean => {
    const url = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
    const key = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
    if (!url || !key) return false;
    if (url.toLowerCase().includes('your_supabase_url')) return false;
    if (key.toLowerCase().includes('your_supabase_anon_key')) return false;
    return true;
};

export const useCloudSync = () => {
    const [authSnapshot, setAuthSnapshot] = useState(() => getSupabaseAuthSnapshot());

    useEffect(() => onSupabaseAuthChange(setAuthSnapshot), []);

    const isCloudEnabled = hasCloudConfig();

    // No-ops for state changes
    const toggleCloud = () => { };
    const enableCloud = () => { };
    const disableCloud = () => { };

    return {
        isCloudEnabled,
        isCloudAuthenticated: authSnapshot.isAuthenticated,
        cloudUserEmail: authSnapshot.userEmail,
        toggleCloud,
        enableCloud,
        disableCloud
    };
};

// Utility to check cloud sync status without hook
export const isCloudSyncEnabled = (): boolean => {
    return hasCloudConfig();
};
