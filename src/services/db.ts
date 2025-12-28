import Dexie, { type EntityTable } from 'dexie';

export interface MedicalRecord {
    id?: number;
    patient_name: string;
    consultation_type: string;
    transcription: string;
    medical_history: string;
    medical_report?: string;
    created_at: string;
}

const db = new Dexie('MariaNotesDB') as Dexie & {
    medical_records: EntityTable<MedicalRecord, 'id'>;
};

db.version(1).stores({
    medical_records: '++id, patient_name, created_at'
});

export { db };
