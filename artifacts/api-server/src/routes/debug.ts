import { Router } from "express";
import fs from "fs";
import path from "path";
import type { Request, Response } from "express";

const router = Router();

router.get("/debug-logs", (req: Request, res: Response) => {
  const pathsToTry = [
    "/home/LogFiles/Application",
    "/home/LogFiles",
    "./logs"
  ];

  const targetFile = req.query["file"] as string | undefined;

  try {
    const allFiles: any[] = [];
    for (const p of pathsToTry) {
      if (fs.existsSync(p)) {
        const files = fs.readdirSync(p);
        for (const file of files) {
          const fullPath = path.join(p, file);
          if (fs.statSync(fullPath).isFile()) {
            const stats = fs.statSync(fullPath);
            allFiles.push({
              dir: p,
              file,
              fullPath,
              size: stats.size,
              mtime: stats.mtimeMs
            });
          }
        }
      }
    }

    if (targetFile) {
      const match = allFiles.find(f => f.file === targetFile || f.fullPath === targetFile);
      if (!match) {
        res.status(404).json({ error: "File not found", targetFile });
        return;
      }
      const content = fs.readFileSync(match.fullPath, "utf8");
      res.type("text/plain").send(content.slice(-50000));
      return;
    }

    // Sort files by modification time descending
    allFiles.sort((a, b) => b.mtime - a.mtime);
    res.json({ availableFiles: allFiles });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
