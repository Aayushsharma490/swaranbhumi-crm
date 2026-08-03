import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db';
import { SocketService } from '../services/socket.service';
import { z } from 'zod';

export async function customerRoutes(fastify: FastifyInstance) {
  fastify.addHook('preValidation', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  const bookingSchema = z.object({
    leadId: z.string(),
    propertyDetails: z.string(),
    agreementNumber: z.string().optional(),
    totalAmount: z.number().positive(),
    status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED']).optional()
  });

  const paymentSchema = z.object({
    amount: z.number().positive(),
    paymentMode: z.string(),
    referenceNumber: z.string().optional(),
    status: z.enum(['PENDING', 'PAID', 'FAILED']).optional()
  });

  // Get all bookings
  fastify.get('/bookings', async () => {
    const bookings = await prisma.booking.findMany({
      orderBy: { bookingDate: 'desc' },
      include: {
        lead: {
          select: { id: true, name: true, phone: true, email: true, project: true }
        },
        payments: true
      }
    });
    return { bookings };
  });

  // Get specific booking details
  fastify.get('/bookings/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        lead: {
          select: { id: true, name: true, phone: true, email: true, project: true, assignedEmployeeId: true }
        },
        payments: {
          orderBy: { paymentDate: 'desc' }
        }
      }
    });

    if (!booking) {
      return reply.status(404).send({ error: 'Booking details not found' });
    }

    return { booking };
  });

  // Create new booking
  fastify.post('/bookings', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = bookingSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation error', details: parseResult.error.format() });
    }

    const payload = parseResult.data;
    const currentUser = request.user as { id: string };

    const lead = await prisma.lead.findUnique({ where: { id: payload.leadId } });
    if (!lead) {
      return reply.status(404).send({ error: 'Lead not found' });
    }

    // Create booking transaction
    const booking = await prisma.$transaction(async (tx: any) => {
      // 1. Create booking
      const newBooking = await tx.booking.create({
        data: {
          leadId: payload.leadId,
          propertyDetails: payload.propertyDetails,
          agreementNumber: payload.agreementNumber,
          totalAmount: payload.totalAmount,
          status: payload.status || 'PENDING'
        }
      });

      // 2. Set Lead Status to BOOKED
      await tx.lead.update({
        where: { id: payload.leadId },
        data: { status: 'BOOKED' }
      });

      // 3. Register timeline update
      await tx.leadTimeline.create({
        data: {
          leadId: payload.leadId,
          actionType: 'BOOKING_CREATE',
          description: `Booking registered for ${payload.propertyDetails}. Agreement: ${payload.agreementNumber || 'Pending'}. Total Value: INR ${payload.totalAmount}`,
          createdById: currentUser.id
        }
      });

      return newBooking;
    });

    // Broadcast lead update (since status changed to BOOKED)
    const updatedLead = await prisma.lead.findUnique({
      where: { id: payload.leadId },
      include: { assignedEmployee: { select: { id: true, name: true } } }
    });
    SocketService.broadcast('LEAD_UPDATED', updatedLead);
    SocketService.broadcast('BOOKING_CREATED', booking);

    return reply.status(201).send({ booking });
  });

  // Update Booking details
  fastify.put('/bookings/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const payload = request.body as any;

    const existingBooking = await prisma.booking.findUnique({ where: { id } });
    if (!existingBooking) {
      return reply.status(404).send({ error: 'Booking not found' });
    }

    const updateData: any = {};
    if (payload.propertyDetails) updateData.propertyDetails = payload.propertyDetails;
    if (payload.agreementNumber) updateData.agreementNumber = payload.agreementNumber;
    if (payload.totalAmount) updateData.totalAmount = payload.totalAmount;
    if (payload.status) updateData.status = payload.status;

    const updatedBooking = await prisma.booking.update({
      where: { id },
      data: updateData,
      include: { lead: true }
    });

    SocketService.broadcast('BOOKING_UPDATED', updatedBooking);

    return { booking: updatedBooking };
  });

  // Add payment for a booking
  fastify.post('/bookings/:id/payments', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const parseResult = paymentSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation error', details: parseResult.error.format() });
    }

    const payload = parseResult.data;
    const currentUser = request.user as { id: string };

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { lead: true }
    });

    if (!booking) {
      return reply.status(404).send({ error: 'Booking not found' });
    }

    const payment = await prisma.payment.create({
      data: {
        bookingId: id,
        amount: payload.amount,
        paymentMode: payload.paymentMode,
        referenceNumber: payload.referenceNumber,
        status: payload.status || 'PENDING'
      }
    });

    // Write timeline logging for payment event
    await prisma.leadTimeline.create({
      data: {
        leadId: booking.leadId,
        actionType: 'PAYMENT_ADD',
        description: `Payment of INR ${payload.amount} registered via ${payload.paymentMode}. Ref: ${payload.referenceNumber || 'N/A'}. Status: ${payment.status}`,
        createdById: currentUser.id
      }
    });

    SocketService.broadcast('PAYMENT_CREATED', { bookingId: id, payment });

    return reply.status(201).send({ payment });
  });

  // Update payment status
  fastify.put('/bookings/payments/:paymentId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { paymentId } = request.params as { paymentId: string };
    const { status } = request.body as { status: 'PENDING' | 'PAID' | 'FAILED' };

    if (!status) {
      return reply.status(400).send({ error: 'Status is required' });
    }

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: true }
    });

    if (!payment) {
      return reply.status(404).send({ error: 'Payment not found' });
    }

    const updatedPayment = await prisma.payment.update({
      where: { id: paymentId },
      data: { status }
    });

    // Notify update
    SocketService.broadcast('PAYMENT_UPDATED', { bookingId: payment.bookingId, payment: updatedPayment });

    return { payment: updatedPayment };
  });
}
