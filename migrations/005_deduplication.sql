CREATE TABLE IF NOT EXISTS processed_source_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  gmail_account_id BIGINT UNSIGNED NOT NULL,
  external_id VARCHAR(255) NOT NULL,
  first_processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_processed_account_external (gmail_account_id, external_id),
  CONSTRAINT fk_processed_gmail_account FOREIGN KEY (gmail_account_id) REFERENCES gmail_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;
