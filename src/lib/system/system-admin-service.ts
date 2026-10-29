import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { s3Client, S3_BUCKETS } from '@/lib/storage/s3';
import {
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { decrypt, encrypt } from '@/lib/encryption/aes';
import { verifyTotpToken } from '@/lib/auth/totp';
import { UserRole } from '@prisma/client';
import { decodeDatabaseJsonValue, encodeDatabaseJsonValue } from './database-serialization';

export interface SystemBackupManifest {
  formatVersion: '2.0';
  backupId: string;
  createdAt: string;
  appVersion: string;
  schemaVersion: string;
  scope: string;
  database: {
    fileName: string;
    jsonFileName: string;
    sizeBytes: number;
    sha256: string;
    tableCount: number;
    tables: Record<string, { rowCount: number; sha256: string }>;
  };
  documents: {
    count: number;
    sizeBytes: number;
    buckets: string[];
    files: Array<{
      bucket: string;
      key: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      documentId?: string;
      versionNumber?: number;
    }>;
  };
  system: {
    secretsExcluded: true;
    encryptionKeysPreservedSeparately: true;
    auditRecordsPreserved: boolean;
    exclusions: string[];
    warnings?: string[];
  };
}

export interface BackupArchiveSummary {
  id: string;
  createdAt: string;
  status: 'completed' | 'failed' | 'in_progress';
  totalSizeBytes: number;
  databaseSizeBytes: number;
  documentsCount: number;
  documentsSizeBytes: number;
  formatVersion: string;
  isVerified?: boolean;
}

export interface BackupValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  manifest?: SystemBackupManifest;
  stats?: {
    totalFiles: number;
    uncompressedSizeBytes: number;
    tablesFound: string[];
    documentsFound: number;
  };
}

export interface RestorePreviewResult {
  backupId: string;
  createdAt: string;
  appVersion: string;
  schemaVersion: string;
  isValid: boolean;
  errors: string[];
  warnings: string[];
  counts: {
    providers: number;
    organizations: number;
    affiliations: number;
    payerEnrollments: number;
    users: number;
    documents: number;
    auditLogs: number;
    tasks: number;
    notes: number;
    totalTables: number;
  };
  conflicts?: {
    existingProvidersByNpi: Array<{ npi: string; name: string }>;
    existingOrganizationsByNpi: Array<{ npi: string; name: string }>;
    existingUsersByEmail: Array<{ email: string; role: string }>;
  };
  supportedModes: Array<'full' | 'selective'>;
}

export interface RestoreExecutionResult {
  success: boolean;
  restoredAt: string;
  backupId: string;
  mode: 'full' | 'selective';
  recoveryPointId?: string;
  recordsRemoved?: Record<string, number>;
  recordsRestored: Record<string, number>;
  documentsRestored: number;
  documentsFailed: number;
  warnings: string[];
}

export interface ResetExecutionResult {
  success: boolean;
  resetAt: string;
  type: 'business_data' | 'fresh_install';
  backupId: string;
  recordsRemoved: Record<string, number>;
  documentsRemoved: number;
  warnings?: string[];
  adminProvisioned?: {
    email: string;
    role: string;
    mustChangePassword: boolean;
  };
}

// 29 Tables in dependency order (Parent -> Child for inserts)
export const ALL_DATABASE_TABLES = [
  'taxonomy_codes',
  'credential_expiration_rules',
  'system_settings',
  'locations',
  'payers',
  'organizations',
  'users',
  'user_sessions',
  'user_recovery_codes',
  'notification_preferences',
  'notifications',
  'providers',
  'caqh_profiles',
  'state_licenses',
  'dea_registrations',
  'board_certifications',
  'malpractice_insurance',
  'provider_locations',
  'provider_specialties',
  'provider_organizations',
  'payer_enrollments',
  'enrollment_status_history',
  'enrollment_follow_ups',
  'documents',
  'document_versions',
  'tasks',
  'notes',
  'verification_history',
  'audit_logs',
] as const;

// Security limits for uploaded ZIP archives
const MAX_ZIP_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB
const MAX_UNCOMPRESSED_BYTES = 1000 * 1024 * 1024; // 1 GB
const MAX_ZIP_ENTRY_COUNT = 20000;
const MAX_COMPRESSION_RATIO = 100;
const DISALLOWED_EXTENSIONS = [
  '.exe',
  '.bat',
  '.cmd',
  '.sh',
  '.ps1',
  '.vbs',
  '.dll',
  '.so',
  '.bin',
  '.jar',
  '.py',
  '.js',
  '.ts',
  '.php',
  '.msi',
  '.com',
];

let _cachedBackupsDir: string | null = null;
function getBackupsRoot(): string {
  if (_cachedBackupsDir) return _cachedBackupsDir;
  if (process.env.BACKUP_DIR) {
    _cachedBackupsDir = path.resolve(process.env.BACKUP_DIR);
    return _cachedBackupsDir;
  }
  const defaultDir = path.resolve(process.cwd(), 'backups');
  try {
    if (!fs.existsSync(defaultDir)) {
      fs.mkdirSync(defaultDir, { recursive: true });
    }
    fs.accessSync(defaultDir, fs.constants.W_OK);
    _cachedBackupsDir = defaultDir;
    return defaultDir;
  } catch {
    const tmpDir = path.resolve('/tmp', 'backups');
    if (!fs.existsSync(tmpDir)) {
      try {
        fs.mkdirSync(tmpDir, { recursive: true });
      } catch {
        // ignore
      }
    }
    _cachedBackupsDir = tmpDir;
    return tmpDir;
  }
}

function ensureBackupsDir(): string {
  const root = getBackupsRoot();
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  return root;
}

const BUSINESS_TABLES_TO_CLEAR = [
  'enrollment_follow_ups',
  'enrollment_status_history',
  'payer_enrollments',
  'state_licenses',
  'dea_registrations',
  'board_certifications',
  'malpractice_insurance',
  'caqh_profiles',
  'provider_specialties',
  'provider_locations',
  'provider_organizations',
  'verification_history',
  'tasks',
  'notes',
  'document_versions',
  'documents',
  'providers',
  'locations',
  'organizations',
  'payers',
  'notifications',
];

