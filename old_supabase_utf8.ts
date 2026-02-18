import { createClient } from '@supabase/supabase-js';

// These should be environment variables in a real app
// For now, we'll use placeholders that the user needs to fill
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Create a dummy client or null if config is missing to prevent crash
export const supabase = (SUPABASE_URL && SUPABASE_KEY && SUPABASE_URL !== 'YOUR_SUPABASE_URL')
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

export interface MedicalRecord {
    id?: string;
    patient_name: string;
    consultation_type: string;
    transcription: string;
    medical_history: string;
    medical_report?: string;
    created_at?: string;
}

export const saveMedicalRecord = async (record: MedicalRecord) => {
    if (!supabase) {
        console.warn('Supabase not configured');
        return null;
    }

    const { data, error } = await supabase
        .from('medical_records')
        .insert([record])
        .select();

    if (error) throw error;
    return data;
};

export const searchMedicalRecords = async (query: string) => {
    if (!supabase) {
        console.warn('Supabase not configured');
        return [];
    }

    const { data, error } = await supabase
        .from('medical_records')
        .select('*')
        .or(`patient_name.ilike.%${query}%,medical_history.ilike.%${query}%`)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
};

export const deleteMedicalRecord = async (id: string): Promise<boolean> => {
    if (!supabase) return false;

    const { error } = await supabase
        .from('medical_records')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Error deleting record:', error);
        return false;
    }
    return true;
};

export const updateMedicalRecord = async (id: string, updates: Partial<MedicalRecord>) => {
    if (!supabase) return null;

    const { data, error } = await supabase
        .from('medical_records')
        .update(updates)
        .eq('id', id)
        .select();

    if (error) {
        console.error('Error updating record:', error);
        throw error;
    }
    return data;
};
