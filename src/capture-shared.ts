import { z } from 'zod';
export const CaptureOptionsSchema = z
  .object({
    interface: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9_.:@-]+$/)
      .default('any'),
    protocol: z.enum(['all', 'tcp', 'udp', 'icmp']).default('tcp'),
    source: z.string().trim().max(64).default(''),
    destination: z.string().trim().max(64).default(''),
    port: z
      .string()
      .trim()
      .regex(/^$|^\d{1,5}$/)
      .default(''),
    duration: z.number().int().min(5).max(600).default(30),
    packets: z.number().int().min(1).max(1000000).default(10000),
    maxMB: z.number().int().min(1).max(256).default(32),
    snaplen: z.number().int().min(64).max(262144).default(65535),
    excludeSSH: z.boolean().default(true),
    sudo: z.boolean().default(false),
    filter: z
      .string()
      .trim()
      .max(500)
      .refine((s) => !/[\x00-\x1f\x7f]/.test(s))
      .default(''),
  })
  .strict();
export type CaptureOptions = z.infer<typeof CaptureOptionsSchema>;
export type CaptureCheck = {
  interfaces: string[];
  error?: string;
  ssh?: { client: string; clientPort: number; serverPort: number };
};
export type CaptureJob = {
  id: string;
  sessionId: string;
  name: string;
  host: string;
  state: 'starting' | 'running' | 'stopping' | 'completed' | 'failed';
  started: number;
  finished?: number;
  bytes: number;
  packets: number;
  options: CaptureOptions;
  filter: string;
  error?: string;
  reason?: string;
  filename: string;
};
export const captureRunning = (job: CaptureJob) =>
  ['starting', 'running', 'stopping'].includes(job.state);
