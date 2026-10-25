import { z } from 'zod';

export const npiRegex = /^\d{10}$/;
export const ssnRegex = /^(?:\d{3}-\d{2}-\d{4}|\d{9})$/;

export const createProviderSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  middleName: z.string().trim().max(100).optional().nullable(),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  suffix: z.string().trim().max(20).optional().nullable(),
  dateOfBirth: z
    .string()
    .optional()
    .nullable()
    .transform((val) => (val ? new Date(val) : null)),
  ssn: z
    .string()
    .trim()
    .regex(ssnRegex, 'SSN must be in format XXX-XX-XXXX or 9 digits')
    .optional()
    .nullable(),
  gender: z.string().trim().max(20).optional().nullable(),
  email: z.string().trim().email('Invalid email address').max(255).optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(20).optional().nullable(),
  npiNumber: z
    .string()
    .trim()
    .regex(npiRegex, 'NPI must be exactly 10 numeric digits'),
  npiType: z.number().int().min(1).max(2).default(1),
  npiEnumerationDate: z
    .string()
    .optional()
    .nullable()
    .transform((val) => (val ? new Date(val) : null)),
  primaryTaxonomy: z.string().trim().max(20).optional().nullable(),
  taxonomyDescription: z.string().trim().max(255).optional().nullable(),
  caqhId: z.string().trim().max(20).optional().nullable(),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
  credentialingStatus: z
    .enum(['in_progress', 'completed', 'needs_review', 'initial', 'suspended'])
    .default('in_progress'),
  notes: z.string().trim().optional().nullable(),
  specialties: z
    .array(
      z.object({
        taxonomyCode: z.string().trim().min(1),
        isPrimary: z.boolean().default(false),
      })
    )
    .optional(),
  locationIds: z
    .array(
      z.object({
        locationId: z.string().uuid(),
        isPrimary: z.boolean().default(false),
      })
    )
    .optional(),
  payerIds: z.array(z.string().uuid('Invalid payer ID')).optional(),
  payerEnrollments: z
    .array(
      z.object({
        payerId: z.string().uuid('Invalid payer ID'),
        enrollmentType: z.enum(['individual', 'group']).default('individual').optional(),
        applicationType: z.string().default('initial').optional(),
        status: z
          .enum(['not_started', 'in_progress', 'submitted', 'approved', 'rejected', 'expired'])
          .default('not_started')
          .optional(),
        notes: z.string().trim().max(1000).optional().nullable(),
        locationId: z.string().uuid('Invalid location ID').optional().nullable(),
      })
    )
    .optional(),
  organizationAffiliation: z
    .object({
      mode: z.enum(['none', 'existing', 'new']).default('none'),
      organizationId: z.string().uuid().optional().nullable(),
      isPrimary: z.boolean().default(true),
      employmentType: z.string().optional().nullable(),
      newOrganization: z
        .object({
          name: z.string().trim().min(1, 'Group name is required').max(255),
          dbaName: z.string().trim().max(255).optional().nullable().or(z.literal('')),
          npiNumber: z
            .string()
            .trim()
            .regex(npiRegex, 'Group NPI must be exactly 10 digits')
            .optional()
            .nullable()
            .or(z.literal('')),
          taxId: z
            .string()
            .trim()
            .regex(/^(?:\d{2}-\d{7}|\d{9})$/, 'Tax ID must be 9 digits or XX-XXXXXXX')
            .optional()
            .nullable()
            .or(z.literal('')),
          organizationType: z.string().default('medical_group').optional(),
          address1: z.string().trim().min(1, 'Street address is required').max(255),
          city: z.string().trim().min(1, 'City is required').max(100),
          state: z.string().trim().length(2, 'State must be 2 characters').toUpperCase(),
          zipCode: z.string().trim().min(5).max(10),
          phone: z.string().trim().max(20).optional().nullable().or(z.literal('')),
          email: z.string().trim().email().optional().nullable().or(z.literal('')),
        })
        .optional(),
    })
    .optional(),
  organizationIds: z
    .array(
      z.object({
        organizationId: z.string().uuid(),
        isPrimary: z.boolean().default(false),
        employmentType: z.string().optional().nullable(),
      })
    )
    .optional(),
});

export const updateProviderSchema = createProviderSchema.partial().extend({
  npiNumber: z
    .string()
    .trim()
    .regex(npiRegex, 'NPI must be exactly 10 numeric digits')
    .optional(),
});

export const addSpecialtySchema = z.object({
  taxonomyCode: z.string().trim().min(1, 'Taxonomy code is required'),
  isPrimary: z.boolean().default(false),
});

export const linkLocationSchema = z.object({
  locationId: z.string().uuid('Valid location UUID is required'),
  isPrimary: z.boolean().default(false),
});

export const createLocationSchema = z.object({
  name: z.string().trim().min(1, 'Location name is required').max(255),
  address1: z.string().trim().min(1, 'Street address is required').max(255),
  address2: z.string().trim().max(255).optional().nullable(),
  city: z.string().trim().min(1, 'City is required').max(100),
  state: z.string().trim().length(2, 'State must be a 2-letter abbreviation').toUpperCase(),
  zipCode: z.string().trim().min(5, 'Zip code must be at least 5 digits').max(10),
  phone: z.string().trim().max(20).optional().nullable(),
  fax: z.string().trim().max(20).optional().nullable(),
  isActive: z.boolean().default(true),
});
