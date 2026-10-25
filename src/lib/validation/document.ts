import { z } from 'zod';

export const DocumentTypeEnum = z.enum(
  [
    'state_license',
    'dea_registration',
    'board_certification',
    'malpractice_insurance',
    'caqh_profile',
    'payer_application',
    'payer_approval_letter',
    'w9',
    'group_npi_letter',
    'group_malpractice_coi',
    'group_payer_agreement',
    'identity_proof',
    'cme_certificate',
    'other',
  ],
  {
    errorMap: () => ({ message: 'Document category is required and must be a supported type' }),
  }
);

export type DocumentType = z.infer<typeof DocumentTypeEnum>;

export const DocumentStatusEnum = z.enum([
  'uploaded',
  'pending_review',
  'verified',
  'rejected',
  'expired',
  'superseded',
]);

export type DocumentStatus = z.infer<typeof DocumentStatusEnum>;

export const DocumentEntityTypeEnum = z.enum([
  'provider',
  'credential',
  'payer_enrollment',
  'payer',
  'location',
  'general',
  'organization',
]);

export type DocumentEntityType = z.infer<typeof DocumentEntityTypeEnum>;

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

// 1. Create Document with Initial Version
export const createDocumentSchema = z
  .object({
    entityType: DocumentEntityTypeEnum.optional().default('general'),
    entityId: z.string().uuid('Invalid entity ID').optional(),
    providerId: z
      .union([z.string().uuid('Invalid provider ID'), z.literal(''), z.null(), z.undefined()])
      .transform((val) => (val === '' ? null : val)),
    documentType: DocumentTypeEnum,
    title: z
      .string({ required_error: 'Document title is required' })
      .trim()
      .min(1, 'Document title is required')
      .min(2, 'Document title must be at least 2 characters')
      .max(255, 'Document title cannot exceed 255 characters'),
    description: z.string().trim().optional().nullable(),
    issueDate: z
      .union([
        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Issue date must be in YYYY-MM-DD format'),
        z.literal(''),
        z.null(),
        z.undefined(),
      ])
      .transform((val) => (val === '' ? null : val))
      .refine(
        (val) => {
          if (!val) return true;
          const d = new Date(val);
          return !isNaN(d.getTime());
        },
        { message: 'Invalid issue date' }
      ),
    expirationDate: z
      .union([
        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiration date must be in YYYY-MM-DD format'),
        z.literal(''),
        z.null(),
        z.undefined(),
      ])
      .transform((val) => (val === '' ? null : val))
      .refine(
        (val) => {
          if (!val) return true;
          const d = new Date(val);
          return !isNaN(d.getTime());
        },
        { message: 'Invalid expiration date' }
      ),
    fileName: z
      .string({ required_error: 'File name is required' })
      .trim()
      .min(1, 'File name is required')
      .max(255, 'File name cannot exceed 255 characters'),
    mimeType: z.enum(ALLOWED_DOCUMENT_MIME_TYPES, {
      errorMap: () => ({ message: 'File type must be PDF, JPEG, or PNG' }),
    }),
    fileBase64: z
      .string({ required_error: 'File data is required' })
      .min(1, 'File data is required'),
  })
  .refine(
    (data) => {
      if (data.issueDate && data.expirationDate) {
        return new Date(data.issueDate) <= new Date(data.expirationDate);
      }
      return true;
    },
    {
      message: 'Expiration date must be on or after issue date',
      path: ['expirationDate'],
    }
  );

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

// 2. Add New Version to Existing Document
export const addDocumentVersionSchema = z.object({
  fileName: z
    .string({ required_error: 'File name is required' })
    .trim()
    .min(1, 'File name is required')
    .max(255),
  mimeType: z.enum(ALLOWED_DOCUMENT_MIME_TYPES, {
    errorMap: () => ({ message: 'File type must be PDF, JPEG, or PNG' }),
  }),
  fileBase64: z
    .string({ required_error: 'File data is required' })
    .min(1, 'File data is required'),
  notes: z.string().trim().optional().nullable(),
});

export type AddDocumentVersionInput = z.infer<typeof addDocumentVersionSchema>;

// 3. Update Document Metadata
export const updateDocumentMetadataSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Document title cannot be empty')
      .min(2, 'Document title must be at least 2 characters')
      .max(255)
      .optional(),
    description: z.string().trim().optional().nullable(),
    documentType: DocumentTypeEnum.optional(),
    issueDate: z
      .union([
        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Issue date must be in YYYY-MM-DD format'),
        z.literal(''),
        z.null(),
        z.undefined(),
      ])
      .transform((val) => (val === '' ? null : val))
      .optional(),
    expirationDate: z
      .union([
        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiration date must be in YYYY-MM-DD format'),
        z.literal(''),
        z.null(),
        z.undefined(),
      ])
      .transform((val) => (val === '' ? null : val))
      .optional(),
  })
  .refine(
    (data) => {
      if (data.issueDate && data.expirationDate) {
        return new Date(data.issueDate) <= new Date(data.expirationDate);
      }
      return true;
    },
    {
      message: 'Expiration date must be on or after issue date',
      path: ['expirationDate'],
    }
  );

export type UpdateDocumentMetadataInput = z.infer<typeof updateDocumentMetadataSchema>;

// 4. Verify / Reject Document
export const verifyDocumentSchema = z
  .object({
    status: z.enum(['verified', 'rejected', 'pending_review']),
    verificationNotes: z.string().trim().optional().nullable(),
    rejectionReason: z.string().trim().optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.status === 'rejected' && (!data.rejectionReason || data.rejectionReason.trim().length < 3)) {
        return false;
      }
      return true;
    },
    {
      message: 'Rejection reason of at least 3 characters is required when rejecting a document',
      path: ['rejectionReason'],
    }
  );

export type VerifyDocumentInput = z.infer<typeof verifyDocumentSchema>;
