-- Add the original_medical_history column to the medical_records table
ALTER TABLE medical_records 
ADD COLUMN original_medical_history TEXT;

-- Optional: Add a comment to the column for clarity
COMMENT ON COLUMN medical_records.original_medical_history IS 'Preserves the raw AI output before user edits';
