-- Align quality/feedback tables with the canonical clinical identifier.
-- The application already uses medical_records.record_uuid as the stable record id.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'doctor_satisfaction_events'
      and column_name = 'record_id'
  ) then
    begin
      alter table public.doctor_satisfaction_events
        drop constraint if exists doctor_satisfaction_events_record_id_fkey;
    exception
      when undefined_table then
        null;
    end;

    alter table public.doctor_satisfaction_events
      add constraint doctor_satisfaction_events_record_id_fkey
      foreign key (record_id) references public.medical_records(record_uuid) on delete set null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'consultation_quality_summary'
      and column_name = 'record_id'
  ) then
    begin
      alter table public.consultation_quality_summary
        drop constraint if exists consultation_quality_summary_record_id_fkey;
    exception
      when undefined_table then
        null;
    end;

    alter table public.consultation_quality_summary
      add constraint consultation_quality_summary_record_id_fkey
      foreign key (record_id) references public.medical_records(record_uuid) on delete cascade;
  end if;
end $$;
