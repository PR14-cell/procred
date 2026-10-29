-- Migration: 20261025100000_add_must_change_password
-- Add must_change_password flag to users table for forced initial password changes
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT false;
