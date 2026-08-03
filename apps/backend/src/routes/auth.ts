import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db';
import { AuthService } from '../services/auth.service';
import { z } from 'zod';
import { authLogger } from '../services/logger.service';

export async function authRoutes(fastify: FastifyInstance) {
  // Login Schema validation
  const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6)
  });

  // Change Password Schema validation
  const changePasswordSchema = z.object({
    currentPassword: z.string(),
    newPassword: z.string().min(6)
  });

  // Login
  fastify.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = loginSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid input fields', details: parseResult.error.format() });
    }

    const { email, password } = parseResult.data;

    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user || user.status === 'INACTIVE') {
      authLogger.warn(`Unauthorized login attempt (User inactive or missing): ${email}`);
      return reply.status(401).send({ error: 'Invalid credentials or inactive account' });
    }

    const isMatch = await AuthService.comparePassword(password, user.passwordHash);
    if (!isMatch) {
      authLogger.warn(`Unauthorized login attempt (Wrong password): ${email}`);
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // Sign Access Token (valid for 1 hour)
    const accessToken = fastify.jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      { expiresIn: '1h' }
    );

    // Sign Refresh Token (valid for 7 days)
    const refreshToken = fastify.jwt.sign(
      { id: user.id },
      { expiresIn: '7d' }
    );

    await AuthService.updateRefreshToken(user.id, refreshToken);

    authLogger.info(`Successful login: ${user.email} (${user.role})`);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status
      },
      accessToken,
      refreshToken
    };
  });

  // Refresh Token
  fastify.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const { refreshToken } = request.body as { refreshToken: string };
    if (!refreshToken) {
      return reply.status(400).send({ error: 'Refresh token is required' });
    }

    try {
      const decoded = fastify.jwt.verify(refreshToken) as { id: string };
      const user = await prisma.user.findUnique({
        where: { id: decoded.id }
      });

      if (!user || user.refreshToken !== refreshToken || user.status === 'INACTIVE') {
        return reply.status(401).send({ error: 'Invalid refresh token session' });
      }

      // Generate new tokens
      const newAccessToken = fastify.jwt.sign(
        { id: user.id, name: user.name, email: user.email, role: user.role },
        { expiresIn: '1h' }
      );

      const newRefreshToken = fastify.jwt.sign(
        { id: user.id },
        { expiresIn: '7d' }
      );

      await AuthService.updateRefreshToken(user.id, newRefreshToken);

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      };
    } catch (error) {
      return reply.status(401).send({ error: 'Expired or invalid token verification' });
    }
  });

  // Route group that requires auth
  fastify.register(async (authGroup) => {
    authGroup.addHook('preValidation', async (request: any, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.status(401).send({ error: 'Unauthorized credentials' });
      }
    });

    // Get Active User Profile
    authGroup.get('/me', async (request: any) => {
      const jwtUser = request.user as { id: string };
      const user = await prisma.user.findUnique({
        where: { id: jwtUser.id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          createdAt: true
        }
      });
      return { user };
    });

    // Change Password
    authGroup.post('/change-password', async (request: any, reply: FastifyReply) => {
      const parseResult = changePasswordSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ error: 'Invalid schema', details: parseResult.error.format() });
      }

      const { currentPassword, newPassword } = parseResult.data;
      const jwtUser = request.user as { id: string };

      const user = await prisma.user.findUnique({
        where: { id: jwtUser.id }
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const isMatch = await AuthService.comparePassword(currentPassword, user.passwordHash);
      if (!isMatch) {
        return reply.status(400).send({ error: 'Incorrect current password' });
      }

      const newPasswordHash = await AuthService.hashPassword(newPassword);

      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: newPasswordHash }
      });

      authLogger.info(`Password modified successfully for: ${user.email}`);
      return { message: 'Password updated successfully' };
    });

    // Update User Profile Details (Name / Email)
    authGroup.put('/update-profile', async (request: any, reply: FastifyReply) => {
      const updateProfileSchema = z.object({
        name: z.string().min(2),
        email: z.string().email().optional()
      });

      const parseResult = updateProfileSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ error: 'Validation error', details: parseResult.error.format() });
      }

      const { name, email } = parseResult.data;
      const jwtUser = request.user as { id: string };

      const user = await prisma.user.findUnique({
        where: { id: jwtUser.id }
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      if (email && email !== user.email) {
        const emailExists = await prisma.user.findUnique({
          where: { email }
        });
        if (emailExists) {
          return reply.status(400).send({ error: 'Email is already in use by another account' });
        }
      }

      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
          name,
          email: email || undefined
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true
        }
      });

      const newAccessToken = fastify.jwt.sign(
        { id: updatedUser.id, name: updatedUser.name, email: updatedUser.email, role: updatedUser.role },
        { expiresIn: '1h' }
      );

      authLogger.info(`Profile updated for user: ${updatedUser.email}`);

      return {
        message: 'Profile updated successfully',
        user: updatedUser,
        accessToken: newAccessToken
      };
    });

    // Logout
    authGroup.post('/logout', async (request: any) => {
      const jwtUser = request.user as { id: string };
      await AuthService.updateRefreshToken(jwtUser.id, null);
      return { success: true, message: 'Logged out successfully' };
    });
  });
}
