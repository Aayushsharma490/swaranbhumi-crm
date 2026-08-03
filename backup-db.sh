#!/bin/bash

# Configuration
BACKUP_DIR="/var/backups/postgres"
CONTAINER_NAME="crm-postgres"
DB_USER="postgres"
DB_NAME="swaranbhumi_crm"
RETENTION_DAYS=30

# Ensure the backup directory exists locally
mkdir -p "$BACKUP_DIR"

# Timestamp format (YYYYMMDD_HHMMSS)
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_backup_${TIMESTAMP}.sql"

echo "[$(date)] Starting Swaranbhumi CRM PostgreSQL database backup..."

# Execute pg_dump inside the docker container
if docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" "$DB_NAME" > "$BACKUP_FILE"; then
    echo "[$(date)] Backup file generated successfully: $BACKUP_FILE"
    
    # Compress the SQL dump file
    echo "[$(date)] Compressing backup file..."
    gzip "$BACKUP_FILE"
    
    echo "[$(date)] Backup compression complete: ${BACKUP_FILE}.gz"
else
    echo "[$(date)] ERROR: Database backup dump failed!"
    exit 1
fi

# Clean up older backups exceeding the retention threshold
echo "[$(date)] Executing retention audit cleanup..."
find "$BACKUP_DIR" -type f -name "${DB_NAME}_backup_*.sql.gz" -mtime +$RETENTION_DAYS -exec rm {} \;

echo "[$(date)] Database backup pipeline executed successfully."
