import { createWriteStream, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const logsDir = resolve(projectRoot, 'logs');

if (!existsSync(logsDir)) {
  mkdirSync(logsDir, { recursive: true });
}

// Generate timestamped filename (colons replaced for Windows compatibility)
const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, '');
const logFilePath = resolve(logsDir, `agentforge-${timestamp}.log`);

const logStream = createWriteStream(logFilePath, { flags: 'a' });

// Store original console methods
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const originalInfo = console.info;

function formatArgs(args: any[]): string {
  return args.map(arg => {
    if (typeof arg === 'string') return arg;
    try { return JSON.stringify(arg, null, 2); }
    catch { return String(arg); }
  }).join(' ');
}

function writeToFile(level: string, args: any[]): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${formatArgs(args)}\n`;
  try { logStream.write(line); } catch { /* disk full or stream closed */ }
}

// Override console methods to tee output to file
console.log = (...args: any[]) => {
  originalLog.apply(console, args);
  writeToFile('LOG', args);
};

console.error = (...args: any[]) => {
  originalError.apply(console, args);
  writeToFile('ERROR', args);
};

console.warn = (...args: any[]) => {
  originalWarn.apply(console, args);
  writeToFile('WARN', args);
};

console.info = (...args: any[]) => {
  originalInfo.apply(console, args);
  writeToFile('INFO', args);
};

// Capture crash info to log file
process.on('uncaughtException', (err) => {
  writeToFile('FATAL', [`Uncaught Exception: ${err.stack || err.message}`]);
});

process.on('unhandledRejection', (reason) => {
  writeToFile('FATAL', [`Unhandled Rejection: ${reason}`]);
});

// Flush and close log stream on process exit
process.on('exit', () => {
  try { logStream.end(); } catch { /* best effort */ }
});

originalLog(`[AgentForge:Logger] Logging to: ${logFilePath}`);
writeToFile('INFO', [`AgentForge logger initialized. Log file: ${logFilePath}`]);

export { logFilePath, logStream };
