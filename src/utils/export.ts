export const downloadRecordAsJson = (data: {
    patientName?: string;
    date?: string;
    content: string;
    metadata?: any;
}) => {
    try {
        const safeName = (data.patientName || 'Paciente_Sin_Nombre').replace(/[^a-z0-9_\-]/gi, '_');
        const dateStr = data.date ? new Date(data.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        const filename = `Historia_${safeName}_${dateStr}.json`;

        const exportData = {
            version: '1.0',
            exported_at: new Date().toISOString(),
            patient_name: data.patientName,
            content: data.content,
            metadata: data.metadata || {}
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();

        // Cleanup
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        return true;
    } catch (error) {
        console.error('Failed to download JSON:', error);
        return false;
    }
};
