import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/errors/api-error';
import { encrypt, decrypt } from '@/lib/encryption/aes';
import { logAuditEvent } from '@/lib/audit/audit-logger';
import { Prisma } from '@prisma/client';
import {
  CreateOrganizationInput,
  UpdateOrganizationInput,
  AssociateProviderInput,
} from '@/lib/validation/organization';

export interface OrganizationListFilter {
  search?: string;
  status?: string;
  organizationType?: string;
  page?: number;
  limit?: number;
  sortBy?: 'name' | 'npiNumber' | 'createdAt' | 'status';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Returns safe masked Tax ID / EIN (e.g. XX-XXX1234).
 */
export function maskTaxId(lastFour?: string | null): string | null {
  if (!lastFour) return null;
  return `XX-XXX${lastFour}`;
}

export class OrganizationService {
  /**
   * List organizations with search, status filtering, pagination, and masked Tax IDs.
   */
  static async listOrganizations(filters: OrganizationListFilter = {}) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.OrganizationWhereInput = {};

    if (filters.status && filters.status !== 'all') {
      where.status = filters.status;
    } else if (!filters.status) {
      // By default, exclude archived unless requested
      where.status = { not: 'archived' };
    }

    if (filters.organizationType && filters.organizationType !== 'all') {
      where.organizationType = filters.organizationType;
    }

    if (filters.search && filters.search.trim() !== '') {
      const q = filters.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { dbaName: { contains: q, mode: 'insensitive' } },
        { npiNumber: { contains: q } },
        { taxIdLastFour: { contains: q } },
        { city: { contains: q, mode: 'insensitive' } },
        { state: { contains: q, mode: 'insensitive' } },
      ];
    }

    const sortField = filters.sortBy || 'name';
    const sortOrder = filters.sortOrder || 'asc';
    const orderBy: Prisma.OrganizationOrderByWithRelationInput = {
      [sortField]: sortOrder,
    };

