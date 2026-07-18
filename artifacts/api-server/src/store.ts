import fs from "fs";
import { logger } from "./lib/logger.js";

// In-memory job store for CDSI pipeline jobs
// Keyed by jobId

export type JobStage =
  | "uploading"
  | "ocr"
  | "extraction"
  | "intake"
  | "reasoning"
  | "report"
  | "complete"
  | "failed";

export interface UploadedFile {
  originalName: string;
  mimetype: string;
  size: number;
  path: string;
  pageCount?: number;
}

export interface JobState {
  jobId: string;
  /** ready = OCR/intake prep done, awaiting POST /analyze */
  status: "pending" | "processing" | "ready" | "completed" | "failed" | "partial";
  stage: JobStage;
  progress: number; // 0-100
  message: string | null;
  error: string | null;
  files: UploadedFile[];
  medicalContext: string | null;
  structuredData: {
    labParameters: unknown[];
    prescriptions: unknown[];
  } | null;
  intakeData: unknown | null;
  report: unknown | null;
  createdAt: Date;
  updatedAt: Date;
}

// Report cache keyed by jobId
export const jobStore = new Map<string, JobState>();

// Chat history keyed by sessionId
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}
export const chatStore = new Map<string, ChatMessage[]>();

// Report context for chat (keyed by jobId → full context string)
export const reportContextStore = new Map<string, string>();

// A sessionId is independent of jobId (generated once per browser tab and can be reused
// across multiple jobs), so we track which sessions chatted about which job. This lets us
// actually find and delete the right chatStore entries when a job is deleted/cleaned up.
const jobSessionsStore = new Map<string, Set<string>>();

export function linkSessionToJob(jobId: string, sessionId: string): void {
  const sessions = jobSessionsStore.get(jobId) ?? new Set<string>();
  sessions.add(sessionId);
  jobSessionsStore.set(jobId, sessions);
}

export function createJob(jobId: string, files: UploadedFile[]): JobState {
  const job: JobState = {
    jobId,
    status: "pending",
    stage: "uploading",
    progress: 0,
    message: "Job created",
    error: null,
    files,
    medicalContext: null,
    structuredData: null,
    intakeData: null,
    report: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  jobStore.set(jobId, job);
  return job;
}

export function updateJob(jobId: string, updates: Partial<JobState>): void {
  const job = jobStore.get(jobId);
  if (job) {
    Object.assign(job, updates, { updatedAt: new Date() });
    jobStore.set(jobId, job);
  }
}

export function getJob(jobId: string): JobState | undefined {
  return jobStore.get(jobId);
}

function deleteJobFiles(job: JobState | undefined): void {
  if (!job) return;
  for (const file of job.files) {
    fs.unlink(file.path, (err) => {
      if (err && err.code !== "ENOENT") {
        logger.warn({ err, path: file.path }, "Failed to delete uploaded file from disk");
      }
    });
  }
}

export function deleteJob(jobId: string): boolean {
  deleteJobFiles(jobStore.get(jobId));
  const sessions = jobSessionsStore.get(jobId);
  if (sessions) {
    for (const sessionId of sessions) chatStore.delete(sessionId);
    jobSessionsStore.delete(jobId);
  }
  reportContextStore.delete(jobId);
  return jobStore.delete(jobId);
}

export function deleteChatHistory(sessionId: string): boolean {
  return chatStore.delete(sessionId);
}

export function deleteReportContext(jobId: string): boolean {
  return reportContextStore.delete(jobId);
}

// Cleanup function to remove old jobs (older than specified hours)
export function cleanupOldJobs(maxAgeHours: number = 24): number {
  const now = new Date();
  const maxAge = maxAgeHours * 60 * 60 * 1000;
  let deletedCount = 0;

  for (const [jobId, job] of jobStore.entries()) {
    const age = now.getTime() - job.createdAt.getTime();
    if (age > maxAge) {
      deleteJobFiles(job);
      jobStore.delete(jobId);
      const sessions = jobSessionsStore.get(jobId);
      if (sessions) {
        for (const sessionId of sessions) chatStore.delete(sessionId);
        jobSessionsStore.delete(jobId);
      }
      reportContextStore.delete(jobId);
      deletedCount++;
    }
  }

  return deletedCount;
}
