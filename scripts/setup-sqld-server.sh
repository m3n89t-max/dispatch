#!/bin/bash
# sqld (libsql 서버) 설치 및 서비스 등록 스크립트
# 서버: 23.20.121.23 (Linux/EC2)
# 사용법: ssh ubuntu@23.20.121.23 < setup-sqld-server.sh

set -e

DB_DIR="/opt/dispatch-db"
SQLD_PORT=8080
SQLD_BIN="/usr/local/bin/sqld"

echo "=== sqld 설치 중 ==="

# 데이터 디렉토리 생성
sudo mkdir -p "$DB_DIR"
sudo chown "$USER:$USER" "$DB_DIR"

# sqld 바이너리 다운로드
SQLD_VERSION=$(curl -s https://api.github.com/repos/tursodatabase/libsql/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
echo "최신 버전: $SQLD_VERSION"

curl -L "https://github.com/tursodatabase/libsql/releases/download/${SQLD_VERSION}/sqld-x86_64-unknown-linux-gnu.tar.xz" \
  -o /tmp/sqld.tar.xz
tar -xf /tmp/sqld.tar.xz -C /tmp
sudo mv /tmp/sqld-x86_64-unknown-linux-gnu/sqld "$SQLD_BIN"
sudo chmod +x "$SQLD_BIN"
rm -rf /tmp/sqld.tar.xz /tmp/sqld-x86_64-unknown-linux-gnu

echo "sqld 설치 완료: $($SQLD_BIN --version)"

# systemd 서비스 등록
sudo tee /etc/systemd/system/sqld.service > /dev/null <<EOF
[Unit]
Description=sqld - libsql server (배차 시스템 DB)
After=network.target

[Service]
Type=simple
User=$USER
ExecStart=$SQLD_BIN --db-path $DB_DIR/dispatch.db --http-listen-addr 0.0.0.0:$SQLD_PORT
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable sqld
sudo systemctl start sqld

echo ""
echo "=== 완료 ==="
echo "sqld 상태: $(sudo systemctl is-active sqld)"
echo "DB 경로: $DB_DIR/dispatch.db"
echo "접속 URL: http://23.20.121.23:$SQLD_PORT"
echo ""
echo "AWS 보안그룹에서 TCP $SQLD_PORT 포트 인바운드 허용 필요"