    const [totalItems, items] = await Promise.all([
      prisma.organization.count({ where }),
      prisma.organization.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          _count: {
            select: {
              providers: true,
              enrollments: true,
            },
          },
        },
      }),
    ]);

    const sanitized = items.map((org) => ({
      id: org.id,
      name: org.name,
      dbaName: org.dbaName,
      npiNumber: org.npiNumber,
      taxIdMasked: maskTaxId(org.taxIdLastFour),
      taxIdLastFour: org.taxIdLastFour,
      maskedTaxId: maskTaxId(org.taxIdLastFour),
      organizationType: org.organizationType,
      address1: org.address1,
      address2: org.address2,
      city: org.city,
      state: org.state,
      zipCode: org.zipCode,
      phone: org.phone,
      email: org.email,
      website: org.website,
      status: org.status,
      notes: org.notes,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
      providerCount: org._count.providers,
      enrollmentCount: org._count.enrollments,
      _count: org._count,
    }));

    return {
      organizations: sanitized,
      total: totalItems,
      totalItems,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(totalItems / limit)),
      pagination: {
        page,
        limit,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / limit)),
      },
    };
  }

  /**
   * Get single organization by ID with affiliated providers and enrollment summaries.
   */
  static async getOrganizationById(
    id: string,
    options: { revealTaxId?: boolean; actor?: { userId: string; userEmail?: string | null } } = {}
  ) {
    const org = await prisma.organization.findUnique({
      where: { id },
      include: {
        providers: {
          include: {
            provider: {
              select: {
                id: true,
                firstName: true,
                middleName: true,
                lastName: true,
                suffix: true,
                npiNumber: true,
                status: true,
                credentialingStatus: true,
                primaryTaxonomy: true,
                taxonomyDescription: true,
              },
            },
          },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
        enrollments: {
          include: {
            payer: {
              select: {
                id: true,
                name: true,
                shortName: true,
              },
            },
            provider: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                npiNumber: true,
              },
            },
          },
          orderBy: { updatedAt: 'desc' },
          take: 20,
        },
        _count: {
          select: {
            providers: true,
            enrollments: true,
          },
        },
      },
    });

    if (!org) {
      throw ApiError.notFound('Organization not found.');
    }

    // Document counts for this organization
    const documentCount = await prisma.document.count({
      where: {
        entityType: 'organization',
        entityId: org.id,
      },
    });

    let decryptedTaxId: string | null = null;
    if (options.revealTaxId && org.taxIdEncrypted) {
      try {
        decryptedTaxId = decrypt(org.taxIdEncrypted, 'organization.taxId');
        if (options.actor) {
          await logAuditEvent({
            userId: options.actor.userId,
            userEmail: options.actor.userEmail || null,
            action: 'pii_reveal',
            entityType: 'organization',
            entityId: org.id,
            metadata: { field: 'taxId' },
          });
        }
      } catch (err) {
        console.error('Failed to decrypt taxId for organization', org.id, err);
      }
    }

    return {
      id: org.id,
      name: org.name,
      dbaName: org.dbaName,
      npiNumber: org.npiNumber,
      taxIdMasked: maskTaxId(org.taxIdLastFour),
      taxIdLastFour: org.taxIdLastFour,
      maskedTaxId: maskTaxId(org.taxIdLastFour),
      taxIdDecrypted: decryptedTaxId,
      taxId: decryptedTaxId,
      organizationType: org.organizationType,
      address1: org.address1,
      address2: org.address2,
      city: org.city,
      state: org.state,
      zipCode: org.zipCode,
      phone: org.phone,
      email: org.email,
      website: org.website,
      status: org.status,
      notes: org.notes,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
      providerCount: org._count.providers,
      enrollmentCount: org._count.enrollments,
      _count: org._count,
      documentCount,
      providers: org.providers.map((p) => ({
        id: p.id,
        isPrimary: p.isPrimary,
        employmentType: p.employmentType,
        startDate: p.startDate,
        endDate: p.endDate,
        createdAt: p.createdAt,
        provider: p.provider,
      })),
      enrollments: org.enrollments,
    };
  }

  /**
   * Create a new organization.
   */
  static async createOrganization(
    input: CreateOrganizationInput,
    actor: { userId: string; userEmail?: string | null }
  ) {
    // 1. Check unique NPI if provided
    if (input.npiNumber && input.npiNumber.trim() !== '') {
      const existing = await prisma.organization.findUnique({
        where: { npiNumber: input.npiNumber.trim() },
      });
      if (existing) {
        throw ApiError.conflict(`An organization with NPI ${input.npiNumber} already exists.`);
      }
    }

    // 2. Encrypt Tax ID / TIN if provided
    let taxIdEncrypted: Buffer | null = null;
    let taxIdLastFour: string | null = null;
    if (input.taxId && input.taxId.trim() !== '') {
      const cleanTin = input.taxId.trim();
      const digitsOnly = cleanTin.replace(/\D/g, '');
      taxIdLastFour = digitsOnly.slice(-4);
      taxIdEncrypted = encrypt(cleanTin, 'organization.taxId');
    }

    const org = await prisma.organization.create({
      data: {
        name: input.name.trim(),
        dbaName: input.dbaName ? input.dbaName.trim() : null,
        npiNumber: input.npiNumber && input.npiNumber.trim() !== '' ? input.npiNumber.trim() : null,
        taxIdEncrypted,
        taxIdLastFour,
        organizationType: input.organizationType || 'medical_group',
        address1: input.address1.trim(),
        address2: input.address2 ? input.address2.trim() : null,
        city: input.city.trim(),
        state: input.state.trim().toUpperCase(),
        zipCode: input.zipCode.trim(),
        phone: input.phone ? input.phone.trim() : null,
        email: input.email ? input.email.trim() : null,
        website: input.website ? input.website.trim() : null,
        status: input.status || 'active',
        notes: input.notes ? input.notes.trim() : null,
      },
    });

    // 3. Immutable audit log
    await logAuditEvent({
      userId: actor.userId,
      userEmail: actor.userEmail || null,
      action: 'ORGANIZATION_CREATED',
      entityType: 'organization',
      entityId: org.id,
      metadata: {
        name: org.name,
        npiNumber: org.npiNumber,
        organizationType: org.organizationType,
      },
    });

    return {
      id: org.id,
      name: org.name,
      dbaName: org.dbaName,
      npiNumber: org.npiNumber,
      taxIdMasked: maskTaxId(org.taxIdLastFour),
      taxIdLastFour: org.taxIdLastFour,
      maskedTaxId: maskTaxId(org.taxIdLastFour),
      organizationType: org.organizationType,
      address1: org.address1,
      address2: org.address2,
      city: org.city,
      state: org.state,
      zipCode: org.zipCode,
      phone: org.phone,
      email: org.email,
      website: org.website,
      status: org.status,
      notes: org.notes,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    };
  }

  /**
   * Update an existing organization.
   */
  static async updateOrganization(
    id: string,
    input: UpdateOrganizationInput,
    actor: { userId: string; userEmail?: string | null }
  ) {
    const existing = await prisma.organization.findUnique({ where: { id } });
    if (!existing) {
      throw ApiError.notFound('Organization not found.');
    }

    // Check unique NPI if modified
    if (input.npiNumber && input.npiNumber.trim() !== '' && input.npiNumber.trim() !== existing.npiNumber) {
      const duplicate = await prisma.organization.findUnique({
        where: { npiNumber: input.npiNumber.trim() },
      });
      if (duplicate && duplicate.id !== id) {
        throw ApiError.conflict(`An organization with NPI ${input.npiNumber} already exists.`);
      }
    }

    const data: Prisma.OrganizationUpdateInput = {};

    if (input.name !== undefined) data.name = input.name.trim();
    if (input.dbaName !== undefined) data.dbaName = input.dbaName ? input.dbaName.trim() : null;
    if (input.npiNumber !== undefined) {
      data.npiNumber = input.npiNumber && input.npiNumber.trim() !== '' ? input.npiNumber.trim() : null;
    }
    if (input.organizationType !== undefined) data.organizationType = input.organizationType;
    if (input.address1 !== undefined) data.address1 = input.address1.trim();
    if (input.address2 !== undefined) data.address2 = input.address2 ? input.address2.trim() : null;
    if (input.city !== undefined) data.city = input.city.trim();
    if (input.state !== undefined) data.state = input.state.trim().toUpperCase();
    if (input.zipCode !== undefined) data.zipCode = input.zipCode.trim();
    if (input.phone !== undefined) data.phone = input.phone ? input.phone.trim() : null;
    if (input.email !== undefined) data.email = input.email ? input.email.trim() : null;
    if (input.website !== undefined) data.website = input.website ? input.website.trim() : null;
    if (input.status !== undefined) data.status = input.status;
    if (input.notes !== undefined) data.notes = input.notes ? input.notes.trim() : null;

    if (input.taxId !== undefined) {
      if (input.taxId && input.taxId.trim() !== '') {
        const cleanTin = input.taxId.trim();
        data.taxIdLastFour = cleanTin.replace(/\D/g, '').slice(-4);
        data.taxIdEncrypted = encrypt(cleanTin, 'organization.taxId');
      } else {
        data.taxIdEncrypted = null;
        data.taxIdLastFour = null;
      }
    }

    const updated = await prisma.organization.update({
      where: { id },
      data,
    });

    await logAuditEvent({
      userId: actor.userId,
      userEmail: actor.userEmail || null,
      action: 'ORGANIZATION_UPDATED',
      entityType: 'organization',
      entityId: updated.id,
      changes: {
        name: updated.name !== existing.name ? { old: existing.name, new: updated.name } : undefined,
        status: updated.status !== existing.status ? { old: existing.status, new: updated.status } : undefined,
        npiNumber: updated.npiNumber !== existing.npiNumber ? { old: existing.npiNumber, new: updated.npiNumber } : undefined,
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      dbaName: updated.dbaName,
      npiNumber: updated.npiNumber,
      taxIdMasked: maskTaxId(updated.taxIdLastFour),
      taxIdLastFour: updated.taxIdLastFour,
      maskedTaxId: maskTaxId(updated.taxIdLastFour),
      organizationType: updated.organizationType,
      address1: updated.address1,
      address2: updated.address2,
      city: updated.city,
      state: updated.state,
      zipCode: updated.zipCode,
      phone: updated.phone,
      email: updated.email,
      website: updated.website,
      status: updated.status,
      notes: updated.notes,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Safe archival or deletion of an organization.
   * Never deletes provider profiles or historical audit records.
   */
  static async archiveOrDelete(
    id: string,
    options: { hard?: boolean } = {},
    actor: { userId: string; userEmail?: string | null }
  ) {
    const existing = await prisma.organization.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            providers: true,
            enrollments: true,
          },
        },
      },
    });

    if (!existing) {
      throw ApiError.notFound('Organization not found.');
    }

    // Default policy: Soft delete / Archive
    if (!options.hard) {
      const archived = await prisma.organization.update({
        where: { id },
        data: { status: 'archived' },
      });

      await logAuditEvent({
        userId: actor.userId,
        userEmail: actor.userEmail || null,
        action: 'ORGANIZATION_ARCHIVED',
        entityType: 'organization',
        entityId: archived.id,
      });

      return {
        message: 'Organization archived successfully.',
        id: archived.id,
        status: 'archived',
      };
    }

    // Hard deletion:
    // If active enrollments exist, reject hard deletion to protect payer history
    if (existing._count.enrollments > 0) {
      throw ApiError.badRequest(
        `Cannot permanently delete organization with ${existing._count.enrollments} associated payer enrollments. Archive the organization instead.`
      );
    }

    // Delete organization (only removes join table rows; provider profiles remain intact)
    await prisma.organization.delete({
      where: { id },
    });

    await logAuditEvent({
      userId: actor.userId,
      userEmail: actor.userEmail || null,
      action: 'ORGANIZATION_DELETED',
      entityType: 'organization',
      entityId: id,
      metadata: {
        name: existing.name,
        npiNumber: existing.npiNumber,
        providerCountAtDeletion: existing._count.providers,
      },
    });

    return {
      message: 'Organization deleted permanently. Associated providers remain intact.',
      id,
    };
  }

  /**
   * Associate a provider with an organization.
   * Atomically handles primary affiliation: if isPrimary=true, clears other primary affiliations for that provider.
   */
  static async associateProvider(
    organizationId: string,
    input: AssociateProviderInput,
    actor: { userId: string; userEmail?: string | null }
  ) {
    // 1. Verify organization exists and is not archived
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) {
      throw ApiError.notFound('Organization not found.');
    }
    if (org.status === 'archived') {
      throw ApiError.badRequest('Cannot associate providers with an archived organization.');
    }

    // 2. Verify provider exists
    const provider = await prisma.provider.findUnique({
      where: { id: input.providerId },
    });
    if (!provider) {
      throw ApiError.notFound('Provider not found.');
    }

    // 3. Check for existing affiliation
    const existingAffiliation = await prisma.providerOrganization.findUnique({
      where: {
        providerId_organizationId: {
          providerId: input.providerId,
          organizationId,
        },
      },
    });

    // 4. Atomic transaction
    const affiliation = await prisma.$transaction(
      async (tx) => {
        // If setting this as primary, clear any other primary affiliation for this provider
        if (input.isPrimary) {
          await tx.providerOrganization.updateMany({
            where: {
              providerId: input.providerId,
              isPrimary: true,
            },
            data: { isPrimary: false },
          });
        } else if (!existingAffiliation) {
          // If provider has no other affiliations yet, default this first one to primary
          const count = await tx.providerOrganization.count({
            where: { providerId: input.providerId },
          });
          if (count === 0) {
            input.isPrimary = true;
          }
        }

        if (existingAffiliation) {
          const updated = await tx.providerOrganization.update({
            where: {
              providerId_organizationId: {
                providerId: input.providerId,
                organizationId,
              },
            },
            data: {
              isPrimary: input.isPrimary !== undefined ? input.isPrimary : existingAffiliation.isPrimary,
              employmentType:
                input.employmentType !== undefined ? input.employmentType : existingAffiliation.employmentType,
              startDate: input.startDate ?? existingAffiliation.startDate,
              endDate: input.endDate ?? existingAffiliation.endDate,
            },
            include: {
              provider: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  npiNumber: true,
                },
              },
              organization: {
                select: {
                  id: true,
                  name: true,
                  npiNumber: true,
                },
              },
            },
          });
          return updated;
        }

        const created = await tx.providerOrganization.create({
          data: {
            providerId: input.providerId,
            organizationId,
            isPrimary: input.isPrimary,
            employmentType: input.employmentType || null,
            startDate: input.startDate || null,
            endDate: input.endDate || null,
          },
          include: {
            provider: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                npiNumber: true,
              },
            },
            organization: {
              select: {
                id: true,
                name: true,
                npiNumber: true,
              },
            },
          },
        });

        return created;
      },
      { maxWait: 10000, timeout: 15000 }
    );

    // 5. Immutable audit log
    await logAuditEvent({
      userId: actor.userId,
      userEmail: actor.userEmail || null,
      action: 'PROVIDER_AFFILIATED_WITH_ORGANIZATION',
      entityType: 'provider_organization',
      entityId: affiliation.id,
      metadata: {
        organizationId,
        organizationName: org.name,
        providerId: provider.id,
        providerName: `${provider.firstName} ${provider.lastName}`,
        isPrimary: affiliation.isPrimary,
      },
    });

    return affiliation;
  }

  /**
   * Disassociate a provider from an organization without deleting the provider profile.
   */
  static async disassociateProvider(
    organizationId: string,
    providerId: string,
    actor: { userId: string; userEmail?: string | null }
  ) {
    const existing = await prisma.providerOrganization.findUnique({
      where: {
        providerId_organizationId: {
          providerId,
          organizationId,
        },
      },
      include: {
        organization: { select: { name: true } },
        provider: { select: { firstName: true, lastName: true } },
      },
    });

    if (!existing) {
      throw ApiError.notFound('Provider is not associated with this organization.');
    }

    const wasPrimary = existing.isPrimary;

    await prisma.$transaction(async (tx) => {
      await tx.providerOrganization.delete({
        where: { id: existing.id },
      });

      // If removed affiliation was primary, elect another remaining affiliation as primary (if any exist)
      if (wasPrimary) {
        const remaining = await tx.providerOrganization.findFirst({
          where: { providerId },
          orderBy: { createdAt: 'asc' },
        });
        if (remaining) {
          await tx.providerOrganization.update({
            where: { id: remaining.id },
            data: { isPrimary: true },
          });
        }
      }
    });

    await logAuditEvent({
      userId: actor.userId,
      userEmail: actor.userEmail || null,
      action: 'PROVIDER_DISAFFILIATED_FROM_ORGANIZATION',
      entityType: 'provider_organization',
      entityId: existing.id,
      metadata: {
        organizationId,
        organizationName: existing.organization.name,
        providerId,
        providerName: `${existing.provider.firstName} ${existing.provider.lastName}`,
      },
    });

    return {
      message: 'Provider disassociated from organization successfully. Provider record preserved.',
      providerId,
      organizationId,
    };
  }
}
