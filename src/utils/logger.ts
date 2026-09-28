// ══════════════════════════════════════════════════════════════════════
// Application Logger - Structured File & Console Logging Utility
// Persists error and operational diagnostics to disk and database
// ══════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: string;
  data?: Record<string, unknown>;
}

const logsDir = path.join(process.cwd(), 'logs');

// Ensure logs directory exists
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
} catch (e) {
  console.error('Failed to create logs directory:', e);
}

class Logger {
  private context: string;
  private static errorLogPath = path.join(logsDir, 'error.log');
  private static combinedLogPath = path.join(logsDir, 'combined.log');

  constructor(context: string = 'App') {
    this.context = context;
  }

  private formatLog(entry: LogEntry): string {
    const { timestamp, level, message, context, data } = entry;
    const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${level}] [${context}] ${message}${dataStr}`;
  }

  private appendToFile(filePath: string, line: string): void {
    try {
      fs.appendFile(filePath, line + '\n', (err) => {
        if (err) {
          // Fallback console without infinite loop
          console.error('[Logger File Append Error]', err.message);
        }
      });
    } catch {
      // Ignore background write failures
    }
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: this.context,
      data,
    };

    const formatted = this.formatLog(entry);

    // Write to combined log file
    this.appendToFile(Logger.combinedLogPath, formatted);

    // If ERROR or FATAL, also write to error.log
    if (level === 'ERROR' || level === 'FATAL') {
      this.appendToFile(Logger.errorLogPath, formatted);
    }

    switch (level) {
      case 'ERROR':
      case 'FATAL':
        console.error(formatted);
        break;
      case 'WARN':
        console.warn(formatted);
        break;
      case 'DEBUG':
        if (process.env.NODE_ENV === 'development') {
          console.debug(formatted);
        }
        break;
      default:
        console.log(formatted);
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('DEBUG', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('INFO', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('WARN', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('ERROR', message, data);
  }

  fatal(message: string, data?: Record<string, unknown>): void {
    this.log('FATAL', message, data);
  }

  child(context: string): Logger {
    return new Logger(`${this.context}:${context}`);
  }
}

export const logger = new Logger('PMErp');
export default logger;
