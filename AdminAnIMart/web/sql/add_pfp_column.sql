-- Adds a profile picture column to the admins table.
-- The image is stored as a base64 data URL (text), set from the
-- admin profile page when a photo is uploaded.
--
-- Run this in the Supabase SQL Editor (or psql) once.

ALTER TABLE public.admins
    ADD COLUMN IF NOT EXISTS pfp text;
