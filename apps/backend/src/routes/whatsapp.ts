import { FastifyInstance } from 'fastify';
import { prisma } from '../db';
import { WhatsappService } from '../services/whatsapp.service';
import { WhatsappQueueService } from '../services/whatsapp-queue.service';
import { z } from 'zod';

export default async function whatsappRoutes(fastify: FastifyInstance) {
  // GET Settings
  fastify.get('/settings', async (request, reply) => {
    const settings = await prisma.whatsappSettings.findUnique({
      where: { id: 'default' }
    });
    return settings || {};
  });

  // POST Settings
  fastify.post('/settings', async (request, reply) => {
    const schema = z.object({
      accessToken: z.string(),
      phoneNumberId: z.string(),
      wabaId: z.string()
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid data' });
    }

    const data = parsed.data;
    const settings = await prisma.whatsappSettings.upsert({
      where: { id: 'default' },
      update: data,
      create: { id: 'default', ...data }
    });

    return settings;
  });

  // GET Templates
  fastify.get('/templates', async (request, reply) => {
    try {
      const templates = await WhatsappService.fetchTemplates();
      return templates;
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // GET Campaigns History
  fastify.get('/campaigns', async (request, reply) => {
    const campaigns = await prisma.whatsappCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        _count: {
          select: { logs: true }
        }
      }
    });
    return campaigns;
  });

  // GET Pending Campaigns
  fastify.get('/campaign/pending', async (request, reply) => {
    const pendingCampaign = await prisma.whatsappCampaign.findFirst({
      where: { paymentStatus: 'PENDING' },
      orderBy: { createdAt: 'desc' }
    });
    return { pending: !!pendingCampaign, campaign: pendingCampaign };
  });

  // POST Mark Campaign as Paid (Unlock)
  fastify.post('/campaign/pay', async (request, reply) => {
    const schema = z.object({
      campaignId: z.string(),
      paymentProof: z.string().optional()
    });
    
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid data' });

    const campaign = await prisma.whatsappCampaign.update({
      where: { id: parsed.data.campaignId },
      data: {
        paymentStatus: 'PAID',
        paymentProof: parsed.data.paymentProof
      }
    });

    return { success: true, message: 'Campaign unlocked successfully', campaign };
  });

  // POST Adjust Campaign Cost / Numbers (Manual Override or Fix)
  fastify.post('/campaign/adjust-cost', async (request, reply) => {
    const schema = z.object({
      campaignId: z.string(),
      costAmount: z.number().optional(),
      sentCount: z.number().optional(),
      failedCount: z.number().optional(),
      status: z.string().optional(),
      paymentStatus: z.string().optional()
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid data' });

    const { campaignId, ...updateData } = parsed.data;
    const campaign = await prisma.whatsappCampaign.update({
      where: { id: campaignId },
      data: updateData
    });

    return { success: true, message: 'Campaign updated successfully', campaign };
  });

  // POST Recalculate Campaign Stats from Message Logs
  fastify.post('/campaign/recalculate', async (request, reply) => {
    const schema = z.object({
      campaignId: z.string(),
      perMessageRate: z.number().default(0.20)
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid data' });

    const { campaignId, perMessageRate } = parsed.data;

    const logs = await prisma.whatsappMessageLog.findMany({
      where: { campaignId }
    });

    const sentLogs = logs.filter(l => ['SENT', 'DELIVERED', 'READ'].includes(l.status));
    const failedLogs = logs.filter(l => l.status === 'FAILED');
    const actualSentCount = sentLogs.length;
    const actualFailedCount = failedLogs.length;
    const computedCost = Number((actualSentCount * perMessageRate).toFixed(2));

    const updatedCampaign = await prisma.whatsappCampaign.update({
      where: { id: campaignId },
      data: {
        sentCount: actualSentCount,
        failedCount: actualFailedCount,
        costAmount: computedCost,
        status: (actualSentCount + actualFailedCount >= logs.length && logs.length > 0) ? 'COMPLETED' : undefined
      }
    });

    return { success: true, campaign: updatedCampaign };
  });

  // DELETE Campaign by ID (Cascade deletes all logs)
  fastify.delete('/campaign/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await prisma.whatsappCampaign.delete({
        where: { id }
      });
      return { success: true, message: 'Campaign deleted successfully' };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST Clean Campaigns by Pattern (e.g. micchami)
  fastify.post('/campaign/clean', async (request, reply) => {
    const { pattern = 'micchami' } = (request.body as { pattern?: string }) || {};
    try {
      const deleted = await prisma.whatsappCampaign.deleteMany({
        where: {
          OR: [
            { name: { contains: pattern, mode: 'insensitive' } },
            { templateName: { contains: pattern, mode: 'insensitive' } }
          ]
        }
      });
      return { success: true, count: deleted.count, message: `Successfully deleted ${deleted.count} campaign(s)` };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST Create Campaign (Accepts JSON list of recipients from Frontend)
  fastify.post('/campaign/create', async (request, reply) => {
    const schema = z.object({
      campaignName: z.string(),
      templateName: z.string(),
      templateLang: z.string().default('en'),
      imageUrl: z.string().optional(),
      recipients: z.array(z.object({
        phone: z.string(),
        leadId: z.string().optional()
      }))
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid data format' });
    }

    const { campaignName, templateName, templateLang, imageUrl, recipients } = parsed.data;

    if (recipients.length === 0) {
      return reply.status(400).send({ error: 'No recipients provided' });
    }

    // 0. Check if there are any unpaid campaigns
    const unpaidCampaign = await prisma.whatsappCampaign.findFirst({
      where: { paymentStatus: 'PENDING' }
    });

    if (unpaidCampaign) {
      return reply.status(403).send({ error: 'Previous campaign service charge is pending. Please clear dues to start a new campaign.' });
    }

    // 1. Create Campaign in DB (Cost starts at 0 and increments with actual successful sends)
    const campaign = await prisma.whatsappCampaign.create({
      data: {
        name: campaignName,
        templateName,
        templateLang,
        status: 'PROCESSING',
        totalRecipients: recipients.length,
        costAmount: 0,
        paymentStatus: 'PENDING'
      }
    });

    // 2. Create Message Logs (QUEUED) and Add to BullMQ
    for (const recipient of recipients) {
      const log = await prisma.whatsappMessageLog.create({
        data: {
          campaignId: campaign.id,
          phone: recipient.phone,
          leadId: recipient.leadId,
          status: 'QUEUED'
        }
      });

      // Add to BullMQ Queue
      await WhatsappQueueService.addToQueue({
        campaignId: campaign.id,
        phone: recipient.phone,
        templateName,
        templateLang,
        logId: log.id,
        imageUrl
      });
    }

    return { success: true, campaignId: campaign.id, message: 'Campaign started successfully' };
  });

  // =====================
  // WHATSAPP CHAT INBOX
  // =====================

  // GET /chat/contacts
  fastify.get('/chat/contacts', async (request, reply) => {
    const contacts = await prisma.whatsappContact.findMany({
      orderBy: { lastMessageAt: 'desc' },
      take: 50,
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    });
    return contacts;
  });

  // GET /chat/messages/:phone
  fastify.get('/chat/messages/:phone', async (request: any, reply) => {
    const { phone } = request.params;
    const contact = await prisma.whatsappContact.findUnique({
      where: { phone }
    });

    if (!contact) {
      return [];
    }

    const messages = await prisma.whatsappChatMessage.findMany({
      where: { contactId: contact.id },
      orderBy: { createdAt: 'asc' },
      take: 100
    });

    return messages;
  });

  // POST /chat/send
  fastify.post('/chat/send', async (request, reply) => {
    const schema = z.object({
      phone: z.string(),
      text: z.string()
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid data' });
    }

    const { phone, text } = parsed.data;

    try {
      const response = await WhatsappService.sendDirectMessage(phone, text);

      // Save to database
      const contact = await prisma.whatsappContact.upsert({
        where: { phone },
        update: { lastMessageAt: new Date() },
        create: { phone, name: 'Unknown' } // Customer name is fetched on inbound
      });

      const msg = await prisma.whatsappChatMessage.create({
        data: {
          contactId: contact.id,
          direction: 'OUTBOUND',
          type: 'text',
          content: text,
          messageId: response.messageId,
          status: 'SENT'
        }
      });

      return { success: true, message: msg };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /chat/mark-read/:phone
  fastify.post('/chat/mark-read/:phone', async (request: any, reply) => {
    const { phone } = request.params;
    await prisma.whatsappContact.update({
      where: { phone },
      data: { unreadCount: 0 }
    });
    return { success: true };
  });
}
