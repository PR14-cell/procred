import { z } from 'zod';

export const PayerTypeEnum = z.enum([
  'commercial',
  'medicare',
  'medicaid',
  'tricare',
  'other',
]);

export const EnrollmentTypeEnum = z.enum(['individual', 'group']);

export const EnrollmentStatusEnum = z.enum([
  'not_started',
  'preparing',
  'submitted',
  'pending',
  'needs_info',
  'approved',
  'active',
  'denied',
  'terminated',
  'revalidation_required',
]);

export const ApplicationTypeEnum = z.enum([
  'initial',
  'revalidation',
  'update',
  'termination',
]);

export const MissingItemCategoryEnum = z.enum([
  'missing_document',
  'missing_signature',
  'missing_payer_info',
  'additional_info_requested',
  'other',
]);

// 1. Missing Info Item Schema
export const missingItemSchema = z.object({
  id: z.string().default(() => Math.random().toString(36).substring(2, 9)),
  category: MissingItemCategoryEnum,
  description: z.string().min(2, 'Description must be at least 2 characters'),
  isResolved: z.boolean().default(false),
  notes: z.string().optional().nullable(),
  resolvedAt: z.string().optional().nullable(),
});

export type MissingItem = z.infer<typeof missingItemSchema>;

// 2. Payer Schemas
export const createPayerSchema = z.object({
  name: z.string().min(2, 'Payer name must be at least 2 characters').max(255),
  shortName: z.string().max(50).optional().nullable(),
  payerType: PayerTypeEnum.default('commercial'),
  state: z.string().length(2, 'State must be a 2-letter postal code').toUpperCase().optional().nullable(),
  website: z.string().url('Invalid website URL').optional().nullable().or(z.literal('')),
  phone: z.string().max(20).optional().nullable(),
  enrollmentPortalUrl: z.string().url('Invalid portal URL').optional().nullable().or(z.literal('')),
  requiredDocumentTypes: z.array(z.string()).default([]),
  notes: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
});

export const updatePayerSchema = createPayerSchema.partial();

// 3. Payer Enrollment Schemas
export const createEnrollmentSchema = z.object({
  providerId: z.string().uuid('Invalid provider ID'),
  payerId: z.string().uuid('Invalid payer ID'),
  locationId: z.string().uuid('Invalid location ID').optional().nullable(),
  enrollmentType: EnrollmentTypeEnum.default('individual'),
  applicationType: ApplicationTypeEnum.default('initial'),
  status: EnrollmentStatusEnum.default('not_started'),
  providerPayerId: z.string().max(50).optional().nullable(),
  groupNumber: z.string().max(50).optional().nullable(),
  groupNpi: z
    .string()
    .regex(/^\d{10}$/, 'Group NPI must be exactly 10 digits')
    .optional()
    .nullable()
    .or(z.literal('')),
  submittedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional().nullable(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional().nullable(),
  terminationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional().nullable(),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional().nullable(),
  lastFollowUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional().nullable(),
  revalidationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional().nullable(),
  revalidationCycleMonths: z.number().int().min(1).max(120).optional().nullable(),
  trackingNumber: z.string().max(100).optional().nullable(),
  assignedToId: z.string().uuid('Invalid assigned user ID').optional().nullable(),
  notes: z.string().optional().nullable(),
  missingItems: z.array(missingItemSchema).default([]),
}).refine((data) => {
  if (data.enrollmentType === 'group' && !data.groupNpi && !data.groupNumber) {
    return false;
  }
  return true;
}, {
  message: 'Group enrollment requires at least Group NPI or Group Number',
  path: ['groupNpi'],
});

export const updateEnrollmentSchema = z.object({
  locationId: z.string().uuid().optional().nullable(),
  enrollmentType: EnrollmentTypeEnum.optional(),
  applicationType: ApplicationTypeEnum.optional(),
  status: EnrollmentStatusEnum.optional(),
  providerPayerId: z.string().max(50).optional().nullable(),
  groupNumber: z.string().max(50).optional().nullable(),
  groupNpi: z.string().regex(/^\d{10}$/).optional().nullable().or(z.literal('')),
  submittedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  terminationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  lastFollowUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  revalidationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  revalidationCycleMonths: z.number().int().optional().nullable(),
  trackingNumber: z.string().max(100).optional().nullable(),
  assignedToId: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
  missingItems: z.array(missingItemSchema).optional(),
});

// 4. Status Transition Schema
export const transitionStatusSchema = z.object({
  status: EnrollmentStatusEnum,
  notes: z.string().optional().nullable(),
});

// 5. Structured Follow-Up Schema
export const createFollowUpSchema = z.object({
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Follow-up date must be YYYY-MM-DD'),
  contactMethod: z.enum(['phone', 'email', 'portal', 'fax']).default('phone'),
  contactPerson: z.string().max(255).optional().nullable(),
  referenceNumber: z.string().max(100).optional().nullable(),
  outcome: z.enum(['no_update', 'in_process', 'need_info', 'approved', 'denied']).default('in_process'),
  notes: z.string().optional().nullable(),
  nextFollowUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Next follow-up date must be YYYY-MM-DD').optional().nullable(),
});

// 6. Update Missing Items Checklist
export const updateMissingItemsSchema = z.object({
  missingItems: z.array(missingItemSchema),
});
