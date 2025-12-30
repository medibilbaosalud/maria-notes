import Dexie, { type EntityTable } from 'dexie';

export interface MedicalRecord {
    id?: number;
    patient_name: string;
    consultation_type: string;
    transcription: string;
    medical_history: string;
    original_medical_history?: string; // Preserves the raw AI output before user edits
    medical_report?: string;
    ai_model?: string;
    created_at: string;
}

export interface LabTestLog {
    id?: number;
    test_name: string;
    created_at: string;
    input_type: 'audio' | 'text';
    transcription: string;
    medical_history: string;
    metadata: {
        corrections: number;
        models: { generation: string; validation: string };
        errorsFixed: number;
        versionsCount: number;
        validationHistory?: { type: string; field: string; reason: string }[];
        remainingErrors?: { type: string; field: string; reason: string }[];
    };
}

const db = new Dexie('MariaNotesDB') as Dexie & {
    medical_records: EntityTable<MedicalRecord, 'id'>;
    lab_test_logs: EntityTable<LabTestLog, 'id'>;
};

db.version(2).stores({
    medical_records: '++id, patient_name, created_at',
    lab_test_logs: '++id, test_name, created_at'
});

export { db };
