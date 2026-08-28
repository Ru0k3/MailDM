CREATE TABLE IF NOT EXISTS ai_credentials (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  provider VARCHAR(32) NOT NULL,
  label VARCHAR(120) NULL,
  base_url VARCHAR(500) NOT NULL,
  encrypted_api_key TEXT NOT NULL,
  cached_models JSON NOT NULL,
  validated_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ai_credential_user_provider_url (user_id, provider, base_url),
  CONSTRAINT fk_ai_credentials_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE settings
  ADD COLUMN active_ai_credential_id BIGINT UNSIGNED NULL,
  ADD CONSTRAINT fk_settings_active_credential FOREIGN KEY (active_ai_credential_id) REFERENCES ai_credentials(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS model_choices (
  token CHAR(43) NOT NULL PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  credential_id BIGINT UNSIGNED NOT NULL,
  choice_type ENUM('model','credential') NOT NULL,
  model_id VARCHAR(255) NULL,
  expires_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_model_choices_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_model_choices_credential FOREIGN KEY (credential_id) REFERENCES ai_credentials(id) ON DELETE CASCADE
) ENGINE=InnoDB;
