import { prisma } from '../db';
import { SocketService } from './socket.service';
export type LeadStatus = 'NEW' | 'CONTACTED' | 'INTERESTED' | 'SITE_VISIT' | 'NEGOTIATION' | 'BOOKED' | 'LOST' | 'DUPLICATE';
export type LeadPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export class LeadService {
  /**
   * Automatically assigns a lead to an active executive using the least-workload algorithm.
   */
  public static async autoAssignLead(): Promise<string | null> {
    // 1. Get all active executives
    const executives = await prisma.user.findMany({
      where: {
        role: 'EXECUTIVE',
        status: 'ACTIVE'
      },
      select: {
        id: true,
        _count: {
          select: {
            assignedLeads: {
              where: {
                status: {
                  in: ['NEW', 'CONTACTED', 'INTERESTED', 'SITE_VISIT', 'NEGOTIATION']
                }
              }
            }
          }
        }
      }
    });

    if (executives.length === 0) {
      // Fallback: search for managers if no executives are active
      const managers = await prisma.user.findMany({
        where: {
          role: 'MANAGER',
          status: 'ACTIVE'
        },
        select: { id: true }
      });
      if (managers.length === 0) return null;
      // Assign to the first manager
      return managers[0].id;
    }

    // 2. Find the executive with the least active leads
    executives.sort((a: any, b: any) => a._count.assignedLeads - b._count.assignedLeads);
    return executives[0].id;
  }

  /**
   * Creates a lead, detects duplicates, runs auto-assignment if needed, and files a timeline log.
   */
  public static async createLead(data: {
    name: string;
    phone: string;
    alternatePhone?: string;
    email?: string;
    city?: string;
    state?: string;
    budget?: string;
    project?: string;
    propertyType?: string;
    leadSource?: string;
    facebookCampaign?: string;
    facebookAdSet?: string;
    facebookAd?: string;
    facebookFormName?: string;
    facebookLeadId?: string;
    priority?: LeadPriority;
    status?: LeadStatus;
    followUpDate?: Date;
    assignedEmployeeId?: string;
    createdById: string; // The user creating the lead (or system user ID)
    createdAt?: Date;
  }) {
    // 1. Check if duplicate phone exists
    const duplicate = await prisma.lead.findFirst({
      where: {
        phone: data.phone,
        status: { not: 'DUPLICATE' }
      }
    });

    let status = data.status || 'NEW';
    if (duplicate) {
      status = 'DUPLICATE';
    }

    // 2. Auto-assign if not provided
    let assignedId = data.assignedEmployeeId;
    if (!assignedId && status !== 'DUPLICATE') {
      assignedId = (await this.autoAssignLead()) || undefined;
    }

    // 3. Create lead
    const newLead = await prisma.lead.create({
      data: {
        name: data.name,
        phone: data.phone,
        alternatePhone: data.alternatePhone,
        email: data.email,
        city: data.city,
        state: data.state,
        budget: data.budget,
        project: data.project,
        propertyType: data.propertyType,
        leadSource: data.leadSource || 'DIRECT',
        facebookCampaign: data.facebookCampaign,
        facebookAdSet: data.facebookAdSet,
        facebookAd: data.facebookAd,
        facebookFormName: data.facebookFormName,
        facebookLeadId: data.facebookLeadId,
        priority: data.priority || 'MEDIUM',
        status: status,
        followUpDate: data.followUpDate,
        assignedEmployeeId: assignedId,
        createdAt: data.createdAt
      },
      include: {
        assignedEmployee: {
          select: { id: true, name: true, email: true }
        }
      }
    });

    // 4. Log to timeline
    await prisma.leadTimeline.create({
      data: {
        leadId: newLead.id,
        actionType: 'CREATE',
        description: `Lead created from source: ${newLead.leadSource}. Assigned to ${newLead.assignedEmployee?.name || 'Unassigned'}.`,
        createdById: data.createdById
      }
    });

    // 5. If auto-assigned, create assign timeline log
    if (assignedId && status !== 'DUPLICATE') {
      await prisma.leadTimeline.create({
        data: {
          leadId: newLead.id,
          actionType: 'ASSIGN',
          description: `Automatically assigned to ${newLead.assignedEmployee?.name || 'Sales Representative'}.`,
          createdById: data.createdById
        }
      });
    }

    // 6. Broadcast socket update
    SocketService.broadcast('LEAD_CREATED', newLead);

    return newLead;
  }

  /**
   * Merges a duplicate lead into a primary lead, moves all notes/attachments, and sets status to DUPLICATE.
   */
  public static async mergeLeads(primaryLeadId: string, duplicateLeadId: string, userId: string) {
    if (primaryLeadId === duplicateLeadId) {
      throw new Error('Cannot merge a lead into itself.');
    }

    const primary = await prisma.lead.findUnique({ where: { id: primaryLeadId } });
    const duplicate = await prisma.lead.findUnique({ where: { id: duplicateLeadId } });

    if (!primary || !duplicate) {
      throw new Error('One or both leads do not exist.');
    }

    // 1. Move notes
    await prisma.leadNote.updateMany({
      where: { leadId: duplicateLeadId },
      data: { leadId: primaryLeadId }
    });

    // 2. Move attachments
    await prisma.leadAttachment.updateMany({
      where: { leadId: duplicateLeadId },
      data: { leadId: primaryLeadId }
    });

    // 3. Mark duplicate lead as duplicate status
    const updatedDuplicate = await prisma.lead.update({
      where: { id: duplicateLeadId },
      data: {
        status: 'DUPLICATE',
        assignedEmployeeId: null
      }
    });

    // 4. Create timeline audits
    await prisma.leadTimeline.create({
      data: {
        leadId: primaryLeadId,
        actionType: 'MERGE',
        description: `Lead merged: duplicate lead ${duplicate.name} (${duplicate.phone}) was merged into this lead.`,
        createdById: userId
      }
    });

    await prisma.leadTimeline.create({
      data: {
        leadId: duplicateLeadId,
        actionType: 'STATUS_UPDATE',
        description: `Lead marked as Duplicate and merged into primary lead ${primary.name} (${primary.phone}).`,
        createdById: userId
      }
    });

    // 5. Broadcast changes
    SocketService.broadcast('LEAD_UPDATED', primary);
    SocketService.broadcast('LEAD_UPDATED', updatedDuplicate);

    return { primary, duplicate: updatedDuplicate };
  }
}
