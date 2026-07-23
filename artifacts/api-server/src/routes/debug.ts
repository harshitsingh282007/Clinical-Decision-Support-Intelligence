import { Router } from "express";
import fs from "fs";
import path from "path";
import type { Request, Response } from "express";

const router = Router();

router.get("/debug-logs", (req: Request, res: Response) => {
  // Try to find logs under Azure's default LogFiles directory, or look for local logs
  const pathsToTry = [
    "/home/LogFiles/Application",
    "/home/LogFiles",
    "./logs"
  ];

  let logDir = "";
  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      logDir = p;
      break;
    }
  }

  if (!logDir) {
    res.status(404).json({ error: "No log directories found", triedPaths: pathsToTry });
    return;
  }

  try {
    const files = fs.readdirSync(logDir);
    const logFiles = files.filter(f => f.endsWith(".log") || f.endsWith(".txt") || f.includes("stdout"));
    if (logFiles.length === 0) {
      res.json({ message: "No log files found in directory", dir: logDir, files });
      return;
    }

    // Sort files by modification time
    const sorted = logFiles.map(file => {
      const stats = fs.statSync(path.join(logDir, file));
      return { file, mtime: stats.mtimeMs };
    }).sort((a, b) => b.mtime - a.mtime);

    const latestFile = sorted[0].file;
    const content = fs.readFileSync(path.join(logDir, latestFile), "utf8");
    res.type("text/plain").send(content.slice(-30000)); // Send last 30,000 characters of logs
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
