import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import dotenv from 'dotenv';
import path from 'path';

// Load Environment variables
dotenv.config();

// Imports routing modules
import { authRoutes } from './routes/auth';
import { leadRoutes } from './routes/leads';
import { employeeRoutes } from './routes/employees';
import { customerRoutes } from './routes/customers';
import { reportRoutes } from './routes/reports';
import { metaRoutes } from './routes/meta';
import { settingsRoutes } from './routes/settings';
import whatsappRoutes from './routes/whatsapp';

// Services & Queues
import { SocketService } from './services/socket.service';
import { apiLogger, errorLogger, metaLogger } from './services/logger.service';
import { MetaService } from './services/meta.service';
import { WhatsappQueueService } from './services/whatsapp-queue.service';
import { redisConnection } from './queues/lead.queue';
import { prisma } from './db';

const fastify = Fastify({
  logger: false // We use our own custom Winston logger for standardized enterprise output
});

const PORT = parseInt(process.env.PORT || '5000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Register CORS
fastify.register(cors, {
  origin: true, // Configurable per request origin in desktop development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
});

// Register Helmet Security Headers
fastify.register(helmet, {
  contentSecurityPolicy: false // Disabled for Electron index loading compatibility
});

// Register JWT
fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'swaranbhumi_super_secret_jwt_access_token_key_2026_xyz'
});

// Register Rate Limiter
fastify.register(rateLimit, {
  max: 1000,
  timeWindow: '1 minute'
});

// Register Multipart (File uploads)
fastify.register(multipart, {
  limits: {
    fieldNameSize: 100,
    fieldSize: 1000000,
    fields: 10,
    fileSize: 10485760, // 10MB
    files: 1
  }
});

// Register Static File Serving for lead documents
const uploadsPath = path.join(__dirname, '../uploads');
fastify.register(fastifyStatic, {
  root: uploadsPath,
  prefix: '/uploads/'
});

// Register Swagger OpenAPI Spec
fastify.register(swagger, {
  swagger: {
    info: {
      title: 'Swaranbhumi CRM REST API',
      description: 'Production REST API endpoints specifications for CRM lead, employee and payment databases.',
      version: '1.0.0'
    },
    host: 'api.swaranbhumi.com',
    schemes: ['https', 'http'],
    consumes: ['application/json'],
    produces: ['application/json'],
    securityDefinitions: {
      BearerAuth: {
        type: 'apiKey',
        name: 'Authorization',
        in: 'header'
      }
    }
  }
});

// Register Swagger UI
fastify.register(swaggerUi, {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: false
  }
});

// Audit log hook for every request
fastify.addHook('onRequest', async (request) => {
  apiLogger.info(`API Hit: ${request.method} ${request.url} | RemoteIP: ${request.ip}`);
});

// GET /health check
fastify.get('/health', async (request, reply) => {
  try {
    // Audit postgres connection
    await prisma.$queryRaw`SELECT 1`;

    // Audit Redis state
    const redisStatus = redisConnection.status;

    return {
      status: 'OK',
      timestamp: new Date().toISOString(),
      services: {
        database: 'CONNECTED',
        redisQueue: redisStatus === 'ready' ? 'READY' : redisStatus
      }
    };
  } catch (err: any) {
    errorLogger.error(`System healthcheck failed: ${err.message}`, { stack: err.stack });
    return reply.status(503).send({
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      details: err.message
    });
  }
});

// Register Business Routes
fastify.register(authRoutes, { prefix: '/auth' });
fastify.register(leadRoutes, { prefix: '/leads' });
fastify.register(employeeRoutes, { prefix: '/employees' });
fastify.register(customerRoutes, { prefix: '/customers' });
fastify.register(reportRoutes, { prefix: '/reports' });
fastify.register(metaRoutes, { prefix: '/meta' });
fastify.register(settingsRoutes, { prefix: '/settings' });
fastify.register(whatsappRoutes, { prefix: '/whatsapp' });

// Global Error Handler
fastify.setErrorHandler((error: any, request, reply) => {
  errorLogger.error(`API Exception caught: ${error.message}`, { 
    stack: error.stack,
    url: request.url,
    method: request.method
  });

  if (error.validation) {
    return reply.status(400).send({
      error: 'ValidationFailure',
      message: error.message,
      details: error.validation
    });
  }
  if (error.statusCode) {
    return reply.status(error.statusCode).send({ error: error.name, message: error.message });
  }
  return reply.status(500).send({ 
    error: 'InternalServerError', 
    message: 'An unexpected database or processing error occurred' 
  });
});

// Boot Server
const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: HOST });
    
    // Attach Socket.IO to the Fastify instance
    SocketService.initialize(fastify);

    // Initialize Background Queues
    WhatsappQueueService.initialize();

    // Startup health check for Meta API Integration
    MetaService.checkMetaApiHealth().then((health) => {
      metaLogger.info(`Meta API Startup Health Check completed: ${health.status} - ${health.message}`);
    }).catch((err) => {
      errorLogger.error(`Meta API Startup Health Check failed: ${err.message}`, { stack: err.stack });
    });

    // Run 10-minute periodic token validation check
    setInterval(() => {
      metaLogger.info('Triggering periodic 10-minute Meta API token status validation check...');
      MetaService.checkMetaApiHealth().catch((err) => {
        errorLogger.error(`Meta API Periodic Token Validation failed: ${err.message}`, { stack: err.stack });
      });
    }, 10 * 60 * 1000); // 10 minutes

    console.log(`Swaranbhumi Fastify REST API running on http://localhost:${PORT}`);
    console.log(`Swagger documentation available at http://localhost:${PORT}/docs`);
  } catch (err: any) {
    errorLogger.error(`Fatal bootstrap error: ${err.message}`, { stack: err.stack });
    process.exit(1);
  }
};

start();
