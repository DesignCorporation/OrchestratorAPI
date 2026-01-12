# VM setup (dev/prod)

Ниже — полный сценарий для одной VM (dev или prod). Повторить для обеих.

## 0) DNS
Создать A‑записи на IP нужной VM:
- dev VM: `dev.orch.designcorp.eu`, `operator.dev.orch.designcorp.eu`
- prod VM: `orch.designcorp.eu`, `operator.orch.designcorp.eu`

## 1) Установить Docker + Compose + Nginx + Certbot
```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo apt-get install -y nginx certbot python3-certbot-nginx
```

## 2) Клон/обновление репозитория
```bash
sudo mkdir -p /opt/orchestrator
sudo chown -R $USER:$USER /opt/orchestrator
cd /opt/orchestrator
# git clone ... (или git pull)
```

## 3) Env файлы
Скопировать пример и заполнить:
```bash
cp .env.prod.example .env.prod
```

Для dev можно использовать `.env.dev.example`.

## 4) Nginx конфиги
Скопировать конфиги:
```bash
sudo cp infra/nginx/orchestrator-control.conf /etc/nginx/sites-available/orchestrator-control.conf
sudo cp infra/nginx/operator-console.conf /etc/nginx/sites-available/operator-console.conf
sudo ln -sf /etc/nginx/sites-available/orchestrator-control.conf /etc/nginx/sites-enabled/orchestrator-control.conf
sudo ln -sf /etc/nginx/sites-available/operator-console.conf /etc/nginx/sites-enabled/operator-console.conf
sudo nginx -t
sudo systemctl reload nginx
```

## 5) Сертификаты (Let’s Encrypt)
Dev VM:
```bash
sudo certbot --nginx -d dev.orch.designcorp.eu -d operator.dev.orch.designcorp.eu
```

Prod VM:
```bash
sudo certbot --nginx -d orch.designcorp.eu -d operator.orch.designcorp.eu
```

## 6) Docker network для Nginx
```bash
docker network create public
```

## 7) Systemd unit
```bash
sudo cp infra/systemd/orchestrator-compose.service /etc/systemd/system/orchestrator-compose.service
sudo systemctl daemon-reload
sudo systemctl enable orchestrator-compose
sudo systemctl start orchestrator-compose
```

## 8) Миграции
```bash
docker compose -f infra/docker-compose/docker-compose.prod.yml --profile migrations run --rm orchestrator-migrate
```

## 9) Проверка
```bash
curl -f https://orch.designcorp.eu/health
curl -f https://operator.orch.designcorp.eu/health
```
