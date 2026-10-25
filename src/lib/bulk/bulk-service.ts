import { prisma } from '@/lib/db/prisma';
import { encrypt } from '@/lib/encryption/aes';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { npiRegex, ssnRegex } from '@/lib/validation/provider';

export interface CsvProviderRow {
  firstName?: string;
  lastName?: string;
  middleName?: string;
  suffix?: string;
  npiNumber?: string;
  npiType?: number | string;
  ssn?: string;
  dateOfBirth?: string;
  gender?: string;
  email?: string;
  phone?: string;
  primaryTaxonomy?: string;
  taxonomyDescription?: string;
  caqhId?: string;
  status?: string;
  groupName?: string;
  groupNpi?: string;
  groupTaxId?: string;
}

export interface RowValidationError {
  rowNumber: number;
  field: string;
  message: string;
  value?: any;
}

export interface BulkImportPreviewResult {
  totalRows: number;
  validCount: number;
  invalidCount: number;
  errors: RowValidationError[];
  previewRows: Array<CsvProviderRow & { rowNumber: number; isValid: boolean; errorCount: number }>;
}

export interface BulkImportCommitResult {
  success: boolean;
  importedCount: number;
  failedCount: number;
  errors: RowValidationError[];
  importedIds: string[];
}

export interface BulkEnrollmentInput {
  providerIds: string[];
  payerIds: string[];
  enrollmentType?: 'individual' | 'group';
  status?: string;
  groupNpi?: string | null;
  groupNumber?: string | null;
  assignedToId?: string | null;
  followUpDate?: string | Date | null;
  effectiveDate?: string | Date | null;
  notes?: string | null;
}

export interface BulkEnrollmentResult {
  success: boolean;
  totalCombinations: number;
  createdCount: number;
  skippedCount: number;
  createdEnrollmentIds: string[];
  skippedDetails: Array<{ providerId: string; payerId: string; reason: string }>;
}

export class BulkService {
  /**
   * Normalizes header key from CSV string to match CsvProviderRow schema.
   */
  static normalizeHeaderKey(rawKey: string): keyof CsvProviderRow | null {
    const clean = rawKey.trim().toLowerCase().replace(/[\s_-]+/g, '');
    switch (clean) {
      case 'firstname':
      case 'first':
        return 'firstName';
      case 'lastname':
      case 'last':
        return 'lastName';
      case 'middlename':
      case 'middle':
        return 'middleName';
      case 'suffix':
        return 'suffix';
      case 'npinumber':
      case 'npi':
        return 'npiNumber';
      case 'npitype':
        return 'npiType';
      case 'ssn':
      case 'socialsecurity':
      case 'socialsecuritynumber':
        return 'ssn';
      case 'dateofbirth':
      case 'dob':
      case 'birthdate':
        return 'dateOfBirth';
      case 'gender':
      case 'sex':
        return 'gender';
      case 'email':
      case 'emailaddress':
        return 'email';
      case 'phone':
      case 'phonenumber':
      case 'telephone':
        return 'phone';
      case 'primarytaxonomy':
      case 'taxonomy':
      case 'taxonomycode':
      case 'specialty':
        return 'primaryTaxonomy';
      case 'taxonomydescription':
      case 'specialtydescription':
        return 'taxonomyDescription';
      case 'caqhid':
      case 'caqh':
      case 'caqhnumber':
        return 'caqhId';
      case 'status':
        return 'status';
      case 'groupname':
      case 'group':
      case 'organization':
      case 'organizationname':
      case 'practice':
      case 'practicename':
        return 'groupName';
      case 'groupnpi':
      case 'organizationnpi':
      case 'billingnpi':
      case 'orgnpi':
        return 'groupNpi';
      case 'grouptaxid':
      case 'taxid':
      case 'tin':
      case 'ein':
        return 'groupTaxId';
      default:
        return null;
    }
  }

  /**
   * Simple and robust CSV line parser handling quotes, commas, and whitespace.
   */
  static parseCsv(csvText: string): CsvProviderRow[] {
    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) return [];

    const rawHeaders = this.parseCsvLine(lines[0]);
    const headerMapping: Array<{ index: number; key: keyof CsvProviderRow }> = [];

    rawHeaders.forEach((h, index) => {
      const mapped = this.normalizeHeaderKey(h);
      if (mapped) {
        headerMapping.push({ index, key: mapped });
      }
    });

    const parsedRows: CsvProviderRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const lineValues = this.parseCsvLine(lines[i]);
      if (lineValues.length === 0 || (lineValues.length === 1 && !lineValues[0])) continue;

