import { useState, useEffect } from "react";
import { Lock, ArrowRight, ShieldCheck, AlertCircle } from "lucide-react";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState("");
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:8080";

  useEffect(() => {
    const verified = sessionStorage.getItem("cdsi_access_token_verified");
    if (verified === "true") {
      setIsAuthorized(true);
    } else {
      setIsAuthorized(false);
    }
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;

    setIsLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch(`${apiUrl}/api/verify-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });

      const data = await res.json();

      if (res.ok && data.valid) {
        sessionStorage.setItem("cdsi_access_token_verified", "true");
        sessionStorage.setItem("cdsi_access_token", token.trim());
        setIsAuthorized(true);
      } else {
        setErrorMsg(data.error || "Access Denied: Invalid entry token.");
      }
    } catch (err) {
      console.error(err);
      setErrorMsg("Connection error: Unable to reach verification server.");
    } finally {
      setIsLoading(false);
    }
  };

  if (isAuthorized === null) {
    // Loading state during initial token check
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500"></div>
      </div>
    );
  }

  if (isAuthorized) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-[#090D1A] flex flex-col justify-center items-center p-4 relative overflow-hidden font-sans">
      {/* Background Glow effects */}
      <div className="absolute top-1/4 left-1/4 w-[350px] h-[350px] bg-green-900/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-[350px] h-[350px] bg-emerald-900/10 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="w-full max-w-[420px] relative z-10">
        {/* Logo and Header */}
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="w-16 h-16 bg-[#16A34A]/10 border border-[#16A34A]/20 rounded-2xl flex items-center justify-center text-[#16A34A] mb-4 shadow-lg shadow-green-900/5 backdrop-blur-md">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mb-2">CDSI Platform</h1>
          <p className="text-sm text-slate-400">Clinical Decision Support Intelligence</p>
        </div>

        {/* Card */}
        <div className="bg-[#111A2E]/60 border border-slate-800 rounded-2xl p-8 backdrop-blur-xl shadow-2xl shadow-black/40">
          <h2 className="text-lg font-semibold text-slate-100 mb-6 flex items-center gap-2">
            <Lock className="w-4 h-4 text-green-500" />
            Enter Access Token
          </h2>

          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Access Token..."
                required
                className="w-full bg-[#0E1524] border border-slate-800 focus:border-green-500/50 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-green-500/50 transition-all text-center tracking-widest"
              />
            </div>

            {errorMsg && (
              <div className="p-3 bg-red-950/40 border border-red-900/50 rounded-xl flex items-start gap-2 text-red-400 text-xs leading-normal">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !token}
              className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 text-white font-medium rounded-xl py-3 px-4 transition-all flex items-center justify-center gap-2 group shadow-lg shadow-green-950/20"
            >
              {isLoading ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : (
                <>
                  Enter Platform
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-500 mt-8">
          Authorized personnel only. Sessions are logged securely.
        </p>
      </div>
    </div>
  );
}
