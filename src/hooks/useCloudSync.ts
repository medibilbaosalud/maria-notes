import { useEffect, useState } from 'react';
import { getSupabaseAccessMode, getSupabaseAuthSnapshot, onSupabaseAuthChange } from '../services/supabase';

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
    const cloudAccessMode = !isCloudEnabled ? 'disabled' : getSupabaseAccessMode();

    return {
        isCloudEnabled,
        isCloudAuthenticated: cloudAccessMode !== 'disabled',
        cloudAccessMode,
        cloudUserEmail: authSnapshot.userEmail,
        toggleCloud: () => { console.warn("Cloud sync is always enabled by system policy."); },
        enableCloud: () => { },
        disableCloud: () => { }
    };
};

// Utility to check cloud sync status without hook
export const isCloudSyncEnabled = (): boolean => {
    return hasCloudConfig();
};
