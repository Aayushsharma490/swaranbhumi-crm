import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db';
import { AuthService } from '../services/auth.service';
import { z } from 'zod';

export async function employeeRoutes(fastify: FastifyInstance) {
  // Authorization middleware hook - restricts access to Admin and Manager roles
  fastify.addHook('preValidation', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const currentUser = request.user as { role: string };
      if (currentUser.role !== 'ADMIN' && currentUser.role !== 'MANAGER') {
        return reply.status(403).send({ error: 'Access forbidden: Administrators or Managers only' });
      }
    } catch (err) {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  const employeeCreateSchema = z.object({
    name: z.string(),
    email: z.string().email(),
    password: z.string().min(6),
    role: z.enum(['ADMIN', 'MANAGER', 'EXECUTIVE']),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional()
  });

  const employeeUpdateSchema = z.object({
    name: z.string().optional(),
    email: z.string().email().optional(),
    password: z.string().min(6).optional(),
    role: z.enum(['ADMIN', 'MANAGER', 'EXECUTIVE']).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional()
  });

  // Get employee performance
  fastify.get('/performance', async () => {
    const employees = await prisma.user.findMany({
      where: { role: 'EXECUTIVE' },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        _count: {
          select: {
            assignedLeads: true
          }
        }
      }
    });

    const performanceData = await Promise.all(
      employees.map(async (emp: any) => {
        // Converted Leads (BOOKED status)
        const converted = await prisma.lead.count({
          where: {
            assignedEmployeeId: emp.id,
            status: 'BOOKED'
          }
        });

        // Lost Leads (LOST status)
        const lost = await prisma.lead.count({
          where: {
            assignedEmployeeId: emp.id,
            status: 'LOST'
          }
        });

        // Active Leads
        const activeLeads = await prisma.lead.count({
          where: {
            assignedEmployeeId: emp.id,
            status: { in: ['NEW', 'CONTACTED', 'INTERESTED', 'SITE_VISIT', 'NEGOTIATION'] }
          }
        });

        const totalLeads = emp._count.assignedLeads;
        const conversionRate = totalLeads > 0 ? parseFloat(((converted / totalLeads) * 100).toFixed(1)) : 0;

        return {
          id: emp.id,
          name: emp.name,
          email: emp.email,
          status: emp.status,
          totalAssigned: totalLeads,
          activeCount: activeLeads,
          convertedCount: converted,
          lostCount: lost,
          conversionRate
        };
      })
    );

    return { performance: performanceData };
  });

  // Get employees list
  fastify.get('/', async () => {
    const employees = await prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        _count: {
          select: {
            assignedLeads: true
          }
        }
      }
    });
    return { employees };
  });

  // Get specific employee
  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const employee = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true
      }
    });

    if (!employee) {
      return reply.status(404).send({ error: 'Employee not found' });
    }

    return { employee };
  });

  // Create employee (Only Admin)
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user as { role: string };
    if (currentUser.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Only Administrators can create new employees' });
    }

    const parseResult = employeeCreateSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation error', details: parseResult.error.format() });
    }

    const payload = parseResult.data;

    // Check duplicate email
    const exists = await prisma.user.findUnique({
      where: { email: payload.email }
    });

    if (exists) {
      return reply.status(409).send({ error: 'An employee with this email already exists' });
    }

    const passwordHash = await AuthService.hashPassword(payload.password);

    const employee = await prisma.user.create({
      data: {
        name: payload.name,
        email: payload.email,
        passwordHash,
        role: payload.role,
        status: payload.status || 'ACTIVE'
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true
      }
    });

    return reply.status(201).send({ employee });
  });

  // Update employee (Only Admin)
  fastify.put('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user as { role: string };
    if (currentUser.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Only Administrators can update employee profiles' });
    }

    const { id } = request.params as { id: string };
    const parseResult = employeeUpdateSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation error', details: parseResult.error.format() });
    }

    const payload = parseResult.data;

    const employee = await prisma.user.findUnique({
      where: { id }
    });

    if (!employee) {
      return reply.status(404).send({ error: 'Employee not found' });
    }

    const updateData: any = {};

    if (payload.name) updateData.name = payload.name;
    if (payload.email) {
      // Check duplicate email
      const emailMatch = await prisma.user.findFirst({
        where: {
          email: payload.email,
          NOT: { id }
        }
      });
      if (emailMatch) {
        return reply.status(409).send({ error: 'Email is already used by another employee' });
      }
      updateData.email = payload.email;
    }
    if (payload.password) {
      updateData.passwordHash = await AuthService.hashPassword(payload.password);
    }
    if (payload.role) updateData.role = payload.role;
    if (payload.status) updateData.status = payload.status;

    const updatedEmployee = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true
      }
    });

    return { employee: updatedEmployee };
  });

  // Deactivate employee instead of hard deletion to keep referencing consistency
  fastify.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user as { role: string };
    if (currentUser.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Only Administrators can deactivate employee accounts' });
    }

    const { id } = request.params as { id: string };
    
    // Check if user is attempting to deactivate themselves
    const activeJwtUser = request.user as { id: string };
    if (activeJwtUser.id === id) {
      return reply.status(400).send({ error: 'Self-deactivation is not allowed' });
    }

    const employee = await prisma.user.findUnique({ where: { id } });
    if (!employee) {
      return reply.status(404).send({ error: 'Employee not found' });
    }

    await prisma.user.update({
      where: { id },
      data: { status: 'INACTIVE', refreshToken: null }
    });

    return { success: true, message: 'Employee account deactivated successfully' };
  });
}
