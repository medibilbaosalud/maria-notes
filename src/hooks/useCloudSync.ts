import { useState, useEffect } from 'react';

const CLOUD_SYNC_KEY = 'maria_notes_cloud_sync_enabled';

export const useCloudSync = () => {
    const [isCloudEnabled, setIsCloudEnabled] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        return localStorage.getItem(CLOUD_SYNC_KEY) === 'true';
    });

    useEffect(() => {
        localStorage.setItem(CLOUD_SYNC_KEY, String(isCloudEnabled));
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
    return localStorage.getItem(CLOUD_SYNC_KEY) === 'true';
};
