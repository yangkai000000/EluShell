import { z } from 'zod';
export const DeploymentPlanSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  localPath: z
    .string()
    .min(1)
    .max(4096)
    .refine((s) => !s.includes('\0')),
  remoteDirectory: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .refine((s) => s.startsWith('/') && !/[\0\r\n]/.test(s))
    .default('/home/EluShell'),
  commands: z
    .string()
    .trim()
    .min(1)
    .max(64000)
    .refine((s) => !s.includes('\0')),
  timeoutMinutes: z.number().int().min(1).max(60).default(10),
});
export type DeploymentPlan = z.infer<typeof DeploymentPlanSchema>;
export type DeploymentJob = {
  id: string;
  sessionId: string;
  profileId: string;
  planId: string;
  name: string;
  host: string;
  state: 'preparing' | 'uploading' | 'executing' | 'completed' | 'failed' | 'stopped';
  started: number;
  finished?: number;
  output: string;
  error?: string;
  target: string;
  exitCode?: number;
};
export const deploymentRunning = (job: DeploymentJob) =>
  ['preparing', 'uploading', 'executing'].includes(job.state);
export interface DeploymentState {
  plans: DeploymentPlan[];
  jobs: DeploymentJob[];
}
