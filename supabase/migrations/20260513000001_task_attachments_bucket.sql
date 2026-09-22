-- Create task-attachments storage bucket for task file uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-attachments',
  'task-attachments',
  true,
  20971520,
  ARRAY[
    'image/jpeg','image/jpg','image/png','image/gif','image/webp',
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain','text/csv','application/octet-stream'
  ]
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'authenticated_upload_task_attachments'
  ) THEN
    CREATE POLICY "authenticated_upload_task_attachments"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'task-attachments');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'public_read_task_attachments'
  ) THEN
    CREATE POLICY "public_read_task_attachments"
      ON storage.objects FOR SELECT TO public
      USING (bucket_id = 'task-attachments');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'authenticated_delete_task_attachments'
  ) THEN
    CREATE POLICY "authenticated_delete_task_attachments"
      ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'task-attachments');
  END IF;
END $$;
