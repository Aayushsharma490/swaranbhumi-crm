import winston from 'winston';
import path from 'path';
import fs from 'fs';

const LOGS_DIR = path.join(__dirname, '../../logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.json()
);

const createLogger = (name: string, level = 'info') => {
  return winston.createLogger({
    level,
    format: logFormat,
    transports: [
      new winston.transports.File({ 
        filename: path.join(LOGS_DIR, `${name}.log`),
        maxsize: 10485760, // 10MB
        maxFiles: 5,
        tailable: true
      }),
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `[${timestamp}] ${level}: ${message}${metaStr}`;
          })
        )
      })
    ]
  });
};

export const apiLogger = createLogger('api');
export const errorLogger = createLogger('error', 'error');
export const metaLogger = createLogger('meta');
export const authLogger = createLogger('auth');