async function clearBusinessData(): Promise<{
  recordsRemoved: Record<string, number>;
  documentsRemoved: number;
  warnings: string[];
}> {
  const documentVersions = await prisma.documentVersion.findMany({
    select: { s3Bucket: true, s3Key: true },
  });
  const recordsRemoved: Record<string, number> = {};

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('UPDATE "documents" SET "current_version_id" = NULL');

    for (const table of BUSINESS_TABLES_TO_CLEAR) {
      const countResult = (await tx.$queryRawUnsafe(`SELECT COUNT(*) AS count FROM "${table}"`)) as Array<{
        count: bigint | number | string;
      }>;
      await tx.$executeRawUnsafe(`DELETE FROM "${table}"`);
      recordsRemoved[table] = Number(countResult[0]?.count || 0);
    }
  });

  let documentsRemoved = 0;
  const warnings: string[] = [];
  for (const version of documentVersions) {
    try {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: version.s3Bucket,
          Key: version.s3Key,
        })
      );
      documentsRemoved++;
    } catch {
      warnings.push(`Could not remove storage object ${version.s3Bucket}/${version.s3Key} during data replacement.`);
    }
  }

  return { recordsRemoved, documentsRemoved, warnings };
}

function computeBufferSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function computeFileSha256(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return computeBufferSha256(fileBuffer);
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export class SystemAdminService {
  /**
   * Verifies recent administrator authentication or MFA for sensitive operations.
   */
  static async verifyAdminSensitiveAuth(params: {
    userId: string;
    sudoPassword?: string;
    mfaCode?: string;
  }): Promise<{ verified: boolean; method: string }> {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: {
        id: true,
        passwordHash: true,
        mfaEnabled: true,
        totpSecretEncrypted: true,
        lastLoginAt: true,
      },
    });

    if (!user) {
      throw new Error('User not found.');
    }

    // 1. Password verification
    if (params.sudoPassword) {
      const match = await bcrypt.compare(params.sudoPassword, user.passwordHash);
      if (match) {
        return { verified: true, method: 'password' };
      }
    }

    // 2. MFA TOTP token verification
    if (params.mfaCode && user.mfaEnabled && user.totpSecretEncrypted) {
      try {
        const decryptedSecret = decrypt(user.totpSecretEncrypted, 'user.totp_secret');
        const isValidTotp = verifyTotpToken(decryptedSecret, params.mfaCode);
        if (isValidTotp) {
          return { verified: true, method: 'totp' };
        }
      } catch (err) {
        // TOTP verification error
      }
    }

    // 3. Fallback: Recent login grace period (last 5 minutes)
    if (
      user.lastLoginAt &&
      Date.now() - new Date(user.lastLoginAt).getTime() < 5 * 60 * 1000 &&
      !params.sudoPassword &&
      !params.mfaCode
    ) {
      return { verified: true, method: 'recent_session' };
    }

    throw new Error(
      'Recent authentication required for sensitive system action. Please enter your administrator password or MFA code.'
    );
  }

  /**
   * Creates a complete, production-grade ZIP archive export of all 29 database tables
   * and MinIO object storage documents, accompanied by a verified manifest.json.
   */
  static async createCompleteZipExport(): Promise<{
    manifest: SystemBackupManifest;
    zipBuffer: Buffer;
    zipPath: string;
    backupId: string;
  }> {
    ensureBackupsDir();
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const backupId = `backup_${timestamp}`;
    const zipFileName = `${backupId}.zip`;
    const zipPath = path.join(getBackupsRoot(), zipFileName);

    const zip = new AdmZip();

    const manifest: SystemBackupManifest = {
      formatVersion: '2.0',
      backupId,
      createdAt: new Date().toISOString(),
      appVersion: '1.0.0',
      schemaVersion: '20261023073000',
      scope: 'Complete PostgreSQL Database & MinIO Document Storage',
      database: {
        fileName: 'database.sql',
        jsonFileName: 'database.json',
        sizeBytes: 0,
        sha256: '',
        tableCount: ALL_DATABASE_TABLES.length,
        tables: {},
      },
      documents: {
        count: 0,
        sizeBytes: 0,
        buckets: [S3_BUCKETS.CREDENTIALS, S3_BUCKETS.ENROLLMENTS, S3_BUCKETS.GENERAL],
        files: [],
      },
      system: {
        secretsExcluded: true,
        encryptionKeysPreservedSeparately: true,
        auditRecordsPreserved: true,
        exclusions: [
          '.env',
          'master encryption keys (ENCRYPTION_KEY)',
          'session signing secrets (NEXTAUTH_SECRET)',
          'database root credentials',
          'redis cache and ephemeral sockets',
        ],
        warnings: [
          'Encrypted columns (TIN, SSN, CAQH password) can only be decrypted if the original ENCRYPTION_KEY is preserved separately.',
        ],
      },
    };

    // 1. Export all 29 database tables to structured JSON & SQL
    const databaseExport: Record<string, any[]> = {};
    let sqlDump = `-- Provider Credentialing & Payer Enrollment Management System\n`;
    sqlDump += `-- Complete Database Export: ${backupId}\n`;
    sqlDump += `-- Export Timestamp: ${manifest.createdAt}\n`;
    sqlDump += `BEGIN;\n\n`;

    for (const table of ALL_DATABASE_TABLES) {
      try {
        const rows: any[] = await prisma.$queryRawUnsafe(`SELECT * FROM "${table}"`);
        databaseExport[table] = rows;

        const tableJson = JSON.stringify(rows);
        const tableSha256 = computeBufferSha256(Buffer.from(tableJson, 'utf8'));
        manifest.database.tables[table] = {
          rowCount: rows.length,
          sha256: tableSha256,
        };

        sqlDump += `-- Table: ${table} (${rows.length} rows)\n`;
        if (rows.length > 0) {
          for (const row of rows) {
            const keys = Object.keys(row);
            const cols = keys.map((k) => `"${k}"`).join(', ');
            const vals = keys
              .map((k) => {
                const v = row[k];
                if (v === null || v === undefined) return 'NULL';
                if (v instanceof Date) return `'${v.toISOString()}'`;
                if (Buffer.isBuffer(v)) return `'\\x${v.toString('hex')}'`;
                if (Array.isArray(v)) {
                  const inner = v
                    .map((item) =>
                      typeof item === 'string'
                        ? `"${item.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
                        : item
                    )
                    .join(',');
                  return `'{${inner}}'`;
                }
                if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
                if (typeof v === 'boolean' || typeof v === 'number') return v;
                return `'${String(v).replace(/'/g, "''")}'`;
              })
              .join(', ');
            sqlDump += `INSERT INTO "${table}" (${cols}) VALUES (${vals}) ON CONFLICT DO NOTHING;\n`;
          }
        }
        sqlDump += '\n';
      } catch (tableErr) {
        databaseExport[table] = [];
        manifest.database.tables[table] = { rowCount: 0, sha256: '' };
      }
    }
    sqlDump += `COMMIT;\n`;

    const sqlBuffer = Buffer.from(sqlDump, 'utf8');
    const jsonBuffer = Buffer.from(JSON.stringify(encodeDatabaseJsonValue(databaseExport), null, 2), 'utf8');

    manifest.database.sizeBytes = sqlBuffer.length + jsonBuffer.length;
    manifest.database.sha256 = computeBufferSha256(sqlBuffer);

    zip.addFile('database.sql', sqlBuffer);
    zip.addFile('database.json', jsonBuffer);

    // 2. Export MinIO documents from all storage buckets
    const bucketsToExport = [S3_BUCKETS.CREDENTIALS, S3_BUCKETS.ENROLLMENTS, S3_BUCKETS.GENERAL];
    let totalDocBytes = 0;
    let totalDocCount = 0;

    for (const bucket of bucketsToExport) {
      try {
        const listRes = await s3Client.send(new ListObjectsV2Command({ Bucket: bucket }));
        const objects = listRes.Contents || [];

        for (const obj of objects) {
          if (!obj.Key || obj.Key.endsWith('/')) continue;

          try {
            const getRes = await s3Client.send(
              new GetObjectCommand({ Bucket: bucket, Key: obj.Key })
            );
            if (getRes.Body) {
              const docBuffer = await streamToBuffer(getRes.Body as Readable);
              const sha256 = computeBufferSha256(docBuffer);

              // Safe archive entry path: documents/<bucket>/<cleanKey>
              const entryPath = `documents/${bucket}/${obj.Key}`;
              zip.addFile(entryPath, docBuffer);

              manifest.documents.files.push({
                bucket,
                key: obj.Key,
                fileName: path.basename(obj.Key),
                mimeType: getRes.ContentType || 'application/octet-stream',
                sizeBytes: docBuffer.length,
                sha256,
              });

              totalDocCount++;
              totalDocBytes += docBuffer.length;
            }
          } catch (objErr) {
            console.warn(`Could not snapshot document ${bucket}/${obj.Key}:`, objErr);
          }
        }
      } catch {
        // Bucket might be uninitialized or empty
      }
    }

    manifest.documents.count = totalDocCount;
    manifest.documents.sizeBytes = totalDocBytes;

    // 3. Write manifest.json to ZIP
    const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
    zip.addFile('manifest.json', manifestBuffer);

    // 4. Generate ZIP archive buffer and write to disk
    const zipBuffer = zip.toBuffer();
    fs.writeFileSync(zipPath, zipBuffer);

    return {
      manifest,
      zipBuffer,
      zipPath,
      backupId,
    };
  }

  /**
   * Lists all existing ZIP archives and legacy backups in ./backups/.
   */
  static async listBackups(): Promise<BackupArchiveSummary[]> {
    ensureBackupsDir();
    const root = getBackupsRoot();
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const summaries: BackupArchiveSummary[] = [];

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.zip')) {
        const filePath = path.join(root, entry.name);
        const stats = fs.statSync(filePath);
        const backupId = entry.name.replace(/\.zip$/, '');

        // Try reading manifest from zip
        try {
          const zip = new AdmZip(filePath);
          const manifestEntry = zip.getEntry('manifest.json');
          if (manifestEntry) {
            const manifest: SystemBackupManifest = JSON.parse(
              manifestEntry.getData().toString('utf8')
            );
            summaries.push({
              id: manifest.backupId || backupId,
              createdAt: manifest.createdAt || stats.mtime.toISOString(),
              status: 'completed',
              totalSizeBytes: stats.size,
              databaseSizeBytes: manifest.database?.sizeBytes || 0,
              documentsCount: manifest.documents?.count || 0,
              documentsSizeBytes: manifest.documents?.sizeBytes || 0,
              formatVersion: manifest.formatVersion || '2.0',
              isVerified: true,
            });
            continue;
          }
        } catch {
          // Fallback to basic file info
        }

        summaries.push({
          id: backupId,
          createdAt: stats.mtime.toISOString(),
          status: 'completed',
          totalSizeBytes: stats.size,
          databaseSizeBytes: stats.size,
          documentsCount: 0,
          documentsSizeBytes: 0,
          formatVersion: '2.0',
        });
      } else if (entry.isDirectory()) {
        const manifestPath = path.join(root, entry.name, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            summaries.push({
              id: manifest.id || entry.name,
              createdAt: manifest.createdAt,
              status: manifest.status || 'completed',
              totalSizeBytes:
                (manifest.database?.sizeBytes || 0) + (manifest.documents?.sizeBytes || 0),
              databaseSizeBytes: manifest.database?.sizeBytes || 0,
              documentsCount: manifest.documents?.count || 0,
              documentsSizeBytes: manifest.documents?.sizeBytes || 0,
              formatVersion: '1.0',
            });
          } catch {
            // ignore
          }
        }
      }
    }

    summaries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return summaries;
  }

  /**
   * Retrieves backup ZIP archive buffer by backupId.
   */
  static async getBackupZipBuffer(backupId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const root = getBackupsRoot();
    const zipPath = path.join(root, `${backupId}.zip`);

    if (fs.existsSync(zipPath)) {
      return {
        buffer: fs.readFileSync(zipPath),
        fileName: `${backupId}.zip`,
      };
    }

    // If backup exists as directory, create a zip from it
    const dirPath = path.join(root, backupId);
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      const zip = new AdmZip();
      zip.addLocalFolder(dirPath);
      const buffer = zip.toBuffer();
      return {
        buffer,
        fileName: `${backupId}.zip`,
      };
    }

    throw new Error(`Backup archive '${backupId}' not found.`);
  }

  /**
   * Strictly validates a backup ZIP archive against security threats:
   * - Maximum upload and uncompressed size limits (Decompression bomb protection)
   * - Path traversal (Zip Slip protection)
   * - Executable file rejection
   * - Checksum verification
   * - Manifest validity & schema compatibility
   */
  static async validateZipArchive(zipBuffer: Buffer): Promise<BackupValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Enforce upload size limit
    if (zipBuffer.length > MAX_ZIP_UPLOAD_BYTES) {
      return {
        isValid: false,
        errors: [`Upload size exceeds the maximum allowed limit of 500 MB (received ${(zipBuffer.length / (1024 * 1024)).toFixed(1)} MB).`],
        warnings,
      };
    }

    let zip: AdmZip;
    let entries: any[] = [];
    try {
      zip = new AdmZip(zipBuffer);
      entries = zip.getEntries();
    } catch (zipErr: any) {
      const msg = zipErr?.message || '';
      if (msg.toLowerCase().includes('duplicate entry')) {
        return {
          isValid: false,
          errors: [`Duplicate entry detected in archive: ${msg}`],
          warnings,
        };
      }
      return {
        isValid: false,
        errors: [`Corrupted or invalid ZIP archive. Could not parse archive structure: ${msg}`],
        warnings,
      };
    }

    // 2. Enforce entry count limit
    if (entries.length > MAX_ZIP_ENTRY_COUNT) {
      return {
        isValid: false,
        errors: [`Archive contains too many entries (${entries.length} files). Limit is ${MAX_ZIP_ENTRY_COUNT}.`],
        warnings,
      };
    }

    let totalUncompressed = 0;
    const seenPaths = new Set<string>();

    for (const entry of entries) {
      const name = entry.entryName;
      const rawName = entry.rawEntryName ? entry.rawEntryName.toString('utf8') : name;

      // 3. Path Traversal Protection (Zip Slip)
      if (
        name.includes('..') ||
        rawName.includes('..') ||
        name.startsWith('/') ||
        name.startsWith('\\') ||
        rawName.startsWith('/') ||
        rawName.startsWith('\\') ||
        /^[a-zA-Z]:/.test(name) ||
        /^[a-zA-Z]:/.test(rawName)
      ) {
        errors.push(`Malicious entry detected: Path traversal sequence in '${rawName || name}'.`);
        continue;
      }

      // 4. Duplicate Entry Protection
      const normalizedPath = path.normalize(name).replace(/\\/g, '/');
      if (seenPaths.has(normalizedPath)) {
        errors.push(`Duplicate entry detected in archive: '${name}'.`);
        continue;
      }
      seenPaths.add(normalizedPath);

      // 5. Executable Protection
      const ext = path.extname(name).toLowerCase();
      if (DISALLOWED_EXTENSIONS.includes(ext)) {
        errors.push(`Forbidden executable or script file detected: '${name}'.`);
        continue;
      }

      // 6. Decompression Bomb Check (Compression Ratio & Total Uncompressed)
      totalUncompressed += entry.header.size;
      if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
        errors.push(`Decompression bomb protection triggered: Total uncompressed size exceeds 1 GB.`);
        break;
      }

      if (entry.header.compressedSize > 1024) {
        const ratio = entry.header.size / entry.header.compressedSize;
        if (ratio > MAX_COMPRESSION_RATIO) {
          errors.push(`Decompression bomb protection triggered: Entry '${name}' has excessive compression ratio (${ratio.toFixed(1)}:1).`);
          break;
        }
      }
    }

    if (errors.length > 0) {
      return { isValid: false, errors, warnings };
    }

    // 7. Verify Manifest
    const manifestEntry = zip.getEntry('manifest.json');
    if (!manifestEntry) {
      return {
        isValid: false,
        errors: ['Archive is missing required manifest.json.'],
        warnings,
      };
    }

    let manifest: SystemBackupManifest;
    try {
      manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
    } catch {
      return {
        isValid: false,
        errors: ['Archive manifest.json is corrupted or not valid JSON.'],
        warnings,
      };
    }

    // 8. Verify Database Dump / JSON presence
    const dbSqlEntry = zip.getEntry('database.sql');
    const dbJsonEntry = zip.getEntry('database.json');
    if (!dbSqlEntry && !dbJsonEntry) {
      errors.push('Archive is missing database.sql and database.json.');
    } else if (dbSqlEntry) {
      const sqlBuffer = dbSqlEntry.getData();
      const sqlSha = computeBufferSha256(sqlBuffer);
      if (manifest.database?.sha256 && sqlSha !== manifest.database.sha256) {
        errors.push('Database dump checksum mismatch between database.sql and manifest.json.');
      }
    }

    // 9. Verify Document Entries & Checksums
    let verifiedDocs = 0;
    if (manifest.documents && Array.isArray(manifest.documents.files)) {
      for (const file of manifest.documents.files) {
        const expectedEntryPath = `documents/${file.bucket}/${file.key}`;
        const docEntry = zip.getEntry(expectedEntryPath);
        if (!docEntry) {
          errors.push(`Expected document missing from archive: '${expectedEntryPath}'.`);
        } else {
          const docData = docEntry.getData();
          const docSha = computeBufferSha256(docData);
          if (file.sha256 && docSha !== file.sha256) {
            errors.push(`Document '${expectedEntryPath}' checksum mismatch.`);
          } else {
            verifiedDocs++;
          }
        }
      }
    }

    const isValid = errors.length === 0;
    return {
      isValid,
      errors,
      warnings,
      manifest,
      stats: {
        totalFiles: entries.length,
        uncompressedSizeBytes: totalUncompressed,
        tablesFound: Object.keys(manifest.database?.tables || {}),
        documentsFound: verifiedDocs,
      },
    };
  }

  /**
   * Generates an interactive preview summary for an uploaded backup ZIP archive.
   */
  static async previewZipBackup(zipBuffer: Buffer): Promise<RestorePreviewResult> {
    const validation = await this.validateZipArchive(zipBuffer);
    if (!validation.isValid || !validation.manifest) {
      return {
        backupId: 'unknown',
        createdAt: new Date().toISOString(),
        appVersion: 'unknown',
        schemaVersion: 'unknown',
        isValid: false,
        errors: validation.errors,
        warnings: validation.warnings,
        counts: {
          providers: 0,
          organizations: 0,
          affiliations: 0,
          payerEnrollments: 0,
          users: 0,
          documents: 0,
          auditLogs: 0,
          tasks: 0,
          notes: 0,
          totalTables: 0,
        },
        supportedModes: [],
      };
    }

    const manifest = validation.manifest;
    const zip = new AdmZip(zipBuffer);
    const dbJsonEntry = zip.getEntry('database.json');

    let dbData: Record<string, any[]> = {};
    if (dbJsonEntry) {
      try {
        dbData = JSON.parse(dbJsonEntry.getData().toString('utf8'));
      } catch {
        // ignore
      }
    }

    const counts = {
      providers: dbData['providers']?.length ?? manifest.database.tables['providers']?.rowCount ?? 0,
      organizations: dbData['organizations']?.length ?? manifest.database.tables['organizations']?.rowCount ?? 0,
      affiliations: dbData['provider_organizations']?.length ?? manifest.database.tables['provider_organizations']?.rowCount ?? 0,
      payerEnrollments: dbData['payer_enrollments']?.length ?? manifest.database.tables['payer_enrollments']?.rowCount ?? 0,
      users: dbData['users']?.length ?? manifest.database.tables['users']?.rowCount ?? 0,
      documents: manifest.documents?.count ?? 0,
      auditLogs: dbData['audit_logs']?.length ?? manifest.database.tables['audit_logs']?.rowCount ?? 0,
      tasks: dbData['tasks']?.length ?? manifest.database.tables['tasks']?.rowCount ?? 0,
      notes: dbData['notes']?.length ?? manifest.database.tables['notes']?.rowCount ?? 0,
      totalTables: Object.keys(manifest.database.tables || {}).length,
    };

    // Detect conflicts with active database
    const conflicts = {
      existingProvidersByNpi: [] as Array<{ npi: string; name: string }>,
      existingOrganizationsByNpi: [] as Array<{ npi: string; name: string }>,
      existingUsersByEmail: [] as Array<{ email: string; role: string }>,
    };

    if (Array.isArray(dbData['providers'])) {
      const incomingNpis = dbData['providers'].map((p) => p.npiNumber).filter(Boolean);
      if (incomingNpis.length > 0) {
        const existingProviders = await prisma.provider.findMany({
          where: { npiNumber: { in: incomingNpis } },
          select: { npiNumber: true, firstName: true, lastName: true },
        });
        conflicts.existingProvidersByNpi = existingProviders.map((p) => ({
          npi: p.npiNumber || '',
          name: `${p.firstName} ${p.lastName}`,
        }));
      }
    }

    if (Array.isArray(dbData['organizations'])) {
      const incomingOrgNpis = dbData['organizations'].map((o) => o.npiNumber).filter(Boolean);
      if (incomingOrgNpis.length > 0) {
        const existingOrgs = await prisma.organization.findMany({
          where: { npiNumber: { in: incomingOrgNpis } },
          select: { npiNumber: true, name: true },
        });
        conflicts.existingOrganizationsByNpi = existingOrgs.map((o) => ({
          npi: o.npiNumber || '',
          name: o.name,
        }));
      }
    }

    if (Array.isArray(dbData['users'])) {
      const incomingEmails = dbData['users'].map((u) => u.email).filter(Boolean);
      if (incomingEmails.length > 0) {
        const existingUsers = await prisma.user.findMany({
          where: { email: { in: incomingEmails } },
          select: { email: true, role: true },
        });
        conflicts.existingUsersByEmail = existingUsers.map((u) => ({
          email: u.email,
          role: u.role,
        }));
      }
    }

    return {
      backupId: manifest.backupId,
      createdAt: manifest.createdAt,
      appVersion: manifest.appVersion,
      schemaVersion: manifest.schemaVersion,
      isValid: true,
      errors: [],
      warnings: validation.warnings,
      counts,
      conflicts,
      supportedModes: ['full', 'selective'],
    };
  }

  /**
   * Executes a Full System Restore:
   * 1. Creates an automatic pre-restore safety recovery point backup.
   * 2. Restores all database tables from archive.
   * 3. Restores MinIO document objects into their respective buckets.
   * 4. Verifies restoration health and record counts.
   */
  static async executeFullRestore(
    zipBuffer: Buffer,
    options: {
      confirmPhrase: string;
      createRecoveryPoint?: boolean;
      adminUser: { id: string; email: string };
    }
  ): Promise<RestoreExecutionResult> {
    if (
      options.confirmPhrase !== 'RESTORE FULL SYSTEM' &&
      options.confirmPhrase !== 'RESTORE_CONFIRM'
    ) {
      throw new Error(
        'Explicit confirmation phrase "RESTORE FULL SYSTEM" or "RESTORE_CONFIRM" is required to execute a full system restore.'
      );
    }

    const validation = await this.validateZipArchive(zipBuffer);
    if (!validation.isValid || !validation.manifest) {
      throw new Error(
        `Cannot restore invalid backup. Validation errors: ${validation.errors.join('; ')}`
      );
    }

    const zip = new AdmZip(zipBuffer);
    const dbJsonEntry = zip.getEntry('database.json');
    let dbData: Record<string, any[]> | null = null;
    if (dbJsonEntry) {
      try {
        dbData = decodeDatabaseJsonValue(
          JSON.parse(dbJsonEntry.getData().toString('utf8'))
        ) as Record<string, any[]>;
      } catch {
        throw new Error('Cannot restore archive: database.json is malformed. No destination data was changed.');
      }
    }

    // 1. Automatic Pre-Restore Safety Recovery Point
    let recoveryPointId: string | undefined;
    if (options.createRecoveryPoint !== false) {
      const recoveryExport = await this.createCompleteZipExport();
      const recoveryValidation = await this.validateZipArchive(recoveryExport.zipBuffer);
      if (!recoveryValidation.isValid) {
        throw new Error(
          `Pre-restore recovery point failed integrity verification: ${recoveryValidation.errors.join('; ')}. Restore aborted before replacing business data.`
        );
      }
      recoveryPointId = recoveryExport.backupId;
    }

    const recordsRestored: Record<string, number> = {};
    const warnings: string[] = [];
    const clearedData = await clearBusinessData();
    warnings.push(...clearedData.warnings);

    let restoreFailed = clearedData.warnings.length > 0;

    // 2. Restore PostgreSQL Database Data
    if (dbJsonEntry) {
      const restoredData = dbData!;
      const currentVersionIds = new Map<string, string>();

      // Use foreign-key dependency order for insertion
      for (const table of ALL_DATABASE_TABLES) {
        const rows = restoredData[table] || [];
        recordsRestored[table] = 0;
        let conflictRows = 0;
        let failedRows = 0;

        if (rows.length === 0) continue;

        if (table === 'user_sessions') {
          warnings.push('Saved login sessions were intentionally excluded; all users must sign in again after restore.');
          continue;
        }

        for (const row of rows) {
          try {
            const insertRow = { ...row };
            if (table === 'documents' && insertRow.current_version_id) {
              currentVersionIds.set(insertRow.id, insertRow.current_version_id);
              insertRow.current_version_id = null;
            }
            const keys = Object.keys(insertRow);
            const cols = keys.map((k) => `"${k}"`).join(', ');
            const vals = keys
              .map((k) => {
                const v = insertRow[k];
                if (v === null || v === undefined) return 'NULL';
                if (v instanceof Date) return `'${v.toISOString()}'`;
                if (Buffer.isBuffer(v)) return `'\\x${v.toString('hex')}'`;
                if (Array.isArray(v)) {
                  const inner = v
                    .map((item) =>
                      typeof item === 'string'
                        ? `"${item.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
                        : item
                    )
                    .join(',');
                  return `'{${inner}}'`;
                }
                if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
                if (typeof v === 'boolean' || typeof v === 'number') return v;
                return `'${String(v).replace(/'/g, "''")}'`;
              })
              .join(', ');

            const insertedCount = await prisma.$executeRawUnsafe(
              `INSERT INTO "${table}" (${cols}) VALUES (${vals}) ON CONFLICT DO NOTHING`
            );
            recordsRestored[table] += insertedCount;
            if (insertedCount === 0) conflictRows++;
          } catch {
            failedRows++;
          }
        }

        if (conflictRows > 0) {
          warnings.push(`${conflictRows} existing ${table} rows were preserved because their keys already exist on the destination.`);
        }
        if (failedRows > 0) {
          warnings.push(`${failedRows} of ${rows.length} ${table} rows could not be restored because of invalid data or references.`);
          restoreFailed = true;
        }
      }

      const currentVersionEntries = Array.from(currentVersionIds.entries());
      for (let index = 0; index < currentVersionEntries.length; index++) {
        const [documentId, versionId] = currentVersionEntries[index];
        try {
          const updated = await prisma.$executeRawUnsafe(
            'UPDATE "documents" SET "current_version_id" = $1 WHERE "id" = $2',
            versionId,
            documentId
          );
          if (updated === 0) {
            restoreFailed = true;
            warnings.push(`Could not restore the current document version for document ${documentId}.`);
          }
        } catch {
          restoreFailed = true;
          warnings.push(`Could not restore the current document version for document ${documentId}.`);
        }
      }
    } else {
      // Fallback: Execute database.sql
      const dbSqlEntry = zip.getEntry('database.sql');
      if (dbSqlEntry) {
        const sqlContent = dbSqlEntry.getData().toString('utf8');
        const statements = sqlContent
          .split(';\n')
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !s.startsWith('--'));

        for (const statement of statements) {
          try {
            await prisma.$executeRawUnsafe(statement);
          } catch {
            // ignore non-fatal statement errors
            restoreFailed = true;
          }
        }
      }
    }

    // 3. Restore MinIO Storage Documents
    let documentsRestored = 0;
    let documentsFailed = 0;

    for (const file of validation.manifest.documents.files) {
      const entryPath = `documents/${file.bucket}/${file.key}`;
      const docEntry = zip.getEntry(entryPath);
      if (docEntry) {
        try {
          const bodyBuffer = docEntry.getData();
          await s3Client.send(
            new PutObjectCommand({
              Bucket: file.bucket,
              Key: file.key,
              Body: bodyBuffer,
              ContentType: file.mimeType || 'application/octet-stream',
              ContentLength: bodyBuffer.length,
            })
          );
          documentsRestored++;
        } catch (s3Err) {
          documentsFailed++;
          warnings.push(`Failed to restore MinIO object ${file.bucket}/${file.key}`);
        }
      } else {
        documentsFailed++;
      }
    }

    if (documentsFailed > 0) restoreFailed = true;

    return {
      success: !restoreFailed,
      restoredAt: new Date().toISOString(),
      backupId: validation.manifest.backupId,
      mode: 'full',
      recoveryPointId,
      recordsRemoved: clearedData.recordsRemoved,
      recordsRestored,
      documentsRestored,
      documentsFailed,
      warnings,
    };
  }

  /**
   * Executes a Selective Import of specific entity types (providers, organizations, enrollments, documents).
   */
  static async executeSelectiveImport(
    zipBuffer: Buffer,
    options: {
      entityTypes: string[];
      conflictResolution: 'skip_existing' | 'overwrite_existing';
      adminUser: { id: string; email: string };
    }
  ): Promise<RestoreExecutionResult> {
    const validation = await this.validateZipArchive(zipBuffer);
    if (!validation.isValid || !validation.manifest) {
      throw new Error(
        `Cannot import invalid backup. Validation errors: ${validation.errors.join('; ')}`
      );
    }

    const zip = new AdmZip(zipBuffer);
    const dbJsonEntry = zip.getEntry('database.json');
    if (!dbJsonEntry) {
      throw new Error('Selective import requires structured database.json in the archive.');
    }

    const dbData: Record<string, any[]> = JSON.parse(dbJsonEntry.getData().toString('utf8'));
    const recordsRestored: Record<string, number> = {};
    const warnings: string[] = [];
    const selected = new Set(options.entityTypes);

    // Map entity types to tables
    const entityTableMap: Record<string, string[]> = {
      providers: [
        'providers',
        'locations',
        'provider_locations',
        'provider_specialties',
        'caqh_profiles',
        'state_licenses',
        'dea_registrations',
        'board_certifications',
        'malpractice_insurance',
      ],
      organizations: ['organizations', 'provider_organizations'],
      enrollments: ['payers', 'payer_enrollments', 'enrollment_status_history', 'enrollment_follow_ups'],
      documents: ['documents', 'document_versions'],
      tasks_notes: ['tasks', 'notes', 'verification_history'],
    };

    const tablesToImport: string[] = [];
    for (const [entityType, tables] of Object.entries(entityTableMap)) {
      if (selected.has(entityType)) {
        tablesToImport.push(...tables);
      }
    }

    // Always include reference data if missing
    if (!tablesToImport.includes('taxonomy_codes')) tablesToImport.unshift('taxonomy_codes');

    for (const table of ALL_DATABASE_TABLES) {
      if (!tablesToImport.includes(table)) continue;

      const rows = dbData[table] || [];
      recordsRestored[table] = 0;

      for (const row of rows) {
        try {
          const keys = Object.keys(row);
          const cols = keys.map((k) => `"${k}"`).join(', ');
          const vals = keys
            .map((k) => {
              const v = row[k];
              if (v === null || v === undefined) return 'NULL';
              if (v instanceof Date) return `'${v.toISOString()}'`;
              if (Buffer.isBuffer(v)) return `'\\x${v.toString('hex')}'`;
              if (Array.isArray(v)) {
                const inner = v
                  .map((item) =>
                    typeof item === 'string'
                      ? `"${item.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
                      : item
                  )
                  .join(',');
                return `'{${inner}}'`;
              }
              if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
              if (typeof v === 'boolean' || typeof v === 'number') return v;
              return `'${String(v).replace(/'/g, "''")}'`;
            })
            .join(', ');

          if (options.conflictResolution === 'overwrite_existing') {
            const updates = keys
              .filter((k) => k !== 'id')
              .map((k) => `"${k}" = EXCLUDED."${k}"`)
              .join(', ');
            await prisma.$executeRawUnsafe(
              `INSERT INTO "${table}" (${cols}) VALUES (${vals}) ON CONFLICT ("id") DO UPDATE SET ${updates}`
            );
          } else {
            await prisma.$executeRawUnsafe(
              `INSERT INTO "${table}" (${cols}) VALUES (${vals}) ON CONFLICT DO NOTHING`
            );
          }
          recordsRestored[table]++;
        } catch {
          // ignore conflict
        }
      }
    }

    // Restore documents if document entity selected
    let documentsRestored = 0;
    let documentsFailed = 0;

    if (selected.has('documents')) {
      for (const file of validation.manifest.documents.files) {
        const entryPath = `documents/${file.bucket}/${file.key}`;
        const docEntry = zip.getEntry(entryPath);
        if (docEntry) {
          try {
            const bodyBuffer = docEntry.getData();
            await s3Client.send(
              new PutObjectCommand({
                Bucket: file.bucket,
                Key: file.key,
                Body: bodyBuffer,
                ContentType: file.mimeType || 'application/octet-stream',
                ContentLength: bodyBuffer.length,
              })
            );
            documentsRestored++;
          } catch {
            documentsFailed++;
          }
        }
      }
    }

    return {
      success: true,
      restoredAt: new Date().toISOString(),
      backupId: validation.manifest.backupId,
      mode: 'selective',
      recordsRestored,
      documentsRestored,
      documentsFailed,
      warnings,
    };
  }

  /**
   * Executes Option A: Reset Business Data.
   * - Requires verified fresh backup before proceeding.
   * - Deletes business entities in dependency-safe order.
   * - Cleans up S3 storage documents for deleted records.
   * - Preserves user accounts, user sessions, system settings, reference taxonomy data,
   *   and the immutable audit trail.
   */
  static async executeResetBusinessData(options: {
    confirmPhrase: string;
    adminUser: { id: string; email: string };
    adminPassword?: string;
    mfaCode?: string;
  }): Promise<ResetExecutionResult> {
    if (options.confirmPhrase !== 'RESET BUSINESS DATA') {
      throw new Error(
        'Explicit confirmation phrase "RESET BUSINESS DATA" is required to execute a business data reset.'
      );
    }

    // 1. Sensitive operation re-authentication check
    await this.verifyAdminSensitiveAuth({
      userId: options.adminUser.id,
      sudoPassword: options.adminPassword,
      mfaCode: options.mfaCode,
    });

    // 2. MANDATORY SAFETY GUARD: Fresh verified backup must succeed first!
    const backupExport = await this.createCompleteZipExport();
    const validation = await this.validateZipArchive(backupExport.zipBuffer);
    if (!validation.isValid) {
      throw new Error(
        `Pre-reset safety backup failed integrity verification: ${validation.errors.join('; ')}. Application reset aborted to prevent data loss.`
      );
    }

    const { recordsRemoved, documentsRemoved, warnings } = await clearBusinessData();

    return {
      success: true,
      resetAt: new Date().toISOString(),
      type: 'business_data',
      backupId: backupExport.backupId,
      recordsRemoved,
      documentsRemoved,
      warnings,
    };
  }

  /**
   * Executes Option B: Reset to Fresh Installation.
   * - Requires verified fresh backup before proceeding.
   * - Deletes all business records and stored documents.
   * - Deletes non-super_admin accounts and user sessions.
   * - Recreates or retains an initial administrator account with forced password change.
   * - Preserves standard CMS taxonomy codes, default alert rules, and immutable audit logs.
   * - Does NOT drop Docker volumes or infrastructure.
   */
  static async executeResetFreshInstall(options: {
    confirmPhrase: string;
    adminUser: { id: string; email: string };
    adminPassword?: string;
    mfaCode?: string;
  }): Promise<ResetExecutionResult> {
    if (options.confirmPhrase !== 'RESET FRESH INSTALL') {
      throw new Error(
        'Explicit confirmation phrase "RESET FRESH INSTALL" is required to reset to a fresh installation.'
      );
    }

    const initialPassword =
      process.env.INITIAL_ADMIN_PASSWORD ||
      process.env.TESTING_BOOTSTRAP_PASSWORD ||
      (process.env.NODE_ENV === 'test' ? 'test-only-initial-password' : '');
    if (initialPassword.length < 12) {
      throw new Error('INITIAL_ADMIN_PASSWORD must be configured with at least 12 characters before a fresh-install reset.');
    }

    // 1. Sensitive operation re-authentication check
    await this.verifyAdminSensitiveAuth({
      userId: options.adminUser.id,
      sudoPassword: options.adminPassword,
      mfaCode: options.mfaCode,
    });

    // 2. MANDATORY SAFETY GUARD: Fresh verified backup must succeed first!
    const backupExport = await this.createCompleteZipExport();
    const validation = await this.validateZipArchive(backupExport.zipBuffer);
    if (!validation.isValid) {
      throw new Error(
        `Pre-reset safety backup failed integrity verification: ${validation.errors.join('; ')}. Application reset aborted to prevent data loss.`
      );
    }

    // 3. Reset Business Data first
    const businessReset = await this.executeResetBusinessData({
      confirmPhrase: 'RESET BUSINESS DATA',
      adminUser: options.adminUser,
      adminPassword: options.adminPassword,
      mfaCode: options.mfaCode,
    });

    const recordsRemoved = { ...businessReset.recordsRemoved };

    // 4. Remove all sessions and recovery codes
    const sessionsCount = await prisma.userSession.count();
    const recoveryCount = await prisma.userRecoveryCode.count();
    await prisma.$executeRawUnsafe(`DELETE FROM "user_sessions"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "user_recovery_codes"`);
    recordsRemoved['user_sessions'] = sessionsCount;
    recordsRemoved['user_recovery_codes'] = recoveryCount;

    // 5. In Fresh Install: Delete users without audit logs and deactivate any with audit history
    const passwordHash = await bcrypt.hash(initialPassword, 12);

    // Provision or retain initial testing administrator
    const adminUser = await prisma.user.upsert({
      where: { email: 'admin' },
      update: {
        passwordHash,
        mustChangePassword: true,
        isActive: true,
        mfaEnabled: false,
        role: UserRole.super_admin,
      },
      create: {
        email: 'admin',
        passwordHash,
        firstName: 'Testing',
        lastName: 'Administrator',
        role: UserRole.super_admin,
        isActive: true,
        mustChangePassword: true,
        mfaEnabled: false,
      },
    });

    // Find users with audit log history (to avoid FK violation against immutable audit_logs)
    const usersWithAudit = await prisma.auditLog.findMany({
      where: { userId: { not: null } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const userIdsWithAudit = usersWithAudit.map((a) => a.userId).filter(Boolean) as string[];

    // Delete users without audit history
    const deletedUsers = await prisma.user.deleteMany({
      where: {
        id: { notIn: userIdsWithAudit },
        email: { notIn: ['admin', options.adminUser.email] },
      },
    });

    // Deactivate any historical users that have immutable audit log references
    await prisma.user.updateMany({
      where: {
        id: { in: userIdsWithAudit },
        email: { notIn: ['admin', options.adminUser.email] },
      },
      data: {
        isActive: false,
        mustChangePassword: true,
      },
    });

    recordsRemoved['users'] = deletedUsers.count;

    // 6. Initialize System Settings
    await prisma.systemSetting.upsert({
      where: { key: 'is_fresh_install' },
      update: { value: 'true' },
      create: { key: 'is_fresh_install', value: 'true' },
    });
    await prisma.systemSetting.upsert({
      where: { key: 'mfa_policy' },
      update: { value: 'optional' },
      create: { key: 'mfa_policy', value: 'optional' },
    });
    await prisma.systemSetting.upsert({
      where: { key: 'bootstrap_completed' },
      update: { value: 'true' },
      create: { key: 'bootstrap_completed', value: 'true' },
    });

    // 7. Ensure Standard CMS Taxonomy Codes exist
    const taxonomyData = [
      {
        code: '207Q00000X',
        classification: 'Allopathic & Osteopathic Physicians',
        specialization: 'Family Medicine',
        definition: 'A physician who provides comprehensive personal care in an ambulatory setting.',
      },
      {
        code: '207R00000X',
        classification: 'Allopathic & Osteopathic Physicians',
        specialization: 'Internal Medicine',
        definition: 'A personal physician who provides long-term, comprehensive care in the office and the hospital.',
      },
      {
        code: '207RC0000X',
        classification: 'Allopathic & Osteopathic Physicians',
        specialization: 'Cardiovascular Disease',
        definition: 'An internist who specializes in diseases of the heart and blood vessels.',
      },
      {
        code: '363L00000X',
        classification: 'Physician Assistants & Advanced Practice Nursing',
        specialization: 'Nurse Practitioner',
        definition: 'A registered nurse who has completed advanced education and clinical training.',
      },
    ];

    for (const item of taxonomyData) {
      await prisma.taxonomyCode.upsert({
        where: { code: item.code },
        update: {},
        create: item,
      });
    }

    return {
      success: true,
      resetAt: new Date().toISOString(),
      type: 'fresh_install',
      backupId: backupExport.backupId,
      recordsRemoved,
      documentsRemoved: businessReset.documentsRemoved,
      adminProvisioned: {
        email: adminUser.email,
        role: adminUser.role,
        mustChangePassword: adminUser.mustChangePassword,
      },
    };
  }
}
