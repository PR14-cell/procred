import { z } from 'zod';

export const CredentialTypeEnum = z.enum([
  'state_license',
  'dea_registration',
  'board_certification',
  'malpractice_insurance',
  'caqh_profile',
]);

export type CredentialType = z.infer<typeof CredentialTypeEnum>;

// 1. State License Schema
const baseStateLicenseSchema = z.object({
  providerId: z.string().uuid('Invalid provider ID format'),
  state: z.string().length(2, 'State must be a 2-letter postal abbreviation').toUpperCase(),
  licenseNumber: z.string().min(2, 'License number must be at least 2 characters').max(50),
  licenseType: z.string().max(100).optional().nullable(),
  status: z.enum(['active', 'expired', 'revoked', 'suspended', 'pending', 'inactive']).default('active'),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Issue date must be YYYY-MM-DD').optional().nullable(),
  expirationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiration date must be YYYY-MM-DD'),
});

export const createStateLicenseSchema = baseStateLicenseSchema.refine((data) => {
  if (data.issueDate && data.expirationDate) {
    return new Date(data.issueDate) <= new Date(data.expirationDate);
  }
  return true;
}, {
  message: 'Issue date cannot be after expiration date',
  path: ['expirationDate'],
});

export const updateStateLicenseSchema = baseStateLicenseSchema.partial().omit({ providerId: true });

// 2. DEA Registration Schema
const baseDeaSchema = z.object({
  providerId: z.string().uuid('Invalid provider ID format'),
  deaNumber: z
    .string()
    .regex(/^[A-Z]{2}\d{7}$/i, 'DEA number must follow standard format (2 letters followed by 7 digits)')
    .toUpperCase(),
  schedule: z.string().max(50).optional().nullable(),
  state: z.string().length(2).toUpperCase().optional().nullable(),
  status: z.enum(['active', 'expired', 'revoked', 'suspended', 'inactive']).default('active'),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Issue date must be YYYY-MM-DD').optional().nullable(),
  expirationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiration date must be YYYY-MM-DD'),
});

export const createDeaSchema = baseDeaSchema.refine((data) => {
  if (data.issueDate && data.expirationDate) {
    return new Date(data.issueDate) <= new Date(data.expirationDate);
  }
  return true;
}, {
  message: 'Issue date cannot be after expiration date',
  path: ['expirationDate'],
});

export const updateDeaSchema = baseDeaSchema.partial().omit({ providerId: true });

// 3. Board Certification Schema
const baseBoardCertSchema = z.object({
  providerId: z.string().uuid('Invalid provider ID format'),
  boardName: z.string().min(2, 'Board name is required').max(255),
  specialty: z.string().min(2, 'Specialty is required').max(255),
  certificationNumber: z.string().max(50).optional().nullable(),
  status: z.enum(['active', 'expired', 'revoked', 'lifetime', 'inactive']).default('active'),
  initialCertDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Initial certification date must be YYYY-MM-DD').optional().nullable(),
  expirationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiration date must be YYYY-MM-DD').optional().nullable(),
});

export const createBoardCertSchema = baseBoardCertSchema.refine((data) => {
  if (data.initialCertDate && data.expirationDate) {
    return new Date(data.initialCertDate) <= new Date(data.expirationDate);
  }
  return true;
}, {
  message: 'Initial certification date cannot be after expiration date',
  path: ['expirationDate'],
});

export const updateBoardCertSchema = baseBoardCertSchema.partial().omit({ providerId: true });

// 4. Malpractice Insurance Schema
const baseMalpracticeSchema = z.object({
  providerId: z.string().uuid('Invalid provider ID format'),
  carrierName: z.string().min(2, 'Carrier name is required').max(255),
  policyNumber: z.string().max(100).optional().nullable(),
  coverageType: z.enum(['occurrence', 'claims-made']).optional().nullable(),
  perClaimAmount: z.number().min(0, 'Per claim amount must be >= 0').optional().nullable(),
  aggregateAmount: z.number().min(0, 'Aggregate amount must be >= 0').optional().nullable(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Effective date must be YYYY-MM-DD').optional().nullable(),
  expirationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiration date must be YYYY-MM-DD'),
  retroactiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Retroactive date must be YYYY-MM-DD').optional().nullable(),
  status: z.enum(['active', 'expired', 'cancelled', 'inactive']).default('active'),
});

export const createMalpracticeSchema = baseMalpracticeSchema.refine((data) => {
  if (data.effectiveDate && data.expirationDate) {
    return new Date(data.effectiveDate) <= new Date(data.expirationDate);
  }
  return true;
}, {
  message: 'Effective date cannot be after expiration date',
  path: ['expirationDate'],
});

export const updateMalpracticeSchema = baseMalpracticeSchema.partial().omit({ providerId: true });

// 5. CAQH Profile Schema
const baseCaqhSchema = z.object({
  providerId: z.string().uuid('Invalid provider ID format'),
  caqhId: z.string().regex(/^\d{8,10}$/, 'CAQH ID must be 8 to 10 digits'),
  username: z.string().max(100).optional().nullable(),
  password: z.string().min(6, 'CAQH password must be at least 6 characters').optional().nullable(),
  lastAttestationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Last attestation date must be YYYY-MM-DD').optional().nullable(),
  nextAttestationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Next attestation date must be YYYY-MM-DD'),
  attestationStatus: z.enum(['current', 'expired', 'reauthorization_needed', 'pending']).default('current'),
  reauthorizationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Reauthorization date must be YYYY-MM-DD').optional().nullable(),
});

export const createCaqhSchema = baseCaqhSchema;
export const updateCaqhSchema = baseCaqhSchema.partial().omit({ providerId: true });

// 6. Credential Verification Schema
export const verifyCredentialSchema = z.object({
  entityType: CredentialTypeEnum,
  entityId: z.string().uuid('Invalid entity ID format'),
  providerId: z.string().uuid('Invalid provider ID format'),
  method: z.enum([
    'primary_source',
    'nppes',
    'state_board_website',
    'abms',
    'caqh_proview',
    'phone',
    'fax',
    'manual',
  ]),
  source: z.string().min(2, 'Verification source/URL is required').max(255),
  status: z.enum(['verified', 'unable_to_verify', 'discrepancy', 'pending']),
  expirationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Re-verification due date must be YYYY-MM-DD').optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

// 7. Credential Task Creation Schema
export const createCredentialTaskSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(255),
  description: z.string().optional().nullable(),
  entityType: CredentialTypeEnum.optional().nullable(),
  entityId: z.string().uuid().optional().nullable(),
  priority: z.enum(['urgent', 'high', 'medium', 'low']).default('medium'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be YYYY-MM-DD').optional().nullable(),
  assignedToId: z.string().uuid().optional().nullable(),
});
