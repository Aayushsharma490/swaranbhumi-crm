import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from '../db';
import { WhatsappService } from './whatsapp.service';
import { errorLogger, metaLogger } from './logger.service';

// Use a shared Redis connection if possible, or create a new one
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null
});

export const whatsappQueue = new Queue('whatsapp-marketing-queue', { connection });

interface WhatsappJobData {
  campaignId: string;
  phone: string;
  templateName: string;
  templateLang: string;
  logId: string;
  imageUrl?: string;
}

export class WhatsappQueueService {
  private static worker: Worker;

  public static initialize() {
    this.worker = new Worker(
      'whatsapp-marketing-queue',
      async (job: Job<WhatsappJobData>) => {
        const { campaignId, phone, templateName, templateLang, logId, imageUrl } = job.data;
        try {
          // Send message via Meta API
          const result = await WhatsappService.sendTemplateMessage(phone, templateName, templateLang, imageUrl);

          // Update log to SENT
          await prisma.whatsappMessageLog.update({
            where: { id: logId },
            data: {
              status: 'SENT',
              messageId: result.messageId
            }
          });

          // Increment success count in Campaign
          await prisma.whatsappCampaign.update({
            where: { id: campaignId },
            data: { sentCount: { increment: 1 } }
          });

        } catch (error: any) {
          errorLogger.error(`Job ${job.id} failed: ${error.message}`);
          
          // Update log to FAILED
          await prisma.whatsappMessageLog.update({
            where: { id: logId },
            data: {
              status: 'FAILED',
              errorMessage: error.message
            }
          });

          // Increment failure count in Campaign
          await prisma.whatsappCampaign.update({
            where: { id: campaignId },
            data: { failedCount: { increment: 1 } }
          });

          throw error; // Rethrow so BullMQ knows it failed
        }
      },
      {
        connection,
        concurrency: 5, // Process 5 messages concurrently
        limiter: {
          max: 50,      // Max 50 messages
          duration: 1000 // per 1 second (Rate limiting to avoid Meta bans)
        }
      }
    );

    this.worker.on('completed', (job) => {
      metaLogger.info(`WhatsApp Job ${job.id} completed successfully`);
    });

    this.worker.on('failed', (job, err) => {
      metaLogger.error(`WhatsApp Job ${job?.id} failed with error: ${err.message}`);
    });

    metaLogger.info('WhatsappQueueService Worker Initialized');
  }

  public static async addToQueue(data: WhatsappJobData) {
    await whatsappQueue.add('send-template', data, {
      removeOnComplete: true, // Don't keep completed jobs in Redis to save memory
      attempts: 2,
      backoff: {
        type: 'exponential',
        delay: 5000 // Retry after 5s if failed
      }
    });
  }
}
