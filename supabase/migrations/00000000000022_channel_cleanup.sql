-- Channel schema cleanup
-- Remove dead session_strategy and rename system_prompt -> instructions.

ALTER TABLE kortix.channel_configs
  DROP COLUMN IF EXISTS session_strategy;

DO $$ BEGIN
  ALTER TABLE kortix.channel_configs
    RENAME COLUMN system_prompt TO instructions;
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;

DROP TYPE IF EXISTS kortix.session_strategy;
