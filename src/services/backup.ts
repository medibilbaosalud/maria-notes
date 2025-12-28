import { db, type MedicalRecord } from './db';

export interface BackupData {
    version: 1;
    exportedAt: string;
    records: MedicalRecord[];
}

export const exportAllRecords = async (): Promise<Blob> => {
    const records = await db.medical_records.toArray();
    const backup: BackupData = {
        version: 1,
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
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const text = e.target?.result as string;
                const backup: BackupData = JSON.parse(text);

                if (!backup.version || !Array.isArray(backup.records)) {
                    throw new Error('Formato de backup inválido');
                }

                let imported = 0;
                let errors = 0;

                for (const record of backup.records) {
                    try {
                        // Remove id to let IndexedDB auto-generate new ones
                        const { id, ...recordWithoutId } = record;
                        await db.medical_records.add({
                            ...recordWithoutId,
                            created_at: record.created_at || new Date().toISOString()
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
