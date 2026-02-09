// Cloud sync is now permanently enabled by default
export const useCloudSync = () => {
    // Force enabled
    const isCloudEnabled = true;

    // No-ops for state changes
    const toggleCloud = () => { };
    const enableCloud = () => { };
    const disableCloud = () => { };

    return {
        isCloudEnabled,
        toggleCloud,
        enableCloud,
        disableCloud
    };
};

// Utility to check cloud sync status without hook
export const isCloudSyncEnabled = (): boolean => {
    return true;
};
