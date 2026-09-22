-- Create receipts storage bucket for budget transaction attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'receipts',
  'receipts',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'authenticated_upload_receipts'
  ) THEN
    CREATE POLICY "authenticated_upload_receipts"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'receipts');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'public_read_receipts'
  ) THEN
    CREATE POLICY "public_read_receipts"
      ON storage.objects FOR SELECT TO public
      USING (bucket_id = 'receipts');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'authenticated_delete_receipts'
  ) THEN
    CREATE POLICY "authenticated_delete_receipts"
      ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'receipts');
  END IF;
END $$;
