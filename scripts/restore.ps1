<#
.SYNOPSIS
  scripts/restore.ps1 - Database and MinIO document storage restore script (Windows / PowerShell)
.DESCRIPTION
  Restores a PostgreSQL database dump and MinIO document snapshot.
#>
[CmdletBinding()]
param (
  [Parameter(Mandatory = $true)]
  [string]$PgBackupPath,

  [Parameter(Mandatory = $false)]
  [string]$MinioBackupPath = ""
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $PgBackupPath)) {
  Write-Error "PostgreSQL backup file '$PgBackupPath' not found."
  exit 1
}

Write-Host "[$((Get-Date).ToString('s'))] Starting system restore from: $PgBackupPath" -ForegroundColor Cyan

# 1. Restore PostgreSQL Database
Write-Host "[$((Get-Date).ToString('s'))] Restoring PostgreSQL database..." -ForegroundColor Yellow
try {
  Get-Content $PgBackupPath -Raw | docker compose exec -T postgres psql -U credentialing_admin -d credentialing
  Write-Host "✓ PostgreSQL database restored successfully." -ForegroundColor Green
} catch {
  Write-Error "PostgreSQL restore failed: $_"
}

# 2. Restore MinIO Document Storage if provided
if ($MinioBackupPath -and (Test-Path $MinioBackupPath)) {
  Write-Host "[$((Get-Date).ToString('s'))] Restoring MinIO document storage from: $MinioBackupPath" -ForegroundColor Yellow
  try {
    docker compose cp "$MinioBackupPath/." "minio:/data/"
    Write-Host "✓ Document storage restored successfully." -ForegroundColor Green
  } catch {
    Write-Warning "MinIO restore notice: $_"
  }
}

Write-Host "[$((Get-Date).ToString('s'))] Restore process completed successfully." -ForegroundColor Green
