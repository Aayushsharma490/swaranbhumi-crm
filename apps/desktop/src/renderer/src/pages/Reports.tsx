import React, { useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import axios from 'axios';
import { 
  FileSpreadsheet, 
  FileText, 
  FileUp, 
  Download, 
  ArrowRight,
  TrendingUp,
  Award
} from 'lucide-react';

export default function Reports() {
  const { accessToken, apiBaseUrl } = useAuthStore();
  const [downloading, setDownloading] = useState<string | null>(null);

  const triggerDownload = async (endpoint: string, filename: string, mimeType: string) => {
    setDownloading(filename);
    try {
      const response = await axios.get(`${apiBaseUrl}${endpoint}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        responseType: 'blob'
      });
      
      const blob = new Blob([response.data], { type: mimeType });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      alert('Error fetching report file from server.');
    } finally {
      setDownloading(null);
    }
  };

  const reportsList = [
    {
      title: 'Full Leads Database (Excel)',
      description: 'Generates a spreadsheet with complete column details including budget, project, source campaign, agent allocation, and timelines.',
      icon: FileSpreadsheet,
      color: 'bg-emerald-500',
      action: () => triggerDownload('/reports/export/excel', 'swaranbhumi_leads_database.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    },
    {
      title: 'General Leads Table (CSV)',
      description: 'Standard flat comma-separated values database containing essential lead identifiers. Ideal for bulk uploading or Meta integration exports.',
      icon: FileText,
      color: 'bg-blue-500',
      action: () => triggerDownload('/reports/export/csv', 'swaranbhumi_leads_data.csv', 'text/csv')
    },
    {
      title: 'Executive PDF Summary Brief',
      description: 'Generates a print-ready corporate PDF catalog layout mapping the top 50 active leads, current status segments, and source breakdowns.',
      icon: FileUp,
      color: 'bg-red-500',
      action: () => triggerDownload('/reports/export/pdf', 'swaranbhumi_leads_summary.pdf', 'application/pdf')
    }
  ];

  return (
    <div className="space-y-8">
      {/* Intro info */}
      <div className="bg-white p-6 border border-gray-150 rounded-2xl shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h3 className="font-bold text-gray-800 text-sm uppercase tracking-wider">Reports & Exports Engine</h3>
          <p className="text-xs text-gray-500 mt-1">Compile ledger audits and convert customer logs into offline files instantly.</p>
        </div>
      </div>

      {/* Grid boxes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {reportsList.map((rep, idx) => {
          const Icon = rep.icon;
          const isCurrent = downloading === rep.title;
          return (
            <div key={idx} className="bg-white border border-gray-150 rounded-2xl shadow-sm p-6 hover:shadow-md transition-all duration-200 flex flex-col justify-between h-64">
              <div>
                <div className={`w-10 h-10 ${rep.color} rounded-lg flex items-center justify-center mb-4 text-white shadow-sm`}>
                  <Icon className="w-5 h-5" />
                </div>
                <h4 className="font-bold text-gray-800 text-sm tracking-wide mb-2">{rep.title}</h4>
                <p className="text-xs text-gray-400 font-sans leading-relaxed">{rep.description}</p>
              </div>

              <button
                onClick={rep.action}
                disabled={downloading !== null}
                className="w-full py-2.5 bg-gray-50 hover:bg-brand-50 border border-gray-200 hover:border-brand-300 rounded-xl text-xs font-semibold text-gray-700 hover:text-brand-600 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {isCurrent ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
                    Fetching stream...
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    Download File
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Extra info panel */}
      <div className="bg-white border border-gray-150 rounded-2xl shadow-sm p-6">
        <h4 className="font-bold text-xs uppercase tracking-wider text-gray-500 mb-4">Export Audit Rules</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-gray-500 leading-relaxed font-sans">
          <div className="flex gap-2">
            <TrendingUp className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-gray-700 mb-1">Lead Filter Matching</p>
              <p>The download triggers compile live workspace data including Facebook webhook creations and duplicate records. Check statuses before compiling quarterly reports.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Award className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-gray-700 mb-1">Encrypted parameters protection</p>
              <p>Facebook developer app client ID tokens are not exposed inside exported files. Only public metadata profiles (names, phones, budgets, properties) are exported.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
