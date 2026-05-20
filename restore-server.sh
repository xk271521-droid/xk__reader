#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y nginx mysql-server python3-venv python3-pip build-essential pkg-config default-libmysqlclient-dev libssl-dev libffi-dev
systemctl enable mysql
systemctl start mysql
mysql -uroot <<'SQL'
CREATE DATABASE IF NOT EXISTS xk_reader CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
SQL
zcat /root/xk_reader.sql.gz | mysql -uroot xk_reader
mkdir -p /www/xk-reader/backend /www/xk-reader/frontend
rm -rf /www/xk-reader/backend/app /www/xk-reader/backend/data /www/xk-reader/backend/scripts /www/xk-reader/backend/uploads /www/xk-reader/backend/__pycache__
rm -f /www/xk-reader/backend/main.py /www/xk-reader/backend/requirements.txt /www/xk-reader/backend/.env
rm -rf /www/xk-reader/frontend/*
tar -xzf /root/deploy-backend.tar.gz -C /www/xk-reader
tar -xzf /root/deploy-frontend-dist.tar.gz -C /www/xk-reader/frontend --strip-components=1
cp /root/backend.env.backup /www/xk-reader/backend/.env
python3 - <<'PY'
from pathlib import Path
p = Path('/www/xk-reader/backend/.env')
lines = p.read_text(encoding='utf-8').splitlines()
repl = {
    'APP_ENV': 'production',
    'DATABASE_URL': 'mysql+pymysql://root@127.0.0.1:3306/xk_reader?charset=utf8mb4',
    'ALLOWED_ORIGINS': 'http://47.99.141.123,http://xkreader.xyz,http://www.xkreader.xyz,http://localhost,http://127.0.0.1',
    'UPLOAD_MIRROR_ENABLED': 'false',
    'UPLOAD_MIRROR_SFTP_HOST': '',
    'UPLOAD_MIRROR_SFTP_USERNAME': '',
    'UPLOAD_MIRROR_SFTP_PASSWORD': '',
}
out=[]
seen=set()
for line in lines:
    if '=' in line and not line.lstrip().startswith('#'):
        key,_=line.split('=',1)
        if key in repl:
            out.append(f'{key}={repl[key]}')
            seen.add(key)
            continue
    out.append(line)
for k,v in repl.items():
    if k not in seen:
        out.append(f'{k}={v}')
p.write_text('\n'.join(out)+'\n', encoding='utf-8')
PY
mkdir -p /www/xk-reader/backend
if [ -f /root/uploads-backup.tar.gz ]; then
  tar -xzf /root/uploads-backup.tar.gz -C /www/xk-reader/backend
fi
python3 -m venv /www/xk-reader/venv
/www/xk-reader/venv/bin/pip install --upgrade pip
/www/xk-reader/venv/bin/pip install -r /www/xk-reader/backend/requirements.txt
cat > /etc/systemd/system/xk-reader-backend.service <<'SERVICE'
[Unit]
Description=XK Reader FastAPI Backend
After=network.target mysql.service

[Service]
Type=simple
WorkingDirectory=/www/xk-reader/backend
ExecStart=/www/xk-reader/venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
SERVICE
cat > /etc/nginx/sites-available/xk-reader <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name 47.99.141.123 xkreader.xyz www.xkreader.xyz _;

    root /www/xk-reader/frontend;
    index index.html;
    client_max_body_size 50m;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/xk-reader /etc/nginx/sites-enabled/xk-reader
nginx -t
systemctl daemon-reload
systemctl enable xk-reader-backend
systemctl restart xk-reader-backend
systemctl enable nginx
systemctl restart nginx
sleep 6
curl -fsS http://127.0.0.1:8000/api/health
curl -fsSI http://127.0.0.1/
mysql -uroot -e 'USE xk_reader; SHOW TABLES;' | head
