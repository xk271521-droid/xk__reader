ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  source_kind VARCHAR(32) NOT NULL,
  source_id INT NOT NULL,
  event_kind VARCHAR(24) NOT NULL,
  title VARCHAR(160) NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  action_kind VARCHAR(48) NOT NULL,
  action_payload JSON NOT NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX ix_notifications_user_id (user_id),
  INDEX ix_notifications_user_created (user_id, created_at),
  CONSTRAINT fk_notifications_user_id_users FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
SHOW COLUMNS FROM users;
SHOW COLUMNS FROM notifications;
