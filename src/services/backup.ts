import { db, type MedicalRecord } from './db';

export interface BackupData {
    version: 1 | 2;
    exportedAt: string;
    records: MedicalRecord[];
}

const MAX_BACKUP_FILE_BYTES = 15 * 1024 * 1024;
const MAX_BACKUP_RECORDS = 10_000;

const asString = (value: unknown, fallback = ''): string => {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return fallback;
    try {
        return String(value);
    } catch {
        return fallback;
    }
};

const normalizeRecord = (input: unknown): Omit<MedicalRecord, 'id'> | null => {
    if (!input || typeof input !== 'object') return null;

    const raw = input as Record<string, unknown>;
    const now = new Date().toISOString();
    const patientName = asString(raw.patient_name, '').trim();
    if (!patientName) return null;

    const consultationType = asString(raw.consultation_type, '').trim() || 'unknown';
    const transcription = asString(raw.transcription, '');
    const medicalHistory = asString(raw.medical_history, '');
    if (!medicalHistory.trim()) return null;

    return {
        record_uuid: asString(raw.record_uuid, ''),
        idempotency_key: asString(raw.idempotency_key, '') || undefined,
        patient_name: patientName,
        consultation_type: consultationType,
        transcription,
        medical_history: medicalHistory,
        original_medical_history: asString(raw.original_medical_history, '') || medicalHistory,
        medical_report: asString(raw.medical_report, '') || undefined,
        ai_model: asString(raw.ai_model, '') || undefined,
        audit_id: asString(raw.audit_id, '') || undefined,
        created_at: asString(raw.created_at, now),
        updated_at: asString(raw.updated_at, asString(raw.created_at, now))
    };
};

export const exportAllRecords = async (): Promise<Blob> => {
    const records = await db.medical_records.toArray();
    const backup: BackupData = {
        version: 2,
        exportedAt: new Date().toISOString(),
        records
    };
    const json = JSON.stringify(backup, null, 2);
    return new Blob([json], { type: 'application/json' });
};

export const downloadBackup = async (): Promise<void> => {
    const blob = await exportAllRecords();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `maria-notes-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

export const importRecords = async (file: File): Promise<{ imported: number; errors: number }> => {
    if (!file) throw new Error('Archivo de backup no encontrado');
    if (file.size <= 0) throw new Error('Archivo de backup vacio');
    if (file.size > MAX_BACKUP_FILE_BYTES) {
        throw new Error(`Backup demasiado grande (max ${Math.floor(MAX_BACKUP_FILE_BYTES / (1024 * 1024))}MB)`);
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const text = e.target?.result;
                if (typeof text !== 'string' || !text.trim()) {
                    throw new Error('Contenido de backup invalido');
                }
                const backup = JSON.parse(text) as Partial<BackupData>;

                if ((backup.version !== 1 && backup.version !== 2) || !Array.isArray(backup.records)) {
                    throw new Error('Formato de backup invalido');
                }
                if (backup.records.length > MAX_BACKUP_RECORDS) {
                    throw new Error(`Demasiados registros en backup (max ${MAX_BACKUP_RECORDS})`);
                }

                const generateUuid = (): string => {
                    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
                    return `uuid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
                };

                let imported = 0;
                let errors = 0;

                for (const record of backup.records) {
                    try {
                        const normalizedRecord = normalizeRecord(record);
                        if (!normalizedRecord) {
                            errors++;
                            continue;
                        }

                        const now = new Date().toISOString();
                        await db.medical_records.add({
                            ...normalizedRecord,
                            record_uuid: normalizedRecord.record_uuid || generateUuid(),
                            created_at: normalizedRecord.created_at || now,
                            updated_at: normalizedRecord.updated_at || normalizedRecord.created_at || now
                        });
                        imported++;
                    } catch {
                        errors++;
                    }
                }

                resolve({ imported, errors });
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('Error leyendo el archivo'));
        reader.readAsText(file);
    });
};
