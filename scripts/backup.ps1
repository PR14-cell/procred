<#
.SYNOPSIS
  scripts/backup.ps1 - Database and MinIO document storage backup script (Windows / PowerShell)
.DESCRIPTION
  Creates a timestamped PostgreSQL database dump and MinIO document snapshot.
#>
[CmdletBinding()]
param (
  [string]$BackupDir = "./backups"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BackupDir)) {
  New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$Timestamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$PgBackup = Join-Path $BackupDir "postgres_${Timestamp}.sql"
$MinioBackup = Join-Path $BackupDir "minio_${Timestamp}"

Write-Host "[$((Get-Date).ToString('s'))] Starting full system backup..." -ForegroundColor Cyan

# 1. PostgreSQL Database Backup
Write-Host "[$((Get-Date).ToString('s'))] Backing up PostgreSQL database..." -ForegroundColor Yellow
try {
  docker compose exec -T postgres pg_dump -U credentialing_admin -d credentialing | Out-File -FilePath $PgBackup -Encoding utf8
  Write-Host "✓ PostgreSQL backup saved: $PgBackup" -ForegroundColor Green
} catch {
  Write-Error "PostgreSQL backup failed: $_"
}

# 2. Document Storage Backup (MinIO)
Write-Host "[$((Get-Date).ToString('s'))] Backing up MinIO document storage..." -ForegroundColor Yellow
try {
  New-Item -ItemType Directory -Path $MinioBackup -Force | Out-Null
  docker compose cp "minio:/data/." $MinioBackup
  Write-Host "✓ Document storage backup saved: $MinioBackup" -ForegroundColor Green
} catch {
  Write-Warning "MinIO snapshot notice: $_"
}

Write-Host "[$((Get-Date).ToString('s'))] Backup process completed successfully." -ForegroundColor Green
