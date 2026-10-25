import { z } from 'zod';
import { npiRegex } from './provider';

export const taxIdRegex = /^(?:\d{2}-\d{7}|\d{9})$/;

export const OrganizationTypeEnum = z.enum([
  'medical_group',
  'solo_practice',
  'hospital',
  'health_system',
  'clinic',
  'urgent_care',
  'other',
]);

export const OrganizationStatusEnum = z.enum(['active', 'inactive', 'archived']);

export const EmploymentTypeEnum = z.enum([
  'w2',
  '1099',
  'partner',
  'contractor',
  'employed',
  'affiliate',
  'other',
]);

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, 'Organization / Group name is required').max(255),
  dbaName: z.string().trim().max(255).optional().nullable().or(z.literal('')),
  npiNumber: z
    .string()
    .trim()
    .regex(npiRegex, 'Group NPI must be exactly 10 numeric digits')
    .optional()
    .nullable()
    .or(z.literal('')),
  taxId: z
    .string()
    .trim()
    .regex(taxIdRegex, 'Tax ID / TIN must be 9 digits or in format XX-XXXXXXX')
    .optional()
    .nullable()
    .or(z.literal('')),
  organizationType: OrganizationTypeEnum.default('medical_group'),
  address1: z.string().trim().min(1, 'Street address is required').max(255),
  address2: z.string().trim().max(255).optional().nullable().or(z.literal('')),
  city: z.string().trim().min(1, 'City is required').max(100),
  state: z.string().trim().length(2, 'State must be a 2-letter postal code').toUpperCase(),
  zipCode: z.string().trim().min(5, 'Zip code must be at least 5 digits').max(10),
  phone: z.string().trim().max(20).optional().nullable().or(z.literal('')),
  email: z.string().trim().email('Invalid email address').max(255).optional().nullable().or(z.literal('')),
  website: z.string().trim().url('Invalid website URL').max(255).optional().nullable().or(z.literal('')),
  status: OrganizationStatusEnum.default('active'),
  notes: z.string().trim().optional().nullable().or(z.literal('')),
});

export const updateOrganizationSchema = createOrganizationSchema.partial();

export const associateProviderSchema = z.object({
  providerId: z.string().uuid('Valid provider UUID is required'),
  isPrimary: z.boolean().default(false),
  employmentType: EmploymentTypeEnum.optional().nullable().or(z.literal('')),
  startDate: z
    .string()
    .optional()
    .nullable()
    .transform((val) => (val ? new Date(val) : null)),
  endDate: z
    .string()
    .optional()
    .nullable()
    .transform((val) => (val ? new Date(val) : null)),
});

export const disassociateProviderSchema = z.object({
  providerId: z.string().uuid('Valid provider UUID is required'),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type AssociateProviderInput = z.infer<typeof associateProviderSchema>;
