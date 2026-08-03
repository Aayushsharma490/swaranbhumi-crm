import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db';
import { CryptoService } from '../services/crypto.service';
import { z } from 'zod';

export async function settingsRoutes(fastify: FastifyInstance) {
  // Authorization middleware hook - restricts access to Admin role
  fastify.addHook('preValidation', async (request: any, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const currentUser = request.user as { role: string };
      if (currentUser.role !== 'ADMIN') {
        return reply.status(403).send({ error: 'Access forbidden: Administrators only' });
      }
    } catch (err) {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  const settingsUpdateSchema = z.object({
    appId: z.string().optional(),
    appSecret: z.string().optional(),
    pageAccessToken: z.string().optional(),
    verifyToken: z.string().optional(),
    apiUrl: z.string().optional()
  });

  // GET /settings
  fastify.get('/', async () => {
    const settings = await prisma.systemSettings.findUnique({
      where: { id: 'meta_settings' }
    });

    if (!settings) {
      return {
        configured: {
          appId: false,
          appSecret: false,
          pageAccessToken: false,
          verifyToken: false,
          apiUrl: false
        },
        verifyToken: '',
        apiUrl: ''
      };
    }

    return {
      configured: {
        appId: !!settings.encryptedAppId,
        appSecret: !!settings.encryptedAppSecret,
        pageAccessToken: !!settings.encryptedPageAccessToken,
        verifyToken: !!settings.verifyToken,
        apiUrl: !!settings.apiUrl
      },
      verifyToken: settings.verifyToken || '',
      apiUrl: settings.apiUrl || '',
      lastSyncAt: settings.lastSyncAt,
      lastSyncCount: settings.lastSyncCount,
      lastSyncLeadName: settings.lastSyncLeadName
    };
  });

  // POST /settings
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = settingsUpdateSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation error', details: parseResult.error.format() });
    }

    const payload = parseResult.data;

    const existing = await prisma.systemSettings.findUnique({
      where: { id: 'meta_settings' }
    });

    const updateData: any = {};

    // Encrypt fields if supplied
    if (payload.appId) {
      updateData.encryptedAppId = CryptoService.encrypt(payload.appId);
    }
    if (payload.appSecret) {
      updateData.encryptedAppSecret = CryptoService.encrypt(payload.appSecret);
    }
    if (payload.pageAccessToken) {
      updateData.encryptedPageAccessToken = CryptoService.encrypt(payload.pageAccessToken);
    }
    if (payload.verifyToken !== undefined) {
      updateData.verifyToken = payload.verifyToken;
    }
    if (payload.apiUrl !== undefined) {
      updateData.apiUrl = payload.apiUrl;
    }

    let result;
    if (existing) {
      result = await prisma.systemSettings.update({
        where: { id: 'meta_settings' },
        data: updateData
      });
    } else {
      result = await prisma.systemSettings.create({
        data: {
          id: 'meta_settings',
          ...updateData
        }
      });
    }

    return {
      message: 'System settings updated and encrypted successfully',
      configured: {
        appId: !!result.encryptedAppId,
        appSecret: !!result.encryptedAppSecret,
        pageAccessToken: !!result.encryptedPageAccessToken,
        verifyToken: !!result.verifyToken,
        apiUrl: !!result.apiUrl
      }
    };
  });
}
