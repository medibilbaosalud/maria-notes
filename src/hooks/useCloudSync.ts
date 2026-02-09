import { useState, useEffect } from 'react';
import { safeGetLocalStorage, safeSetLocalStorage } from '../utils/safeBrowser';

const CLOUD_SYNC_KEY = 'maria_notes_cloud_sync_enabled';
const parseCloudSyncPreference = (raw: string | null): boolean => {
    if (raw === 'false') return false;
    if (raw === 'true') return true;
    return true;
};

export const useCloudSync = () => {
    const [isCloudEnabled, setIsCloudEnabled] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        return parseCloudSyncPreference(safeGetLocalStorage(CLOUD_SYNC_KEY));
    });

    useEffect(() => {
        safeSetLocalStorage(CLOUD_SYNC_KEY, String(isCloudEnabled));
    }, [isCloudEnabled]);

    const toggleCloud = () => {
        setIsCloudEnabled(prev => !prev);
    };

    const enableCloud = () => setIsCloudEnabled(true);
    const disableCloud = () => setIsCloudEnabled(false);

    return {
        isCloudEnabled,
        toggleCloud,
        enableCloud,
        disableCloud
    };
};

// Utility to check cloud sync status without hook
export const isCloudSyncEnabled = (): boolean => {
    if (typeof window === 'undefined') return false;
    return parseCloudSyncPreference(safeGetLocalStorage(CLOUD_SYNC_KEY));
};
