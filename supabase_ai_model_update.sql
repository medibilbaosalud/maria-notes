-- Run this in Supabase SQL Editor to track the AI model used
ALTER TABLE medical_records 
ADD COLUMN ai_model TEXT;
