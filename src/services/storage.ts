import { db, type MedicalRecord } from './db';
import { supabase } from './supabase';
import { isCloudSyncEnabled } from '../hooks/useCloudSync';

export type { MedicalRecord };

// Helper to sync a record to Supabase (fire-and-forget)
const syncToCloud = async (record: MedicalRecord, operation: 'insert' | 'update' | 'delete') => {
    if (!isCloudSyncEnabled() || !supabase) return;

    try {
        if (operation === 'insert') {
            // For cloud, we don't send the local id, but we send other fields including ai_model
            const { id, ...cloudRecord } = record;
            await supabase.from('medical_records').insert([cloudRecord]);
            console.log('[Cloud Sync] Record inserted');
        } else if (operation === 'update') {
            // Cloud uses created_at as a pseudo-unique key (or you could add a uuid field)
            await supabase.from('medical_records')
                .update(record)
                .eq('created_at', record.created_at);
            console.log('[Cloud Sync] Record updated');
        } else if (operation === 'delete') {
            await supabase.from('medical_records')
                .delete()
                .eq('created_at', record.created_at);
            console.log('[Cloud Sync] Record deleted');
        }
    } catch (error) {
        console.warn('[Cloud Sync] Failed:', error);
    }
};

export const saveMedicalRecord = async (record: Omit<MedicalRecord, 'id' | 'created_at'> & { ai_model?: string }): Promise<MedicalRecord[] | null> => {
    try {
        const newRecord: MedicalRecord = {
            ...record,
            created_at: new Date().toISOString()
        };
        const id = await db.medical_records.add(newRecord);
        const saved = await db.medical_records.get(id);

        // Cloud sync
        if (saved) syncToCloud(saved, 'insert');

        return saved ? [saved] : null;
    } catch (error) {
        console.error('Error saving record:', error);
        return null;
    }
};

export const searchMedicalRecords = async (query: string): Promise<MedicalRecord[]> => {
    try {
        const lowerQuery = query.toLowerCase();
        const all = await db.medical_records.orderBy('created_at').reverse().toArray();
        if (!query.trim()) return all;
        return all.filter(
            r =>
                r.patient_name.toLowerCase().includes(lowerQuery) ||
                r.medical_history.toLowerCase().includes(lowerQuery)
        );
    } catch (error) {
        console.error('Error searching records:', error);
        return [];
    }
};

export const deleteMedicalRecord = async (id: string | number): Promise<boolean> => {
    try {
        // Get record before deleting for cloud sync
        const record = await db.medical_records.get(Number(id));
        await db.medical_records.delete(Number(id));

        // Cloud sync
        if (record) syncToCloud(record, 'delete');

        return true;
    } catch (error) {
        console.error('Error deleting record:', error);
        return false;
    }
};

export const updateMedicalRecord = async (id: string | number, updates: Partial<MedicalRecord>): Promise<MedicalRecord[] | null> => {
    try {
        await db.medical_records.update(Number(id), updates);
        const updated = await db.medical_records.get(Number(id));

        // Cloud sync
        if (updated) syncToCloud(updated, 'update');

        return updated ? [updated] : null;
    } catch (error) {
        console.error('Error updating record:', error);
        return null;
    }
};

export const syncFromCloud = async (): Promise<number> => {
    if (!isCloudSyncEnabled() || !supabase) return 0;

    try {
        console.log('[Cloud Sync] Checking for new records...');
        const { data: cloudRecords, error } = await supabase
            .from('medical_records')
            .select('*')
            .order('created_at', { ascending: false });

        if (error || !cloudRecords) {
            console.error('[Cloud Sync] Fetch failed:', error);
            return 0;
        }

        const localRecords = await db.medical_records.toArray();
        const localCreatedAts = new Set(localRecords.map(r => r.created_at));

        const newRecords: any[] = [];
        let addedCount = 0;

        for (const cloudRec of cloudRecords) {
            const cloudCreatedAt = cloudRec.created_at || '';
            if (cloudCreatedAt && !localCreatedAts.has(cloudCreatedAt)) {
                // Remove the UUID 'id' from Supabase, let Dexie generate a local auto-increment ID
                const { id, ...recordToInsert } = cloudRec;
                newRecords.push(recordToInsert);
                addedCount++;
            }
        }

        if (newRecords.length > 0) {
            await db.medical_records.bulkAdd(newRecords);
            console.log(`[Cloud Sync] Imported ${addedCount} records from cloud.`);
        } else {
            console.log('[Cloud Sync] Local DB is up to date.');
        }

        return addedCount;

    } catch (error) {
        console.error('[Cloud Sync] Sync error:', error);
        return 0;
    }
};
