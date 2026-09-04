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

    // 1. Create Campaign in DB
    const cost = recipients.length * 0.20;
    
    const campaign = await prisma.whatsappCampaign.create({
      data: {
        name: campaignName,
        templateName,
        templateLang,
        status: 'PROCESSING',
        totalRecipients: recipients.length,
        costAmount: cost,
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
}
