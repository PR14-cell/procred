import { z } from 'zod';

export const DocumentTypeEnum = z.enum([
  'state_license',
  'dea_registration',
  'board_certification',
  'malpractice_insurance',
  'caqh_profile',
  'payer_application',
  'payer_approval_letter',
  'w9',
  'identity_proof',
  'cme_certificate',
  'other',
]);

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
]);

export type DocumentEntityType = z.infer<typeof DocumentEntityTypeEnum>;

// 1. Create Document with Initial Version
export const createDocumentSchema = z
  .object({
    entityType: DocumentEntityTypeEnum,
    entityId: z.string().uuid('Invalid entity ID'),
    providerId: z.string().uuid('Invalid provider ID').optional().nullable(),
    documentType: DocumentTypeEnum,
    title: z.string().min(2, 'Title must be at least 2 characters').max(255),
    description: z.string().optional().nullable(),
    issueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Issue date must be YYYY-MM-DD')
      .optional()
      .nullable(),
    expirationDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiration date must be YYYY-MM-DD')
      .optional()
      .nullable(),
    fileName: z.string().min(1, 'File name is required').max(255),
    mimeType: z.string().min(1, 'MIME type is required'),
    fileBase64: z.string().min(1, 'File data is required'),
  })
  .refine(
    (data) => {
      if (data.issueDate && data.expirationDate) {
        return new Date(data.issueDate) <= new Date(data.expirationDate);
      }
      return true;
    },
    {
      message: 'Expiration date must be after or on issue date',
      path: ['expirationDate'],
    }
  );

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

// 2. Add New Version to Existing Document
export const addDocumentVersionSchema = z.object({
  fileName: z.string().min(1, 'File name is required').max(255),
  mimeType: z.string().min(1, 'MIME type is required'),
  fileBase64: z.string().min(1, 'File data is required'),
  notes: z.string().optional().nullable(),
});

export type AddDocumentVersionInput = z.infer<typeof addDocumentVersionSchema>;

// 3. Update Document Metadata
export const updateDocumentMetadataSchema = z
  .object({
    title: z.string().min(2).max(255).optional(),
    description: z.string().optional().nullable(),
    documentType: DocumentTypeEnum.optional(),
    issueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .nullable(),
    expirationDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .nullable(),
  })
  .refine(
    (data) => {
      if (data.issueDate && data.expirationDate) {
        return new Date(data.issueDate) <= new Date(data.expirationDate);
      }
      return true;
    },
    {
      message: 'Expiration date must be after or on issue date',
      path: ['expirationDate'],
    }
  );

export type UpdateDocumentMetadataInput = z.infer<typeof updateDocumentMetadataSchema>;

// 4. Verify / Reject Document
export const verifyDocumentSchema = z
  .object({
    status: z.enum(['verified', 'rejected', 'pending_review']),
    verificationNotes: z.string().optional().nullable(),
    rejectionReason: z.string().optional().nullable(),
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
