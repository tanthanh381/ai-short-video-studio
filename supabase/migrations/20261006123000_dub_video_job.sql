-- Server-side dubbing for an uploaded video. It reuses projects/jobs/exports,
-- so auth, retry, private storage and signed downloads stay consistent.
alter type public.job_type add value if not exists 'dub_video';

update storage.buckets
set file_size_limit = greatest(coalesce(file_size_limit, 0), 52428800),
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'audio/mpeg',
      'audio/wav', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'video/mp4',
      'video/webm', 'video/quicktime']
where id = 'private-media';
