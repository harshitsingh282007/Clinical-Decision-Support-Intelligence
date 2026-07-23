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

router.get("/debug-env", (req: Request, res: Response) => {
  const maskKey = (key?: string) => {
    if (!key) return null;
    const clean = key.trim().replace(/[\u200B-\u200D\uFEFF\u2028\u2029]/g, "").replace(/^["']|["']$/g, "");
    if (clean.length < 8) return "***";
    return clean.substring(0, 4) + "..." + clean.substring(clean.length - 4);
  };

  const groq = process.env.GROQ_API_KEY;
  const dxgpt = process.env.DXGPT_API_KEY;

  res.json({
    GROQ_API_KEY: {
      exists: !!groq,
      length: groq ? groq.length : 0,
      masked: maskKey(groq)
    },
    DXGPT_API_KEY: {
      exists: !!dxgpt,
      length: dxgpt ? dxgpt.length : 0,
      masked: maskKey(dxgpt)
    },
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    WEBSITE_SITE_NAME: process.env.WEBSITE_SITE_NAME
  });
});

router.get("/test-groq", async (req: Request, res: Response) => {
  try {
    let key = process.env.GROQ_API_KEY;
    if (key) {
      key = key.trim().replace(/[\u200B-\u200D\uFEFF\u2028\u2029]/g, "").replace(/^["']|["']$/g, "");
    }
    
    if (!key) {
      return res.status(400).json({ error: "No GROQ_API_KEY" });
    }

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "User-Agent": "CDSI-App/1.0"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: "test" }]
      })
    });

    const status = groqRes.status;
    const text = await groqRes.text();

    res.json({
      status,
      headers: Object.fromEntries(groqRes.headers.entries()),
      body: text
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
