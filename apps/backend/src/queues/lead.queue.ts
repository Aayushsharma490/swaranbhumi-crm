import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { MetaService } from '../services/meta.service';
import { metaLogger, errorLogger } from '../services/logger.service';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
export const redisConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null // Required by BullMQ
});

// Configure Lead queue
export const leadQueue = new Queue('meta-lead-queue', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3, // Auto-retry 3 times on failure
    backoff: {
      type: 'exponential',
      delay: 5000 // Start with 5s delay, then 10s, 20s...
    },
    removeOnComplete: true, // Auto clean completed tasks
    removeOnFail: false    // Keep failed tasks for DLQ analysis
  }
});

/**
 * Pushes incoming leadgen webhook task to Redis queue for background execution.
 */
export async function addLeadToQueue(
  leadgenId: string,
  pageId: string,
  formId: string,
  adId?: string,
  createdTime?: number
) {
  metaLogger.info(`Enqueueing lead webhook job: leadgenId=${leadgenId}`);
  await leadQueue.add('process_meta_lead', {
    leadgenId,
    pageId,
    formId,
    adId,
    createdTime
  });
}

// Background Worker Processor
const leadWorker = new Worker(
  'meta-lead-queue',
  async (job: Job) => {
    const { leadgenId, pageId, formId, adId, createdTime } = job.data;
    metaLogger.info(`Processing background job ${job.id} for leadgenId=${leadgenId}`);
    
    // Fetch Graph API, save to DB, assign, and broadcast updates
    await MetaService.processWebhookLead(leadgenId, pageId, formId, adId, createdTime);
  },
  {
    connection: redisConnection,
    concurrency: 5 // Process up to 5 lead items concurrently
  }
);

// Worker Event Hooks (Log status and handle Dead Letter Queue falls)
leadWorker.on('completed', (job: Job) => {
  metaLogger.info(`Background leadgen job completed successfully: JobID=${job.id}, LeadgenID=${job.data.leadgenId}`);
});

leadWorker.on('failed', (job: Job | undefined, err: Error) => {
  if (!job) return;

  const attemptsMade = job.attemptsMade || 0;
  metaLogger.warn(`Background leadgen job failed: JobID=${job.id}, Attempt=${attemptsMade}/3. Error: ${err.message}`);

  // Dead Letter Queue (DLQ) mapping
  if (attemptsMade >= 3) {
    errorLogger.error(`[DEAD LETTER QUEUE] Leadgen job permanently failed after 3 attempts. Target details moved to DLQ. Payload: ${JSON.stringify(job.data)}. Error: ${err.message}`);
    
    // Create local file-based DLQ record in logs directory
    const dlqLogPath = require('path').join(__dirname, '../../logs/meta_dlq.log');
    const dlqRecord = {
      timestamp: new Date().toISOString(),
      jobId: job.id,
      payload: job.data,
      attempts: attemptsMade,
      error: err.message,
      stack: err.stack
    };
    
    try {
      require('fs').appendFileSync(dlqLogPath, JSON.stringify(dlqRecord) + '\n', 'utf8');
    } catch (e: any) {
      errorLogger.error(`Failed to write to DLQ log file: ${e.message}`);
    }
  }
});
