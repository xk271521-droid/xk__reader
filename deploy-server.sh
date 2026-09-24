#!/bin/bash
set -e
mkdir -p /www/xk-reader /www/xk-reader/frontend /www/xk-reader/backend
if ! command -v nginx >/dev/null 2>&1; then
  yum install -y nginx
fi
if [ -d /opt/miniconda3 ] && [ ! -x /opt/miniconda3/bin/conda ]; then
  rm -rf /opt/miniconda3
fi
if [ ! -x /opt/miniconda3/bin/conda ]; then
  curl -fsSL -o /root/miniconda.sh https://repo.anaconda.com/miniconda/Miniconda3-py310_24.3.0-0-Linux-x86_64.sh
  bash /root/miniconda.sh -b -p /opt/miniconda3
fi
rm -rf /opt/miniconda3/envs/xk-reader
/opt/miniconda3/bin/conda create -y -n xk-reader python=3.10
rm -rf /www/xk-reader/backend/app /www/xk-reader/backend/data /www/xk-reader/backend/scripts /www/xk-reader/backend/__pycache__
rm -f /www/xk-reader/backend/main.py /www/xk-reader/backend/requirements.txt /www/xk-reader/backend/VERIFICATION_SETUP.md /www/xk-reader/backend/tmp_fix_notifications.sql
mkdir -p /www/xk-reader/backend/uploads/avatars /www/xk-reader/backend/uploads/papers
mkdir -p /www/xk-reader/frontend

tar -xzf /root/deploy-backend.tar.gz -C /www/xk-reader
cp /root/xk-reader.env /www/xk-reader/backend/.env
rm -rf /www/xk-reader/frontend/*
tar -xzf /root/deploy-frontend-dist.tar.gz -C /www/xk-reader/frontend --strip-components=1

/opt/miniconda3/envs/xk-reader/bin/python -m pip install --upgrade pip
/opt/miniconda3/envs/xk-reader/bin/python -m pip install -r /www/xk-reader/backend/requirements.txt

cat > /etc/systemd/system/xk-reader-backend.service <<'SERVICE'
[Unit]
Description=XK Reader FastAPI Backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/www/xk-reader/backend
ExecStart=/opt/miniconda3/envs/xk-reader/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
SERVICE

mkdir -p /etc/nginx/conf.d
cat > /etc/nginx/conf.d/xk-reader.conf <<'NGINX'
server {
    listen 80 default_server;
    server_name xkreader.xyz www.xkreader.xyz 47.99.141.123 _;

    root /www/xk-reader/frontend;
    index index.html;
    client_max_body_size 100m;
    client_body_timeout 300s;
    send_timeout 300s;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /uploads/ {
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Range, Authorization, Content-Type" always;
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location /downloads/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=300" always;
    }

    location = /index.html {
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
        add_header Pragma "no-cache" always;
        add_header Expires "0" always;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX

nginx -t
systemctl daemon-reload
systemctl enable xk-reader-backend
systemctl restart xk-reader-backend
systemctl enable nginx
systemctl restart nginx
sleep 6
curl -fsS http://127.0.0.1:8000/api/health
curl -fsS -I http://127.0.0.1/
