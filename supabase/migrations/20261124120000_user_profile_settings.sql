-- Self-service Profile & Account Settings: contact details, profile photo, own-password change.
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS avatar_url text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('user-avatars', 'user-avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "user_avatars_public_read" ON storage.objects;
CREATE POLICY "user_avatars_public_read" ON storage.objects FOR SELECT USING (bucket_id = 'user-avatars');
DROP POLICY IF EXISTS "user_avatars_insert" ON storage.objects;
CREATE POLICY "user_avatars_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'user-avatars');
DROP POLICY IF EXISTS "user_avatars_update" ON storage.objects;
CREATE POLICY "user_avatars_update" ON storage.objects FOR UPDATE USING (bucket_id = 'user-avatars');
DROP POLICY IF EXISTS "user_avatars_delete" ON storage.objects;
CREATE POLICY "user_avatars_delete" ON storage.objects FOR DELETE USING (bucket_id = 'user-avatars');

-- A user changes their OWN password; the current password must be supplied and verified.
CREATE OR REPLACE FUNCTION public.change_own_password(
  p_user_uuid uuid, p_current_password varchar, p_new_password varchar
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_hash text;
BEGIN
  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RAISE EXCEPTION 'New password must be at least 6 characters';
  END IF;
  SELECT password_hash INTO v_hash FROM public.app_users WHERE id = p_user_uuid AND is_active = true;
  IF v_hash IS NULL OR v_hash <> extensions.crypt(p_current_password, v_hash) THEN
    RETURN false;
  END IF;
  UPDATE public.app_users
     SET password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')), updated_at = now()
   WHERE id = p_user_uuid;
  RETURN true;
END;
$$;
