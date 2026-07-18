import { createContext, useContext, useState, ReactNode } from 'react';
import { ClinicalReport } from '@workspace/api-client-react';

export interface UploadedFileInfo {
  file: File;
  id: string;
  name: string;
  size: number;
  type: string;
  status: 'uploading' | 'completed' | 'error';
  progress: number;
}

interface CDSIContextType {
  jobId: string | null;
  setJobId: (id: string | null) => void;
  report: ClinicalReport | null;
  setReport: (report: ClinicalReport | null) => void;
  language: string;
  setLanguage: (lang: string) => void;
  sessionId: string;
  files: UploadedFileInfo[];
  setFiles: React.Dispatch<React.SetStateAction<UploadedFileInfo[]>>;
}

const CDSIContext = createContext<CDSIContextType | null>(null);

export function CDSIProvider({ children }: { children: ReactNode }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [report, setReport] = useState<ClinicalReport | null>(null);
  const [language, setLanguage] = useState<string>('English');
  const [sessionId] = useState<string>(() => crypto.randomUUID());
  const [files, setFiles] = useState<UploadedFileInfo[]>([]);

  return (
    <CDSIContext.Provider value={{
      jobId, setJobId,
      report, setReport,
      language, setLanguage,
      sessionId,
      files, setFiles
    }}>
      {children}
    </CDSIContext.Provider>
  );
}

export function useCDSI() {
  const context = useContext(CDSIContext);
  if (!context) {
    throw new Error('useCDSI must be used within a CDSIProvider');
  }
  return context;
}
