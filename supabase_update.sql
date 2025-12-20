-- Ejecuta este código en el Editor SQL de Supabase para añadir la columna de informes

ALTER TABLE medical_records 
ADD COLUMN medical_report TEXT;

-- Opcional: Si quieres guardar también la fecha de generación del informe
ALTER TABLE medical_records 
ADD COLUMN report_created_at TIMESTAMPTZ;
