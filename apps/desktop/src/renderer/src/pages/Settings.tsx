import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { io } from 'socket.io-client';
import { 
  Settings2, 
  CheckCircle2, 
  Save, 
  Activity, 
  Lock, 
  Info,
  Server,
  Trash2,
  Upload
} from 'lucide-react';

const metaSettingsSchema = z.object({
  appId: z.string().optional(),
  appSecret: z.string().optional(),
  pageAccessToken: z.string().optional(),
  verifyToken: z.string().min(4, 'Verify Token must be at least 4 characters'),
  apiUrl: z.string().url('Must be a valid Meta Graph API url')
});

type MetaSettingsFormData = z.infer<typeof metaSettingsSchema>;

export default function Settings() {
  const { accessToken, refreshToken, user, setAuth, apiBaseUrl, setApiBaseUrl } = useAuthStore();
  const queryClient = useQueryClient();

  const [localApiUrl, setLocalApiUrl] = useState(apiBaseUrl);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Profile Edit States
  const [profileName, setProfileName] = useState(user?.name || '');
  const [profileEmail, setProfileEmail] = useState(user?.email || '');
  const [isProfileUpdating, setIsProfileUpdating] = useState(false);
  const [profileSuccessMsg, setProfileSuccessMsg] = useState('');

  // Sync Form State when user updates
  useEffect(() => {
    if (user) {
      setProfileName(user.name);
      setProfileEmail(user.email);
    }
  }, [user]);

  // Import States
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [importPercentage, setImportPercentage] = useState(0);
  const [importStatus, setImportStatus] = useState('');
  const [importError, setImportError] = useState('');

  // CSV Import States
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [isCsvUploading, setIsCsvUploading] = useState(false);
  const [csvUploadResult, setCsvUploadResult] = useState('');
  const [csvUploadError, setCsvUploadError] = useState('');

  // Clean Sandbox States
  const [isCleaningSandbox, setIsCleaningSandbox] = useState(false);
  const [cleanSandboxResult, setCleanSandboxResult] = useState('');

  // Form Setup
  const { register, handleSubmit, reset, formState: { errors } } = useForm<MetaSettingsFormData>({
    resolver: zodResolver(metaSettingsSchema),
    defaultValues: {
      verifyToken: 'swaranbhumi_meta_verify_token',
      apiUrl: 'https://graph.facebook.com/v25.0'
    }
  });

  // Queries
  const { data: settingsData, isLoading } = useQuery({
    queryKey: ['systemSettings'],
    queryFn: async () => {
      const response = await axios.get(`${apiBaseUrl}/settings`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return response.data;
    },
    onSuccess: (data: any) => {
      reset({
        verifyToken: data.verifyToken || 'swaranbhumi_meta_verify_token',
        apiUrl: data.apiUrl || 'https://graph.facebook.com/v25.0'
      });
    }
  } as any);

  // Mutations
  const updateSettingsMutation = useMutation({
    mutationFn: async (data: MetaSettingsFormData) => {
      const response = await axios.post(`${apiBaseUrl}/settings`, data, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['systemSettings'] });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  });

  // Import socket connection effect
  useEffect(() => {
    if (!isImporting) return;

    console.log('Establishing socket.io client connection for import updates...');
    const socket = io(apiBaseUrl, {
      transports: ['websocket'],
      upgrade: false
    });

    socket.on('connect', () => {
      console.log('Import listener linked successfully.');
    });

    socket.on('LEAD_IMPORT_PROGRESS', (data: { current: number; total: number; message: string }) => {
      const { current, total } = data;
      setImportProgress(`Imported ${current}/${total}`);
      setImportPercentage(Math.round((current / total) * 100));
    });

    socket.on('LEAD_IMPORT_COMPLETE', (data: { message: string }) => {
      setImportStatus(data.message);
      setIsImporting(false);
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardData'] });
      socket.disconnect();
    });

    socket.on('LEAD_IMPORT_ERROR', (data: { error: string; message?: string }) => {
      if (data.error === 'requires_app_review') {
        setImportError(data.message || 'Historical Lead Import requires Meta App Review approval. Realtime lead synchronization is already active.');
      } else {
        setImportError(data.error);
      }
      setIsImporting(false);
      socket.disconnect();
    });

    return () => {
      socket.disconnect();
    };
  }, [isImporting, apiBaseUrl, queryClient]);

  const handleSettingsSubmit = (data: MetaSettingsFormData) => {
    updateSettingsMutation.mutate(data);
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileName.trim()) {
      alert('Name field cannot be left blank.');
      return;
    }

    try {
      setIsProfileUpdating(true);
      setProfileSuccessMsg('');

      const response = await axios.put(`${apiBaseUrl}/auth/update-profile`, {
        name: profileName,
        email: profileEmail
      }, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      // Commit updated details to Zustand auth state
      setAuth(response.data.user, response.data.accessToken, refreshToken || '');
      setProfileSuccessMsg('Profile updated successfully!');
      setTimeout(() => setProfileSuccessMsg(''), 4000);
    } catch (err: any) {
      alert(err.response?.data?.error || err.message || 'Failed to update admin profile.');
    } finally {
      setIsProfileUpdating(false);
    }
  };

  const handleSaveLocalApi = () => {
    setApiBaseUrl(localApiUrl);
    alert('Desktop connection API endpoint modified. Window will reload configuration.');
    window.location.reload();
  };

  const handleStartImport = async () => {
    try {
      setIsImporting(true);
      setImportProgress('');
      setImportPercentage(0);
      setImportStatus('');
      setImportError('');
      
      await axios.post(`${apiBaseUrl}/meta/import`, {}, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    } catch (err: any) {
      setIsImporting(false);
      setImportError(err.response?.data?.error || err.message || 'Connection failed.');
    }
  };

  const handleCsvChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setCsvFile(e.target.files[0]);
      setCsvUploadResult('');
      setCsvUploadError('');
    }
  };

  const handleCsvUpload = async () => {
    if (!csvFile) {
      alert('Please select a CSV file first.');
      return;
    }

    try {
      setIsCsvUploading(true);
      setCsvUploadResult('');
      setCsvUploadError('');

      const formData = new FormData();
      formData.append('file', csvFile);

      const response = await axios.post(`${apiBaseUrl}/meta/import-csv`, formData, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'multipart/form-data'
        }
      });

      setCsvUploadResult(response.data.message);
      setCsvFile(null);
      
      // Reset input element value
      const fileInput = document.getElementById('csv-file-input') as HTMLInputElement;
      if (fileInput) fileInput.value = '';

      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardData'] });
    } catch (err: any) {
      setCsvUploadError(err.response?.data?.error || err.message || 'Failed to upload CSV.');
    } finally {
      setIsCsvUploading(false);
    }
  };

  const handleCleanSandbox = async () => {
    if (!confirm('Are you sure you want to delete all temporary sandbox leads? This action is permanent.')) {
      return;
    }

    try {
      setIsCleaningSandbox(true);
      setCleanSandboxResult('');

      const response = await axios.post(`${apiBaseUrl}/meta/clean-sandbox`, {}, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      setCleanSandboxResult(response.data.message);
      setTimeout(() => setCleanSandboxResult(''), 4000);
      
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardData'] });
    } catch (err: any) {
      alert(err.response?.data?.error || err.message || 'Failed to delete sandbox leads.');
    } finally {
      setIsCleaningSandbox(false);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const { configured, verifyToken } = (settingsData as any) || { 
    configured: {}, 
    verifyToken: '' 
  };

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Overview */}
      <div className="bg-white p-6 border border-gray-150 rounded-2xl shadow-sm">
        <h3 className="font-bold text-gray-800 text-sm uppercase tracking-wider flex items-center gap-1.5">
          <Settings2 className="w-4 h-4 text-brand-500" />
          Meta Integrations & Settings
        </h3>
        <p className="text-xs text-gray-500 mt-1">Configure Webhook verification tokens, Meta Graph endpoints, and encrypt Facebook Page tokens.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Settings Form */}
        <div className="md:col-span-2 space-y-6">
          {/* Admin Profile Settings */}
          <form onSubmit={handleProfileSubmit} className="bg-white border border-gray-150 rounded-2xl shadow-sm p-6 space-y-6 font-sans">
            <div>
              <h4 className="font-bold text-xs uppercase tracking-wider text-gray-800 mb-2 flex items-center gap-1.5">
                <Settings2 className="w-4.5 h-4.5 text-brand-500" />
                Admin Profile Settings
              </h4>
              <p className="text-[10px] text-gray-400">Rename your administrative account name or update your registered email address.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="crm-label font-semibold text-xs text-gray-700">
                  Full Name
                </label>
                <input 
                  type="text" 
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className="crm-input mt-1 text-xs" 
                  placeholder="Enter administrator full name"
                />
              </div>

              <div>
                <label className="crm-label font-semibold text-xs text-gray-700">
                  Email Address
                </label>
                <input 
                  type="email" 
                  value={profileEmail}
                  onChange={(e) => setProfileEmail(e.target.value)}
                  className="crm-input mt-1 text-xs font-mono" 
                  placeholder="admin@example.com"
                />
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 pt-4">
              {profileSuccessMsg ? (
                <div className="flex items-center gap-1.5 text-green-600 text-xs font-semibold">
                  <CheckCircle2 className="w-4 h-4" />
                  {profileSuccessMsg}
                </div>
              ) : <div />}

              <button 
                type="submit" 
                disabled={isProfileUpdating}
                className="crm-button-primary flex items-center gap-1.5 px-5 text-xs font-semibold"
              >
                <Save className="w-4 h-4" />
                Update Profile Details
              </button>
            </div>
          </form>

          {/* Meta API Settings Form */}
          <form onSubmit={handleSubmit(handleSettingsSubmit)} className="bg-white border border-gray-150 rounded-2xl shadow-sm p-6 space-y-6 font-sans">
            <div>
              <h4 className="font-bold text-xs uppercase tracking-wider text-gray-800 mb-2 flex items-center gap-1.5">
                <Lock className="w-4.5 h-4.5 text-brand-500" />
                Meta API Connection Credentials
              </h4>
              <p className="text-[10px] text-gray-400">Credentials will be encrypted automatically. Leave fields empty if not modifying.</p>
            </div>

            <div className="space-y-4">
              {/* API base Endpoint URL */}
              <div>
                <label className="crm-label font-semibold text-xs text-gray-700 flex items-center gap-1">
                  Meta Graph API Endpoint
                </label>
                <input 
                  type="text" 
                  {...register('apiUrl')}
                  className="crm-input mt-1 font-mono text-xs" 
                  placeholder="https://graph.facebook.com/v25.0"
                />
                {errors.apiUrl && <p className="text-red-500 text-[10px] mt-1 font-semibold">{errors.apiUrl.message}</p>}
              </div>

              {/* Verify Handshake token */}
              <div>
                <label className="crm-label font-semibold text-xs text-gray-700">
                  Webhook Verification Token (Verify Token)
                </label>
                <input 
                  type="text" 
                  {...register('verifyToken')}
                  className="crm-input mt-1 text-xs" 
                  placeholder="swaranbhumi_meta_verify_token"
                />
                {errors.verifyToken && <p className="text-red-500 text-[10px] mt-1 font-semibold">{errors.verifyToken.message}</p>}
              </div>

              {/* Encrypted credentials inputs */}
              <div className="border-t border-gray-100 pt-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="crm-label font-semibold text-xs text-gray-700">
                      Facebook App ID
                    </label>
                    <input 
                      type="text" 
                      {...register('appId')}
                      className="crm-input mt-1 text-xs" 
                      placeholder={configured.appId ? "••••••••••••••••" : "Enter new App ID"}
                    />
                  </div>
                  <div>
                    <label className="crm-label font-semibold text-xs text-gray-700">
                      Facebook App Secret
                    </label>
                    <input 
                      type="password" 
                      {...register('appSecret')}
                      className="crm-input mt-1 text-xs" 
                      placeholder={configured.appSecret ? "••••••••••••••••" : "Enter new App Secret"}
                    />
                  </div>
                </div>

                <div>
                  <label className="crm-label font-semibold text-xs text-gray-700 flex items-center gap-1">
                    Meta Page Access Token
                  </label>
                  <textarea 
                    {...register('pageAccessToken')}
                    rows={3}
                    className="crm-input mt-1 text-xs font-mono" 
                    placeholder={configured.pageAccessToken ? "••••••••••••••••••••••••••••••••••••••••••••••••" : "Paste Page Access Token"}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 pt-4">
              {saveSuccess ? (
                <div className="flex items-center gap-1.5 text-green-600 text-xs font-semibold">
                  <CheckCircle2 className="w-4 h-4" />
                  Credentials updated securely
                </div>
              ) : <div />}

              <button 
                type="submit" 
                disabled={updateSettingsMutation.isPending}
                className="crm-button-primary flex items-center gap-1.5 px-5 text-xs font-semibold"
              >
                <Save className="w-4 h-4" />
                Encrypt & Save Settings
              </button>
            </div>
          </form>

          {/* Local client host config */}
          <div className="bg-white border border-gray-150 rounded-2xl shadow-sm p-6 space-y-4">
            <h4 className="font-bold text-xs uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1">
              <Server className="w-4 h-4 text-brand-500" />
              Desktop App Connections
            </h4>
            
            <div className="flex gap-2">
              <input 
                type="text" 
                value={localApiUrl}
                onChange={(e) => setLocalApiUrl(e.target.value)}
                className="crm-input font-mono text-xs" 
              />
              <button 
                onClick={handleSaveLocalApi}
                className="crm-button-primary shrink-0 text-xs font-semibold"
              >
                Apply Endpoint
              </button>
            </div>
            <p className="text-[10px] text-gray-400 font-sans">
              Override this setting only if the core Fastify API service has been deployed on an external staging server or custom port.
            </p>
          </div>
        </div>

        {/* Security / Webhooks Help Column */}
        <div className="space-y-6">
          {/* Encryption status card */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-950 text-white rounded-2xl p-6 shadow-md border border-slate-800 space-y-4 font-sans">
            <h4 className="font-bold text-xs uppercase tracking-widest text-brand-400 flex items-center gap-1">
              <Lock className="w-4 h-4" />
              Security Architecture
            </h4>
            <div className="space-y-3 text-xs text-slate-300">
              <div className="flex items-center justify-between">
                <span>App ID Encrypted</span>
                <span className={configured.appId ? 'text-green-400 font-bold' : 'text-red-400'}>
                  {configured.appId ? 'YES' : 'NO'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Secret Key Encrypted</span>
                <span className={configured.appSecret ? 'text-green-400 font-bold' : 'text-red-400'}>
                  {configured.appSecret ? 'YES' : 'NO'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Page Token Encrypted</span>
                <span className={configured.pageAccessToken ? 'text-green-400 font-bold' : 'text-red-400'}>
                  {configured.pageAccessToken ? 'YES' : 'NO'}
                </span>
              </div>
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed pt-2 border-t border-slate-800">
              All credentials are encrypted using AES-256-GCM authenticated encryption before being stored in the database. The secret key is derived from the server-side environment parameters.
            </p>
          </div>

          {/* Webhook verification help */}
          <div className="bg-white border border-gray-150 rounded-2xl shadow-sm p-6 space-y-3 text-xs text-gray-500 font-sans">
            <h4 className="font-bold text-xs uppercase tracking-wider text-gray-800 flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-brand-500" />
              Webhook Verification
            </h4>
            <p>To receive Facebook Lead Gen events, configure the Meta webhook inside the Meta Developer Portal with:</p>
            <div className="p-3 bg-gray-50 border border-gray-100 rounded-lg space-y-1 font-mono text-[10px] text-gray-700">
              <p><span className="font-bold">Callback URL:</span> https://&lt;your-domain&gt;/meta/webhook</p>
              <p><span className="font-bold">Verify Token:</span> {verifyToken || 'swaranbhumi_meta_verify_token'}</p>
            </div>
            <div className="flex items-start gap-1 text-[10px] text-gray-400 leading-relaxed pt-1">
              <Info className="w-3.5 h-3.5 shrink-0 text-brand-500 mt-0.5" />
              <p>For local testing, use a tunnel provider (e.g. localtunnel) to map your local port 5000 to a public HTTPS domain.</p>
            </div>
          </div>

          {/* Historical leads import */}
          <div className="bg-white border border-gray-150 rounded-2xl shadow-sm p-6 space-y-4 font-sans">
            <h4 className="font-bold text-xs uppercase tracking-wider text-gray-800 flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-brand-500" />
              Historical Lead Import
            </h4>
            
            <div className="space-y-3 pt-2">
              <button
                onClick={handleStartImport}
                disabled={isImporting}
                className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-white shadow-sm flex items-center justify-center gap-2 transition-all ${
                  isImporting 
                    ? 'bg-slate-400 cursor-not-allowed' 
                    : 'bg-brand-500 hover:bg-brand-600 shadow-brand-500/10'
                }`}
              >
                Import via API
              </button>

              {/* Progress feedback */}
              {isImporting && importProgress && (
                <div className="space-y-2 pt-1">
                  <div className="flex justify-between text-[10px] text-gray-500 font-medium">
                    <span>Importing leads...</span>
                    <span className="font-bold">{importProgress}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="bg-brand-500 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${importPercentage}%` }}
                    />
                  </div>
                </div>
              )}

              {importStatus && (
                <div className="p-3 bg-green-50 border border-green-100 rounded-xl text-[10px] text-green-700 font-medium flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  <p>{importStatus}</p>
                </div>
              )}

              {importError && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-[10px] text-red-700 font-medium flex items-center gap-1.5">
                  <Lock className="w-4 h-4 text-red-500 shrink-0" />
                  <p>{importError}</p>
                </div>
              )}
            </div>

            {/* CSV Backup Uploader */}
            <div className="border-t border-gray-100 pt-4 space-y-2">
              <h5 className="font-bold text-[10px] uppercase tracking-wide text-gray-700 flex items-center gap-1">
                <Upload className="w-3.5 h-3.5 text-brand-500" />
                Upload Facebook leads CSV
              </h5>
              <p className="text-[10px] text-gray-400">If your token is expired or has permission errors, download the leads as a CSV from Meta Business Suite and upload it below.</p>
              
              <div className="space-y-2 pt-1">
                <input 
                  type="file"
                  id="csv-file-input"
                  accept=".csv"
                  onChange={handleCsvChange}
                  className="w-full text-[10px] text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-[10px] file:font-semibold file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                />
                
                <button
                  onClick={handleCsvUpload}
                  disabled={isCsvUploading || !csvFile}
                  className={`w-full py-2 px-3 rounded-xl text-[10px] font-semibold text-white shadow-sm flex items-center justify-center gap-1.5 transition-all ${
                    isCsvUploading || !csvFile
                      ? 'bg-slate-300 cursor-not-allowed'
                      : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/10'
                  }`}
                >
                  {isCsvUploading ? 'Uploading CSV...' : 'Upload & Import CSV'}
                </button>
              </div>

              {csvUploadResult && (
                <div className="p-2.5 bg-green-50 border border-green-100 rounded-xl text-[10px] text-green-700 font-medium flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                  <p>{csvUploadResult}</p>
                </div>
              )}

              {csvUploadError && (
                <div className="p-2.5 bg-red-50 border border-red-100 rounded-xl text-[10px] text-red-700 font-medium flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  <p>{csvUploadError}</p>
                </div>
              )}
            </div>

            {/* Sandbox Leads Cleaner */}
            <div className="border-t border-gray-100 pt-4 space-y-2">
              <h5 className="font-bold text-[10px] uppercase tracking-wide text-gray-700 flex items-center gap-1">
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
                Demo sandbox lead cleanup
              </h5>
              
              <button
                onClick={handleCleanSandbox}
                disabled={isCleaningSandbox}
                className="w-full py-2 px-3 rounded-xl text-[10px] font-semibold bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 flex items-center justify-center gap-1.5 transition-all"
              >
                Delete Sandbox Demo Leads
              </button>

              {cleanSandboxResult && (
                <div className="p-2.5 bg-green-50 border border-green-100 rounded-xl text-[10px] text-green-700 font-medium flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                  <p>{cleanSandboxResult}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
