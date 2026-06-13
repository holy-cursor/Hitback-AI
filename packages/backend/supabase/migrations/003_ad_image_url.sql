-- Optional hero image for ads (extension panel + previews)
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS ad_image_url TEXT;
