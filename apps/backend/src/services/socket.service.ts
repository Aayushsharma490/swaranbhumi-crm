import { Server } from 'socket.io';
import { FastifyInstance } from 'fastify';
import { apiLogger } from './logger.service';

export class SocketService {
  private static io: Server | null = null;

  /**
   * Initializes the Socket.IO server attached to Fastify's HTTP server.
   */
  public static initialize(fastify: FastifyInstance): void {
    this.io = new Server(fastify.server, {
      cors: {
        origin: '*', // Allow all dev desktop origins, restricted via Nginx in prod
        methods: ['GET', 'POST']
      }
    });

    this.io.on('connection', (socket) => {
      apiLogger.info(`Real-time client connected via Socket.IO. Socket ID: ${socket.id}`);

      // Setup room join based on custom user initialization (for scoped messages)
      socket.on('join_user_channel', (userId: string) => {
        socket.join(`user_${userId}`);
        apiLogger.info(`Socket ${socket.id} joined channel: user_${userId}`);
      });

      socket.on('disconnect', () => {
        apiLogger.info(`Real-time client disconnected. Socket ID: ${socket.id}`);
      });
    });

    apiLogger.info('Socket.IO server listening successfully');
  }

  /**
   * Broadcast an event to all connected CRM workstations.
   */
  public static broadcast(event: string, payload: any): void {
    if (this.io) {
      this.io.emit(event, payload);
      apiLogger.info(`Broadcasted real-time event: ${event}`);
    }
  }

  /**
   * Send a targeted real-time event to a specific user (e.g. lead assignment notifications).
   */
  public static sendToUser(userId: string, event: string, payload: any): void {
    if (this.io) {
      this.io.to(`user_${userId}`).emit(event, payload);
      apiLogger.info(`Sent targeted event: ${event} to user: ${userId}`);
    }
  }
}
