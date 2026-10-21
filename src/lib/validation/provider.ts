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
