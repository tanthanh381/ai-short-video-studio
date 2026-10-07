-- Add render_whiteboard job type
ALTER TYPE public.job_type ADD VALUE IF NOT EXISTS 'render_whiteboard';

-- Store annotation JSON per scene (editable via browser, used by whiteboard renderer)
ALTER TABLE public.scenes ADD COLUMN IF NOT EXISTS annotation_json JSONB;
