import bcrypt from 'bcryptjs';
import { prisma } from '../db';

export class AuthService {
  /**
   * Hashes a password string using bcrypt.
   */
  public static async hashPassword(password: string): Promise<string> {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
  }

  /**
   * Validates plain text password against database hashed password.
   */
  public static async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Updates user refresh token in the database.
   */
  public static async updateRefreshToken(userId: string, token: string | null): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { refreshToken: token },
    });
  }

  /**
   * Validates if a user role is permitted for a given route.
   */
  public static verifyRole(userRole: string, requiredRoles: string[]): boolean {
    return requiredRoles.includes(userRole);
  }
}
