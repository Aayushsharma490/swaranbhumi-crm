import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';
import { Settings, Send, History, AlertCircle, UploadCloud, CheckCircle2, Users } from 'lucide-react';

export default function WhatsappMarketing() {
  const { accessToken, apiBaseUrl } = useAuthStore();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<'NEW_CAMPAIGN' | 'HISTORY' | 'SETTINGS'>('NEW_CAMPAIGN');
  
  // Settings State
  const [accessTokenInput, setAccessTokenInput] = useState('');
  const [phoneIdInput, setPhoneIdInput] = useState('');
  const [wabaIdInput, setWabaIdInput] = useState('');
  
  // Campaign State
  const [campaignName, setCampaignName] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [audienceType, setAudienceType] = useState<'CRM' | 'EXCEL'>('CRM');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [parsedRecipients, setParsedRecipients] = useState<{name: string, phone: string}[]>([]);

  // Queries
  const { data: settingsData } = useQuery({
    queryKey: ['whatsappSettings'],
    queryFn: async () => {
      const response = await axios.get(`${apiBaseUrl}/whatsapp/settings`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (response.data?.accessToken) {
        setAccessTokenInput(response.data.accessToken);
        setPhoneIdInput(response.data.phoneNumberId);
        setWabaIdInput(response.data.wabaId);
      }
      return response.data;
    }
  });

  const { data: templates, isLoading: isLoadingTemplates } = useQuery({
    queryKey: ['whatsappTemplates'],
    queryFn: async () => {
      const response = await axios.get(`${apiBaseUrl}/whatsapp/templates`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return response.data;
    },
    enabled: !!settingsData?.accessToken
  });

  const { data: campaigns, isLoading: isLoadingCampaigns } = useQuery({
    queryKey: ['whatsappCampaigns'],
    queryFn: async () => {
      const response = await axios.get(`${apiBaseUrl}/whatsapp/campaigns`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return response.data;
    },
    // Poll every 5 seconds if history tab is active to see live status
    refetchInterval: activeTab === 'HISTORY' ? 5000 : false
  });

  const { data: leadsData } = useQuery({
    queryKey: ['leads'],
    queryFn: async () => {
      const response = await axios.get(`${apiBaseUrl}/leads`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { status: 'NEW' } // Example: Only fetch NEW leads for default CRM audience
      });
      return response.data.leads;
    }
  });

  // Mutations
  const updateSettingsMutation = useMutation({
    mutationFn: async () => {
      await axios.post(`${apiBaseUrl}/whatsapp/settings`, {
        accessToken: accessTokenInput,
        phoneNumberId: phoneIdInput,
        wabaId: wabaIdInput
      }, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsappSettings'] });
      queryClient.invalidateQueries({ queryKey: ['whatsappTemplates'] });
      alert('Settings saved successfully!');
    }
  });

  const createCampaignMutation = useMutation({
    mutationFn: async (payload: any) => {
      await axios.post(`${apiBaseUrl}/whatsapp/campaign/create`, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    },
    onSuccess: () => {
      alert('Campaign started successfully!');
      setCampaignName('');
      setSelectedTemplate('');
      setCsvFile(null);
      setParsedRecipients([]);
      setActiveTab('HISTORY');
      queryClient.invalidateQueries({ queryKey: ['whatsappCampaigns'] });
    },
    onError: (error: any) => {
      alert(`Error starting campaign: ${error.response?.data?.error || error.message}`);
    }
  });

  // Handlers
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n');
      const recipients: {name: string, phone: string}[] = [];
      
      // Basic CSV parsing (assuming first row might be header)
      lines.forEach((line, index) => {
        if (!line.trim()) return;
        const cols = line.split(',');
        // If it's the first line and it contains 'phone' or 'number', skip header
        if (index === 0 && line.toLowerCase().includes('phone')) return;
        
        // Try to extract phone (usually the longest numeric string or specific column)
        const possiblePhone = cols.find(c => c.replace(/\D/g, '').length >= 10);
        if (possiblePhone) {
          recipients.push({
            name: cols[0] || 'Customer',
            phone: possiblePhone.replace(/\D/g, '')
          });
        }
      });
      setParsedRecipients(recipients);
    };
    reader.readAsText(file);
  };

  const handleStartCampaign = () => {
    if (!campaignName || !selectedTemplate) {
      return alert('Please provide campaign name and select a template.');
    }

    let finalRecipients: any[] = [];
    if (audienceType === 'EXCEL') {
      if (parsedRecipients.length === 0) return alert('No valid recipients found in CSV.');
      finalRecipients = parsedRecipients;
    } else {
      if (!leadsData || leadsData.length === 0) return alert('No leads found in CRM matching criteria.');
      finalRecipients = leadsData.map((l: any) => ({
        name: l.name,
        phone: l.phone,
        leadId: l.id
      }));
    }

    // Find template lang
    const tpl = templates?.find((t: any) => t.name === selectedTemplate);
    const lang = tpl?.language || 'en';

    createCampaignMutation.mutate({
      campaignName,
      templateName: selectedTemplate,
      templateLang: lang,
      recipients: finalRecipients
    });
  };

  return (
    <div className="h-full flex flex-col bg-white border border-gray-150 rounded-2xl shadow-sm overflow-hidden">
      {/* Header Tabs */}
      <div className="flex border-b border-gray-150 bg-gray-50/50 p-2 gap-2">
        <button
          onClick={() => setActiveTab('NEW_CAMPAIGN')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${activeTab === 'NEW_CAMPAIGN' ? 'bg-white text-brand-600 shadow-sm border border-gray-200' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          <Send className="w-4 h-4" />
          New Campaign
        </button>
        <button
          onClick={() => setActiveTab('HISTORY')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${activeTab === 'HISTORY' ? 'bg-white text-brand-600 shadow-sm border border-gray-200' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          <History className="w-4 h-4" />
          Campaign History
        </button>
        <button
          onClick={() => setActiveTab('SETTINGS')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors ml-auto ${activeTab === 'SETTINGS' ? 'bg-white text-brand-600 shadow-sm border border-gray-200' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          <Settings className="w-4 h-4" />
          API Settings
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6 bg-gray-50/30">
        
        {/* NEW CAMPAIGN TAB */}
        {activeTab === 'NEW_CAMPAIGN' && (
          <div className="max-w-3xl mx-auto space-y-6">
            {!settingsData?.accessToken ? (
              <div className="p-6 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
                <AlertCircle className="w-6 h-6 text-amber-500 shrink-0" />
                <div>
                  <h3 className="font-bold text-amber-800">WhatsApp API Not Configured</h3>
                  <p className="text-sm text-amber-700 mt-1">Please go to API Settings and configure your Meta Cloud API credentials before starting a campaign.</p>
                  <button onClick={() => setActiveTab('SETTINGS')} className="mt-3 px-4 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-bold rounded-lg transition">Go to Settings</button>
                </div>
              </div>
            ) : (
              <>
                <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
                  <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <Send className="w-5 h-5 text-brand-500" />
                    Launch WhatsApp Campaign
                  </h2>
                  
                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">Campaign Name</label>
                    <input 
                      type="text" 
                      value={campaignName}
                      onChange={e => setCampaignName(e.target.value)}
                      placeholder="e.g. Diwali Offer Blast" 
                      className="crm-input" 
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">Select Meta Template</label>
                    {isLoadingTemplates ? (
                      <p className="text-xs text-gray-400">Loading templates from Meta...</p>
                    ) : (
                      <select 
                        value={selectedTemplate}
                        onChange={e => setSelectedTemplate(e.target.value)}
                        className="crm-select"
                      >
                        <option value="">-- Choose an approved template --</option>
                        {templates?.map((t: any) => (
                          <option key={t.id} value={t.name}>{t.name} ({t.language})</option>
                        ))}
                      </select>
                    )}
                    {selectedTemplate && templates && (
                      <div className="mt-2 p-3 bg-gray-50 border border-gray-100 rounded text-xs font-mono text-gray-600 whitespace-pre-wrap">
                        {/* Try to show preview if components exist */}
                        {templates.find((t:any) => t.name === selectedTemplate)?.components?.find((c:any) => c.type === 'BODY')?.text || 'No preview available'}
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
                  <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <Users className="w-5 h-5 text-brand-500" />
                    Audience Selection
                  </h2>
                  
                  <div className="flex gap-4 mb-4">
                    <label className={`flex-1 p-4 border rounded-xl cursor-pointer transition ${audienceType === 'CRM' ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <input type="radio" checked={audienceType === 'CRM'} onChange={() => setAudienceType('CRM')} className="text-brand-500 focus:ring-brand-500" />
                        <span className="font-bold text-gray-700">CRM Leads</span>
                      </div>
                      <p className="text-xs text-gray-500 ml-6">Send to existing leads in your CRM database.</p>
                    </label>

                    <label className={`flex-1 p-4 border rounded-xl cursor-pointer transition ${audienceType === 'EXCEL' ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <input type="radio" checked={audienceType === 'EXCEL'} onChange={() => setAudienceType('EXCEL')} className="text-brand-500 focus:ring-brand-500" />
                        <span className="font-bold text-gray-700">Upload CSV / Excel</span>
                      </div>
                      <p className="text-xs text-gray-500 ml-6">Upload a list of external numbers.</p>
                    </label>
                  </div>

                  {audienceType === 'CRM' && (
                    <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                      <p className="text-sm font-medium text-gray-700">Selected Audience: <span className="font-bold text-brand-600">{leadsData?.length || 0} Leads</span> (Status: NEW)</p>
                      <p className="text-xs text-gray-500 mt-1">Currently, this will target all leads with 'NEW' status. (Advanced filtering coming soon).</p>
                    </div>
                  )}

                  {audienceType === 'EXCEL' && (
                    <div className="p-6 border-2 border-dashed border-gray-300 rounded-xl text-center bg-gray-50 hover:bg-gray-100 transition cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                      <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
                      <UploadCloud className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                      <p className="text-sm font-bold text-gray-700">Click to upload CSV file</p>
                      <p className="text-xs text-gray-500 mt-1">Ensure file has a phone number column.</p>
                      
                      {csvFile && (
                        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between text-left">
                          <div>
                            <p className="text-xs font-bold text-green-800 flex items-center gap-1"><CheckCircle2 className="w-4 h-4"/> {csvFile.name}</p>
                            <p className="text-[10px] text-green-600 mt-0.5">Found {parsedRecipients.length} valid numbers.</p>
                          </div>
                          <button className="text-xs text-red-500 hover:underline" onClick={(e) => { e.stopPropagation(); setCsvFile(null); setParsedRecipients([]);}}>Remove</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <button 
                  onClick={handleStartCampaign}
                  disabled={createCampaignMutation.isPending || (audienceType === 'EXCEL' && parsedRecipients.length === 0)}
                  className="w-full py-4 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl shadow-lg shadow-brand-500/30 transition disabled:opacity-50 text-lg flex items-center justify-center gap-2"
                >
                  {createCampaignMutation.isPending ? 'Starting...' : 'Blast Campaign Now'}
                </button>
              </>
            )}
          </div>
        )}


        {/* HISTORY TAB */}
        {activeTab === 'HISTORY' && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
             <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-slate-800 border-b border-slate-900 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="py-3 px-4 text-left text-[11px] font-bold text-white uppercase tracking-wider">Campaign Name</th>
                  <th className="py-3 px-4 text-left text-[11px] font-bold text-white uppercase tracking-wider">Template</th>
                  <th className="py-3 px-4 text-left text-[11px] font-bold text-white uppercase tracking-wider">Status</th>
                  <th className="py-3 px-4 text-left text-[11px] font-bold text-white uppercase tracking-wider">Progress</th>
                  <th className="py-3 px-4 text-left text-[11px] font-bold text-white uppercase tracking-wider">Sent Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoadingCampaigns ? (
                  <tr><td colSpan={5} className="p-8 text-center text-gray-400">Loading history...</td></tr>
                ) : campaigns?.length === 0 ? (
                  <tr><td colSpan={5} className="p-8 text-center text-gray-400">No campaigns found.</td></tr>
                ) : (
                  campaigns?.map((camp: any) => (
                    <tr key={camp.id} className="hover:bg-gray-50 transition">
                      <td className="py-3 px-4 font-bold text-gray-800">{camp.name}</td>
                      <td className="py-3 px-4 text-xs text-gray-600 font-mono">{camp.templateName}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          camp.status === 'PROCESSING' ? 'bg-blue-100 text-blue-700' :
                          camp.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {camp.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-green-500" style={{ width: `${(camp.sentCount / camp.totalRecipients) * 100}%`}}></div>
                          </div>
                          <span className="font-mono text-gray-600">{camp.sentCount}/{camp.totalRecipients}</span>
                        </div>
                        {camp.failedCount > 0 && <p className="text-[10px] text-red-500 mt-1">{camp.failedCount} Failed</p>}
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-500">{new Date(camp.createdAt).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}


        {/* SETTINGS TAB */}
        {activeTab === 'SETTINGS' && (
          <div className="max-w-xl mx-auto bg-white p-8 rounded-2xl border border-gray-200 shadow-sm">
            <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <Settings className="w-5 h-5 text-gray-500" />
              Meta Cloud API Configuration
            </h2>

            <div className="space-y-5">
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">Permanent Access Token</label>
                <textarea 
                  value={accessTokenInput}
                  onChange={e => setAccessTokenInput(e.target.value)}
                  className="crm-input h-24 font-mono text-xs"
                  placeholder="EAAG... (from Meta Developer Console)"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">Phone Number ID</label>
                <input 
                  type="text"
                  value={phoneIdInput}
                  onChange={e => setPhoneIdInput(e.target.value)}
                  className="crm-input font-mono"
                  placeholder="e.g. 10123456789"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">WhatsApp Business Account ID (WABA ID)</label>
                <input 
                  type="text"
                  value={wabaIdInput}
                  onChange={e => setWabaIdInput(e.target.value)}
                  className="crm-input font-mono"
                  placeholder="e.g. 10987654321"
                />
              </div>

              <div className="pt-4 border-t border-gray-100">
                <button 
                  onClick={() => updateSettingsMutation.mutate()}
                  disabled={updateSettingsMutation.isPending}
                  className="crm-button-primary w-full py-3"
                >
                  {updateSettingsMutation.isPending ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
