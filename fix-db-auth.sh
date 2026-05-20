#!/bin/bash
set -euo pipefail
mysql -uroot <<SQL
CREATE USER IF NOT EXISTS 'xk_reader_user'@'127.0.0.1' IDENTIFIED BY 'fI8I9FH0oTQZTAJrvtp-5O7ctsp1kNE7';
CREATE USER IF NOT EXISTS 'xk_reader_user'@'localhost' IDENTIFIED BY 'fI8I9FH0oTQZTAJrvtp-5O7ctsp1kNE7';
GRANT ALL PRIVILEGES ON xk_reader.* TO 'xk_reader_user'@'127.0.0.1';
GRANT ALL PRIVILEGES ON xk_reader.* TO 'xk_reader_user'@'localhost';
FLUSH PRIVILEGES;
SQL
python3 - <<'PY'
from pathlib import Path
p = Path('/www/xk-reader/backend/.env')
text = p.read_text(encoding='utf-8-sig')
lines = text.splitlines()
out = []
for line in lines:
    if line.startswith('DATABASE_URL='):
        out.append('DATABASE_URL=mysql+pymysql://xk_reader_user:fI8I9FH0oTQZTAJrvtp-5O7ctsp1kNE7@127.0.0.1:3306/xk_reader?charset=utf8mb4')
    else:
        out.append(line)
p.write_text('\n'.join(out) + '\n', encoding='utf-8')
PY
systemctl restart xk-reader-backend
sleep 6
systemctl status xk-reader-backend --no-pager -l | sed -n '1,80p'
curl -fsS http://127.0.0.1:8000/api/health
curl -fsSI http://127.0.0.1/