      const rowObj: CsvProviderRow = {};
      for (const { index, key } of headerMapping) {
        if (index < lineValues.length) {
          const val = lineValues[index].trim();
          if (val) {
            (rowObj as any)[key] = val;
          }
        }
      }
      parsedRows.push(rowObj);
    }

    return parsedRows;
  }

  private static parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  /**
   * Validates parsed rows, detecting format errors and duplicate NPIs.
   */
  static async validateProviderRows(rows: CsvProviderRow[]): Promise<{
    validRows: Array<CsvProviderRow & { rowNumber: number }>;
    errors: RowValidationError[];
    rowErrorCounts: Map<number, number>;
  }> {
    const errors: RowValidationError[] = [];
    const validRows: Array<CsvProviderRow & { rowNumber: number }> = [];
    const rowErrorCounts = new Map<number, number>();

    const seenNpisInBatch = new Set<string>();
    const npisToCheck: string[] = [];

    rows.forEach((r, idx) => {
      const rowNum = idx + 1;
      let hasError = false;

      // 1. Required: First Name & Last Name
      if (!r.firstName || !r.firstName.trim()) {
        errors.push({ rowNumber: rowNum, field: 'firstName', message: 'First name is required' });
        hasError = true;
      }
      if (!r.lastName || !r.lastName.trim()) {
        errors.push({ rowNumber: rowNum, field: 'lastName', message: 'Last name is required' });
        hasError = true;
      }

      // 2. Required: 10-digit NPI
      const npi = r.npiNumber ? String(r.npiNumber).trim() : '';
      if (!npi) {
        errors.push({ rowNumber: rowNum, field: 'npiNumber', message: 'NPI number is required' });
        hasError = true;
      } else if (!npiRegex.test(npi)) {
        errors.push({
          rowNumber: rowNum,
          field: 'npiNumber',
          message: 'NPI must be exactly 10 numeric digits',
          value: npi,
        });
        hasError = true;
      } else if (seenNpisInBatch.has(npi)) {
        errors.push({
          rowNumber: rowNum,
          field: 'npiNumber',
          message: `Duplicate NPI '${npi}' within this import file`,
          value: npi,
        });
        hasError = true;
      } else {
        seenNpisInBatch.add(npi);
        npisToCheck.push(npi);
      }

      // 3. Optional: SSN format
      if (r.ssn && !ssnRegex.test(r.ssn.trim())) {
        errors.push({
          rowNumber: rowNum,
          field: 'ssn',
          message: 'SSN must be in format XXX-XX-XXXX or 9 digits',
          value: r.ssn,
        });
        hasError = true;
      }

      // 4. Optional: Email format
      if (r.email) {
        const emailTrim = r.email.trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(emailTrim)) {
          errors.push({
            rowNumber: rowNum,
            field: 'email',
            message: 'Invalid email address format',
            value: emailTrim,
          });
          hasError = true;
        }
      }

      // 5. Optional: Date of birth format
      if (r.dateOfBirth) {
        const d = new Date(r.dateOfBirth);
        if (isNaN(d.getTime())) {
          errors.push({
            rowNumber: rowNum,
            field: 'dateOfBirth',
            message: 'Invalid date format for date of birth',
            value: r.dateOfBirth,
          });
          hasError = true;
        }
      }

      // 6. Optional: Group NPI format
      if (r.groupNpi && r.groupNpi.trim() && !npiRegex.test(r.groupNpi.trim())) {
        errors.push({
          rowNumber: rowNum,
          field: 'groupNpi',
          message: 'Group NPI must be exactly 10 numeric digits',
          value: r.groupNpi,
        });
        hasError = true;
      }

      const currentErrors = errors.filter((e) => e.rowNumber === rowNum).length;
      rowErrorCounts.set(rowNum, currentErrors);

      if (!hasError) {
        validRows.push({ ...r, npiNumber: npi, rowNumber: rowNum });
      }
    });

    // Check existing NPIs in DB to flag collision
    if (npisToCheck.length > 0) {
      const existingInDb = await prisma.provider.findMany({
        where: { npiNumber: { in: npisToCheck } },
        select: { npiNumber: true },
      });

      const existingNpiSet = new Set(existingInDb.map((p) => p.npiNumber));

      if (existingNpiSet.size > 0) {
        // Remove rows with duplicate NPIs from validRows and append errors
        const stillValid: Array<CsvProviderRow & { rowNumber: number }> = [];

        for (const row of validRows) {
          if (row.npiNumber && existingNpiSet.has(row.npiNumber)) {
            errors.push({
              rowNumber: row.rowNumber,
              field: 'npiNumber',
              message: `NPI '${row.npiNumber}' already exists in the system`,
              value: row.npiNumber,
            });
            rowErrorCounts.set(row.rowNumber, (rowErrorCounts.get(row.rowNumber) || 0) + 1);
          } else {
            stillValid.push(row);
          }
        }
        return { validRows: stillValid, errors, rowErrorCounts };
      }
    }

    return { validRows, errors, rowErrorCounts };
  }

  /**
   * Previews provider CSV import without modifying the database.
   */
  static async previewProviderImport(csvText: string): Promise<BulkImportPreviewResult> {
    const rawRows = this.parseCsv(csvText);
    const { validRows, errors, rowErrorCounts } = await this.validateProviderRows(rawRows);

    const validRowNums = new Set(validRows.map((r) => r.rowNumber));

    const previewRows = rawRows.map((r, idx) => {
      const rowNumber = idx + 1;
      return {
        ...r,
        rowNumber,
        isValid: validRowNums.has(rowNumber),
        errorCount: rowErrorCounts.get(rowNumber) || 0,
      };
    });

    return {
      totalRows: rawRows.length,
      validCount: validRows.length,
      invalidCount: rawRows.length - validRows.length,
      errors,
      previewRows,
    };
  }

  /**
   * Imports valid provider rows from CSV into the database with audit logging.
   */
  static async commitProviderImport(params: {
    csvText: string;
    userId: string;
    userEmail: string;
  }): Promise<BulkImportCommitResult> {
    const rawRows = this.parseCsv(params.csvText);
    const { validRows, errors } = await this.validateProviderRows(rawRows);

    if (validRows.length === 0) {
      return {
        success: false,
        importedCount: 0,
        failedCount: rawRows.length,
        errors,
        importedIds: [],
      };
    }

    const importedIds: string[] = [];
    const orgCache = new Map<string, string>();

    // Process valid rows
    for (const row of validRows) {
      try {
        const encryptedSsn = row.ssn ? encrypt(row.ssn.replace(/\D/g, '')) : null;
        const dob = row.dateOfBirth ? new Date(row.dateOfBirth) : null;
        const npiType = row.npiType ? parseInt(String(row.npiType), 10) || 1 : 1;

        const provider = await prisma.provider.create({
          data: {
            firstName: row.firstName!,
            lastName: row.lastName!,
            middleName: row.middleName || null,
            suffix: row.suffix || null,
            npiNumber: row.npiNumber!,
            npiType,
            ssnEncrypted: encryptedSsn,
            dateOfBirth: dob,
            gender: row.gender || null,
            email: row.email || null,
            phone: row.phone || null,
            primaryTaxonomy: row.primaryTaxonomy || null,
            taxonomyDescription: row.taxonomyDescription || null,
            caqhId: row.caqhId || null,
            status: (row.status?.toLowerCase() === 'inactive' ? 'inactive' : 'active') as any,
            credentialingStatus: 'in_progress',
          },
        });

        // Resolve group / organization if specified and associate provider
        const groupName = row.groupName?.trim();
        const groupNpi = row.groupNpi?.trim();
        const groupTaxId = row.groupTaxId?.trim();

        if (groupName || groupNpi) {
          const cacheKey = groupNpi || (groupName ? groupName.toLowerCase() : null);
          let targetOrgId: string | null = null;

          if (cacheKey && orgCache.has(cacheKey)) {
            targetOrgId = orgCache.get(cacheKey)!;
          } else {
            // 1. Check existing organization by NPI
            let existingOrg = null;
            if (groupNpi) {
              existingOrg = await prisma.organization.findUnique({
                where: { npiNumber: groupNpi },
              });
            }

            // 2. Check existing organization by Name if not found
            if (!existingOrg && groupName) {
              existingOrg = await prisma.organization.findFirst({
                where: { name: { equals: groupName, mode: 'insensitive' } },
              });
            }

            if (existingOrg) {
              targetOrgId = existingOrg.id;
            } else if (groupName) {
              // Create organization once for this group and reuse for all matching rows
              let taxIdEncrypted: Buffer | null = null;
              let taxIdLastFour: string | null = null;
              if (groupTaxId) {
                const digitsOnly = groupTaxId.replace(/\D/g, '');
                taxIdLastFour = digitsOnly.slice(-4);
                taxIdEncrypted = encrypt(groupTaxId);
              }

              const newOrg = await prisma.organization.create({
                data: {
                  name: groupName,
                  npiNumber: groupNpi || null,
                  taxIdEncrypted,
                  taxIdLastFour,
                  organizationType: 'medical_group',
                  address1: 'Pending Address',
                  city: 'Austin',
                  state: 'TX',
                  zipCode: '78701',
                  status: 'active',
                },
              });
              targetOrgId = newOrg.id;
            }

            if (targetOrgId) {
              if (groupNpi) orgCache.set(groupNpi, targetOrgId);
              if (groupName) orgCache.set(groupName.toLowerCase(), targetOrgId);
            }
          }

          if (targetOrgId) {
            await prisma.providerOrganization.create({
              data: {
                providerId: provider.id,
                organizationId: targetOrgId,
                isPrimary: true,
              },
            });
          }
        }

        importedIds.push(provider.id);
      } catch (err: any) {
        errors.push({
          rowNumber: row.rowNumber,
          field: 'general',
          message: `Database insert failed: ${err.message || 'Unknown error'}`,
        });
      }
    }

    // Record immutable audit log
    await logAuditEvent({
      userId: params.userId,
      userEmail: params.userEmail,
      action: 'BULK_PROVIDERS_IMPORTED',
      entityType: 'provider',
      metadata: {
        totalRowsInFile: rawRows.length,
        importedCount: importedIds.length,
        failedCount: rawRows.length - importedIds.length,
        importedIds,
      },
    });

    return {
      success: importedIds.length > 0,
      importedCount: importedIds.length,
      failedCount: rawRows.length - importedIds.length,
      errors,
      importedIds,
    };
  }

  /**
   * Bulk creates payer enrollments across providerIds × payerIds matrix.
   */
  static async createBulkEnrollments(params: {
    input: BulkEnrollmentInput;
    userId: string;
    userEmail: string;
  }): Promise<BulkEnrollmentResult> {
    const { providerIds, payerIds } = params.input;

    if (!providerIds || providerIds.length === 0) {
      throw new Error('At least one provider must be specified');
    }
    if (!payerIds || payerIds.length === 0) {
      throw new Error('At least one payer must be specified');
    }

    // Verify providers exist
    const providers = await prisma.provider.findMany({
      where: { id: { in: providerIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    if (providers.length !== providerIds.length) {
      throw new Error('One or more specified provider IDs do not exist');
    }

    // Verify payers exist
    const payers = await prisma.payer.findMany({
      where: { id: { in: payerIds } },
      select: { id: true, name: true },
    });
    if (payers.length !== payerIds.length) {
      throw new Error('One or more specified payer IDs do not exist');
    }

    const totalCombinations = providerIds.length * payerIds.length;
    const createdEnrollmentIds: string[] = [];
    const skippedDetails: Array<{ providerId: string; payerId: string; reason: string }> = [];

    const effectiveDate = params.input.effectiveDate ? new Date(params.input.effectiveDate) : null;
    const followUpDate = params.input.followUpDate ? new Date(params.input.followUpDate) : null;
    const status = params.input.status || 'initial_application';
    const enrollmentType = params.input.enrollmentType || 'individual';

    for (const provId of providerIds) {
      for (const payId of payerIds) {
        // Check duplicate active enrollment
        const existing = await prisma.payerEnrollment.findFirst({
          where: {
            providerId: provId,
            payerId: payId,
            status: { notIn: ['terminated', 'denied'] },
          },
        });

        if (existing) {
          skippedDetails.push({
            providerId: provId,
            payerId: payId,
            reason: `Active enrollment already exists with status '${existing.status}'`,
          });
          continue;
        }

        // Create enrollment
        const enrollment = await prisma.payerEnrollment.create({
          data: {
            providerId: provId,
            payerId: payId,
            enrollmentType,
            status,
            groupNpi: params.input.groupNpi || null,
            groupNumber: params.input.groupNumber || null,
            effectiveDate,
            followUpDate,
            assignedToId: params.input.assignedToId || null,
            notes: params.input.notes || null,
            statusHistory: {
              create: {
                newStatus: status,
                previousStatus: null,
                notes: 'Batch created via Bulk Enrollment Creation tool',
                changedById: params.userId,
              },
            },
          },
        });

        createdEnrollmentIds.push(enrollment.id);
      }
    }

    // Record immutable audit log
    await logAuditEvent({
      userId: params.userId,
      userEmail: params.userEmail,
      action: 'BULK_ENROLLMENTS_CREATED',
      entityType: 'payer_enrollment',
      metadata: {
        totalCombinations,
        createdCount: createdEnrollmentIds.length,
        skippedCount: skippedDetails.length,
        providerIds,
        payerIds,
        createdEnrollmentIds,
      },
    });

    return {
      success: createdEnrollmentIds.length > 0 || skippedDetails.length === totalCombinations,
      totalCombinations,
      createdCount: createdEnrollmentIds.length,
      skippedCount: skippedDetails.length,
      createdEnrollmentIds,
      skippedDetails,
    };
  }
}
