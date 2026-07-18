import { CheckCircle2, XCircle, Globe, Database, ShieldAlert } from 'lucide-react';
import { useCDSI } from '../context/CDSIContext';
import { LANGUAGES, t } from '../translations';
import { useHealthCheck, getHealthCheckQueryKey } from '@workspace/api-client-react';

export default function Settings() {
  const { language, setLanguage } = useCDSI();

  const { isError, isLoading } = useHealthCheck({
    query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 10000 }
  });

  const apiStatus = isLoading ? 'checking' : isError ? 'down' : 'up';

  return (
    <div className="w-full max-w-3xl flex flex-col gap-10 pt-6 pb-20">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-[#111827]">{t('settingsTitle', language)}</h1>
        <p className="text-[#6B7280]">{t('settingsSubtitle', language)}</p>
      </div>

      {/* Language Section */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2 border-b border-[#E5E7EB] pb-3">
          <Globe className="w-5 h-5 text-[#6B7280]" />
          <h2 className="text-lg font-semibold text-[#111827]">{t('languageSection', language)}</h2>
        </div>
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-6 shadow-sm">
          <label className="block text-sm font-medium text-[#111827] mb-4">{t('appLanguage', language)}</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {LANGUAGES.map(lang => (
              <button
                key={lang.code}
                onClick={() => setLanguage(lang.code)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                  language === lang.code
                    ? 'border-[#16A34A] bg-[#F0FDF4] text-[#16A34A] shadow-sm'
                    : 'border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-[#FAFAFA] hover:border-[#D1D5DB]'
                }`}
              >
                <span className="text-base">{lang.flag}</span>
                <span className="truncate text-xs">{lang.code}</span>
              </button>
            ))}
          </div>
          {language !== 'English' && (
            <div className="mt-4 flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>Active: <strong>{language}</strong> - {t('appLanguage', language)}</span>
            </div>
          )}
        </div>
      </section>

      {/* System Status Section */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2 border-b border-[#E5E7EB] pb-3">
          <Database className="w-5 h-5 text-[#6B7280]" />
          <h2 className="text-lg font-semibold text-[#111827]">{t('systemStatus', language)}</h2>
        </div>
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="font-medium text-[#111827]">{t('apiConnection', language)}</span>
              <span className="text-sm text-[#6B7280]">{t('apiBackend', language)}</span>
            </div>
            <div className="flex items-center gap-2">
              {apiStatus === 'checking' && (
                <span className="px-3 py-1 rounded-full bg-[#FAFAFA] border border-[#E5E7EB] text-[#6B7280] text-sm font-medium flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#D1D5DB] animate-pulse" />
                  {t('checking', language)}
                </span>
              )}
              {apiStatus === 'up' && (
                <span className="px-3 py-1 rounded-full bg-[#F0FDF4] border border-[#16A34A] text-[#16A34A] text-sm font-medium flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />{t('online', language)}
                </span>
              )}
              {apiStatus === 'down' && (
                <span className="px-3 py-1 rounded-full bg-[#FEF2F2] border border-[#DC2626] text-[#DC2626] text-sm font-medium flex items-center gap-2">
                  <XCircle className="w-4 h-4" />{t('offline', language)}
                </span>
              )}
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-[#E5E7EB] flex items-center justify-between">
            <div className="flex flex-col">
              <span className="font-medium text-[#111827]">{t('jobProcessor', language)}</span>
              <span className="text-sm text-[#6B7280]">{t('jobProcessorDesc', language)}</span>
            </div>
            <div className="flex items-center gap-2">
              {apiStatus === 'up' ? (
                <span className="px-3 py-1 rounded-full bg-[#F0FDF4] border border-[#16A34A] text-[#16A34A] text-sm font-medium flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />{t('active', language)}
                </span>
              ) : (
                <span className="px-3 py-1 rounded-full bg-[#FEF2F2] border border-[#DC2626] text-[#DC2626] text-sm font-medium flex items-center gap-2">
                  <XCircle className="w-4 h-4" />{t('unreachable', language)}
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Compliance Section */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2 border-b border-[#E5E7EB] pb-3">
          <ShieldAlert className="w-5 h-5 text-[#6B7280]" />
          <h2 className="text-lg font-semibold text-[#111827]">{t('compliance', language)}</h2>
        </div>
        <div className="bg-[#FAFAFA] border border-[#E5E7EB] rounded-xl p-6 text-sm text-[#6B7280] flex flex-col gap-4 leading-relaxed">
          <p>
            <strong className="text-[#111827]">Clinical Decision Support Intelligence (CDSI)</strong> is an AI-powered analytical tool designed to assist healthcare professionals.
          </p>
          <p>
            <strong>Disclaimer:</strong> {t('disclaimer', language)}
          </p>
          <p>Version: 1.0.0-beta · Engine: GROQ / Llama-3-70b-versatile</p>
        </div>
      </section>
    </div>
  );
}
