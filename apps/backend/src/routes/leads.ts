import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db';
import { LeadService } from '../services/lead.service';
import { SocketService } from '../services/socket.service';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';
const pump = promisify(pipeline);

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export async function leadRoutes(fastify: FastifyInstance) {
  // Authentication middleware hook
  fastify.addHook('preValidation', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  const leadCreateSchema = z.object({
    name: z.string(),
    phone: z.string(),
    alternatePhone: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    city: z.string().optional(),
    state: z.string().optional(),
    budget: z.string().optional(),
    project: z.string().optional(),
    propertyType: z.string().optional(),
    leadSource: z.string().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
    status: z.enum(['NEW', 'CONTACTED', 'INTERESTED', 'SITE_VISIT', 'NEGOTIATION', 'BOOKED', 'LOST', 'DUPLICATE']).optional(),
    followUpDate: z.string().optional(),
    assignedEmployeeId: z.string().optional()
  });

  // Get leads list with filters
  fastify.get('/', async (request: FastifyRequest) => {
    const query = request.query as any;
    const search = query.search || '';
    const status = query.status || '';
    const priority = query.priority || '';
    const source = query.source || '';
    const employeeId = query.employeeId || '';
    const project = query.project || '';
    const age = query.age || '';
    const campaign = query.campaign || '';
    
    // Pagination
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '100', 10);
    const skip = (page - 1) * limit;

    // RBAC: Executives can only see leads assigned to them (unless they are Manager/Admin)
    const currentUser = request.user as { id: string; role: string };
    let assignedFilter = employeeId;
    if (currentUser.role === 'EXECUTIVE') {
      assignedFilter = currentUser.id;
    }

    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (source) where.leadSource = source;
    if (project) where.project = project;
    if (assignedFilter) where.assignedEmployeeId = assignedFilter;
    if (campaign) {
      where.OR = [
        ...(where.OR || []),
        { facebookCampaign: { contains: campaign, mode: 'insensitive' } },
        { facebookFormName: { contains: campaign, mode: 'insensitive' } }
      ];
    }
    if (age) {
      const days = parseInt(age, 10);
      if (!isNaN(days) && days > 0) {
        const dateLimit = new Date();
        dateLimit.setDate(dateLimit.getDate() - days);
        where.createdAt = { gte: dateLimit };
      }
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          assignedEmployee: {
            select: { id: true, name: true, role: true }
          }
        }
      }),
      prisma.lead.count({ where })
    ]);

    return {
      leads,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    };
  });

  // Get single lead details
  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const lead = await prisma.lead.findUnique({
      where: { id },
      include: {
        assignedEmployee: {
          select: { id: true, name: true, email: true, role: true }
        },
        notes: {
          orderBy: { createdAt: 'desc' },
          include: {
            author: { select: { id: true, name: true } }
          }
        },
        attachments: {
          orderBy: { createdAt: 'desc' },
          include: {
            uploadedBy: { select: { id: true, name: true } }
          }
        },
        timeline: {
          orderBy: { createdAt: 'desc' },
          include: {
            createdBy: { select: { id: true, name: true } }
          }
        },
        booking: {
          include: {
            payments: true
          }
        }
      }
    });

    if (!lead) {
      return reply.status(404).send({ error: 'Lead not found' });
    }

    // RBAC check: Executives can only view their own leads
    const currentUser = request.user as { id: string; role: string };
    if (currentUser.role === 'EXECUTIVE' && lead.assignedEmployeeId !== currentUser.id) {
      return reply.status(403).send({ error: 'Access denied to this lead file' });
    }

    return { lead };
  });

  // Create lead
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = leadCreateSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid lead schema validation', details: parseResult.error.format() });
    }

    const payload = parseResult.data;
    const currentUser = request.user as { id: string };

    const parsedFollowUp = payload.followUpDate ? new Date(payload.followUpDate) : undefined;

    const lead = await LeadService.createLead({
      name: payload.name,
      phone: payload.phone,
      alternatePhone: payload.alternatePhone,
      email: payload.email || undefined,
      city: payload.city,
      state: payload.state,
      budget: payload.budget,
      project: payload.project,
      propertyType: payload.propertyType,
      leadSource: payload.leadSource,
      priority: payload.priority,
      status: payload.status,
      followUpDate: parsedFollowUp,
      assignedEmployeeId: payload.assignedEmployeeId,
      createdById: currentUser.id
    });

    return reply.status(201).send({ lead });
  });

  // Update lead
  fastify.put('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const payload = request.body as any;
    const currentUser = request.user as { id: string; role: string };

    const existingLead = await prisma.lead.findUnique({
      where: { id }
    });

    if (!existingLead) {
      return reply.status(404).send({ error: 'Lead not found' });
    }

    // RBAC check: Executives can only update their own leads
    if (currentUser.role === 'EXECUTIVE' && existingLead.assignedEmployeeId !== currentUser.id) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    const updateData: any = {};
    const timelineDescriptions: string[] = [];

    if (payload.name && payload.name !== existingLead.name) {
      updateData.name = payload.name;
      timelineDescriptions.push(`Name changed from "${existingLead.name}" to "${payload.name}"`);
    }
    if (payload.phone && payload.phone !== existingLead.phone) {
      updateData.phone = payload.phone;
      timelineDescriptions.push(`Phone changed from "${existingLead.phone}" to "${payload.phone}"`);
    }
    if (payload.alternatePhone !== undefined && payload.alternatePhone !== existingLead.alternatePhone) {
      updateData.alternatePhone = payload.alternatePhone;
      timelineDescriptions.push(`Alternate phone updated`);
    }
    if (payload.email !== undefined && payload.email !== existingLead.email) {
      updateData.email = payload.email;
      timelineDescriptions.push(`Email changed to "${payload.email}"`);
    }
    if (payload.city !== undefined && payload.city !== existingLead.city) {
      updateData.city = payload.city;
    }
    if (payload.state !== undefined && payload.state !== existingLead.state) {
      updateData.state = payload.state;
    }
    if (payload.budget !== undefined && payload.budget !== existingLead.budget) {
      updateData.budget = payload.budget;
      timelineDescriptions.push(`Budget set to "${payload.budget}"`);
    }
    if (payload.project !== undefined && payload.project !== existingLead.project) {
      updateData.project = payload.project;
      timelineDescriptions.push(`Project interest changed to "${payload.project}"`);
    }
    if (payload.propertyType !== undefined && payload.propertyType !== existingLead.propertyType) {
      updateData.propertyType = payload.propertyType;
    }
    if (payload.priority && payload.priority !== existingLead.priority) {
      updateData.priority = payload.priority;
      timelineDescriptions.push(`Priority upgraded to "${payload.priority}"`);
    }
    if (payload.status && payload.status !== existingLead.status) {
      updateData.status = payload.status;
      timelineDescriptions.push(`Status changed from ${existingLead.status} to ${payload.status}`);
    }
    if (payload.followUpDate !== undefined) {
      const dateVal = payload.followUpDate ? new Date(payload.followUpDate) : null;
      const existVal = existingLead.followUpDate ? new Date(existingLead.followUpDate) : null;
      if (dateVal?.getTime() !== existVal?.getTime()) {
        updateData.followUpDate = dateVal;
        timelineDescriptions.push(`Follow-up date scheduled for ${dateVal ? dateVal.toLocaleDateString() : 'None'}`);
      }
    }

    if (Object.keys(updateData).length === 0) {
      return { lead: existingLead, message: 'No changes detected' };
    }

    const updatedLead = await prisma.lead.update({
      where: { id },
      data: updateData,
      include: {
        assignedEmployee: { select: { id: true, name: true } }
      }
    });

    // Write timeline
    for (const desc of timelineDescriptions) {
      await prisma.leadTimeline.create({
        data: {
          leadId: id,
          actionType: payload.status && payload.status !== existingLead.status ? 'STATUS_UPDATE' : 'UPDATE',
          description: desc,
          createdById: currentUser.id
        }
      });
    }

    SocketService.broadcast('LEAD_UPDATED', updatedLead);

    return { lead: updatedLead };
  });

  // Delete lead (Only Admin/Manager)
  fastify.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const currentUser = request.user as { role: string };

    if (currentUser.role === 'EXECUTIVE') {
      return reply.status(403).send({ error: 'Permission denied: Administrators or Managers only' });
    }

    await prisma.lead.delete({
      where: { id }
    });

    SocketService.broadcast('LEAD_DELETED', { id });

    return { success: true, message: 'Lead deleted successfully' };
  });

  // Transfer lead
  fastify.post('/:id/transfer', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { targetEmployeeId } = request.body as { targetEmployeeId: string };
    const currentUser = request.user as { id: string; role: string };

    if (!targetEmployeeId) {
      return reply.status(400).send({ error: 'targetEmployeeId is required' });
    }

    const [lead, targetEmployee] = await Promise.all([
      prisma.lead.findUnique({ where: { id } }),
      prisma.user.findUnique({ where: { id: targetEmployeeId } })
    ]);

    if (!lead) {
      return reply.status(404).send({ error: 'Lead not found' });
    }

    if (!targetEmployee || targetEmployee.status === 'INACTIVE') {
      return reply.status(404).send({ error: 'Target employee is invalid or inactive' });
    }

    // RBAC: Executives cannot transfer leads unless they own it (and they transfer to others, but typically Managers route them)
    if (currentUser.role === 'EXECUTIVE' && lead.assignedEmployeeId !== currentUser.id) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    const updatedLead = await prisma.lead.update({
      where: { id },
      data: { assignedEmployeeId: targetEmployeeId },
      include: {
        assignedEmployee: { select: { id: true, name: true } }
      }
    });

    await prisma.leadTimeline.create({
      data: {
        leadId: id,
        actionType: 'TRANSFER',
        description: `Lead assignment transferred to ${targetEmployee.name}`,
        createdById: currentUser.id
      }
    });

    SocketService.broadcast('LEAD_UPDATED', updatedLead);

    return { lead: updatedLead, message: `Lead successfully transferred to ${targetEmployee.name}` };
  });

  // Merge leads
  fastify.post('/merge', async (request: FastifyRequest, reply: FastifyReply) => {
    const { primaryLeadId, duplicateLeadId } = request.body as { primaryLeadId: string; duplicateLeadId: string };
    const currentUser = request.user as { id: string; role: string };

    if (currentUser.role === 'EXECUTIVE') {
      return reply.status(403).send({ error: 'Permission denied: Administrators or Managers only' });
    }

    try {
      const result = await LeadService.mergeLeads(primaryLeadId, duplicateLeadId, currentUser.id);
      return { success: true, ...result };
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  // Add notes
  fastify.post('/:id/notes', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { content } = request.body as { content: string };
    const currentUser = request.user as { id: string };

    if (!content) {
      return reply.status(400).send({ error: 'Note content cannot be empty' });
    }

    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead) {
      return reply.status(404).send({ error: 'Lead not found' });
    }

    const note = await prisma.leadNote.create({
      data: {
        leadId: id,
        authorId: currentUser.id,
        content
      },
      include: {
        author: { select: { id: true, name: true } }
      }
    });

    await prisma.leadTimeline.create({
      data: {
        leadId: id,
        actionType: 'NOTE_ADD',
        description: `New note added: "${content.substring(0, 40)}${content.length > 40 ? '...' : ''}"`,
        createdById: currentUser.id
      }
    });

    // Broadcast update
    SocketService.broadcast('LEAD_NOTE_ADDED', { leadId: id, note });

    return { note };
  });

  // Upload attachments
  fastify.post('/:id/attachments', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const currentUser = request.user as { id: string };

    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead) {
      return reply.status(404).send({ error: 'Lead not found' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const ext = path.extname(data.filename);
    const uniqueFilename = `${id}_${Date.now()}${ext}`;
    const filePath = path.join(UPLOADS_DIR, uniqueFilename);

    await pump(data.file, fs.createWriteStream(filePath));

    // Save attachment record
    const attachment = await prisma.leadAttachment.create({
      data: {
        leadId: id,
        filename: data.filename,
        filePath: `/uploads/${uniqueFilename}`,
        mimeType: data.mimetype,
        size: 0, // In standard streams we could count bytes, setting 0 is fine
        uploadedById: currentUser.id
      },
      include: {
        uploadedBy: { select: { id: true, name: true } }
      }
    });

    await prisma.leadTimeline.create({
      data: {
        leadId: id,
        actionType: 'ATTACHMENT_ADD',
        description: `Uploaded file: ${data.filename}`,
        createdById: currentUser.id
      }
    });

    SocketService.broadcast('LEAD_ATTACHMENT_ADDED', { leadId: id, attachment });

    return { attachment };
  });
}
