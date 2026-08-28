import React, { useState, useEffect } from 'react';
import { useAuthStore } from './store/useAuthStore';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import Employees from './pages/Employees';
import Bookings from './pages/Bookings';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import WhatsappMarketing from './pages/WhatsappMarketing';
import { ShieldAlert } from 'lucide-react';

declare global {
  interface Window {
    electronAPI?: {
      sendNotification: (payload: { title: string; body: string }) => Promise<{ success: boolean; error?: string }>;
      getEnvConfig: () => Promise<{ isPackaged: boolean; version: string }>;
      onUpdateAvailable: (cb: () => void) => void;
      onUpdateDownloaded: (cb: () => void) => void;
      restartAppForUpdate: () => void;
    };
  }
}

export default function App() {
  const { accessToken, user, apiBaseUrl, setAuth, logout } = useAuthStore();
  const [activePage, setActivePage] = useState('dashboard');
  const [socketConnected, setSocketConnected] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Updater State
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);

  // Sync state tracking
  const [syncStatus, setSyncStatus] = useState<'IDLE' | 'SYNCING' | 'ERROR'>('IDLE');
  const [lastSyncTimeStr, setLastSyncTimeStr] = useState<string>('Never');
  const [lastSyncLeadName, setLastSyncLeadName] = useState<string>('None');
  const [lastSyncNewLeads, setLastSyncNewLeads] = useState<number>(0);

  // Meta connection and permission status states
  const [metaStatus, setMetaStatus] = useState<'GREEN' | 'YELLOW' | 'RED'>('RED');
  const [metaStatusMessage, setMetaStatusMessage] = useState('Checking Meta integration status...');

  // Login Form States
  const [emailInput, setEmailInput] = useState('admin@swaranbhumi.com');
  const [passwordInput, setPasswordInput] = useState('admin123');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [hasCheckedAutoLogin, setHasCheckedAutoLogin] = useState(false);

  const fetchSyncStats = async () => {
    if (!accessToken) return;
    try {
      const response = await axios.get(`${apiBaseUrl}/settings`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (response.data) {
        if (response.data.lastSyncAt) {
          const date = new Date(response.data.lastSyncAt);
          setLastSyncTimeStr(
            date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + 
            date.toLocaleDateString([], { month: 'short', day: 'numeric' })
          );
        }
        setLastSyncLeadName(response.data.lastSyncLeadName || 'None');
        setLastSyncNewLeads(response.data.lastSyncCount || 0);
      }
    } catch (err) {
      console.warn('Failed to load initial sync stats:', err);
    }
  };

  const triggerSync = async () => {
    if (!accessToken || syncStatus === 'SYNCING') return;
    try {
      setSyncStatus('SYNCING');
      await axios.post(`${apiBaseUrl}/meta/sync`, {}, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    } catch (err) {
      setSyncStatus('ERROR');
      console.error('Trigger sync failed:', err);
    }
  };

  // Helper to play synthesized beep sound
  const playAlertSound = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch (err) {
      console.warn('Audio feedback failed:', err);
    }
  };

  // 1. Silent Auto-Login using saved credentials or initial check
  useEffect(() => {
    if (accessToken || hasCheckedAutoLogin) return;

    const saved = localStorage.getItem('SB_CRM_LOGIN_CREDENTIALS');
    if (!saved) {
      // First time/No credentials: show the Login Page
      setHasCheckedAutoLogin(true);
      return;
    }

    const performAutoLogin = async () => {
      try {
        setAuthError(null);
        const { email, password } = JSON.parse(saved);
        console.log(`Attempting background auto-login for: ${email}`);
        
        const response = await axios.post(`${apiBaseUrl}/auth/login`, { email, password });
        const { user: userData, accessToken: access, refreshToken: refresh } = response.data;
        
        setAuth(userData, access, refresh);
        console.log('Background auth sync success. Logged in as:', userData.name);
      } catch (err: any) {
        const msg = err.response?.data?.error || err.message || 'Connection lost';
        console.error('Background auto-login failed:', msg);
        if (err.response?.status === 401) {
          localStorage.removeItem('SB_CRM_LOGIN_CREDENTIALS');
        }
      } finally {
        setHasCheckedAutoLogin(true);
      }
    };

    performAutoLogin();
  }, [accessToken, apiBaseUrl, setAuth, hasCheckedAutoLogin]);

  // Updater Event Listeners
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onUpdateAvailable(() => {
        setUpdateAvailable(true);
      });
      window.electronAPI.onUpdateDownloaded(() => {
        setUpdateAvailable(false);
        setUpdateDownloaded(true);
      });
    }
  }, []);

  // 2. Lead Sync startup trigger and recurring loop (5 min interval)
  useEffect(() => {
    if (!accessToken) return;
    
    // Initial fetch of synchronization configuration/timestamps
    fetchSyncStats();

    // Auto sync on startup
    triggerSync();

    // Setup periodic sync (every 5 min)
    const interval = setInterval(() => {
      console.log('Automated background lead sync triggered (5 min interval)...');
      triggerSync();
    }, 300000);

    return () => clearInterval(interval);
  }, [accessToken]);

  // Startup hook to load Meta Token connection health state
  useEffect(() => {
    if (!accessToken) return;
    const fetchStatus = async () => {
      try {
        const response = await axios.get(`${apiBaseUrl}/meta/status`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        setMetaStatus(response.data.status);
        setMetaStatusMessage(response.data.message);
      } catch (err) {
        console.warn('Failed to load initial Meta status:', err);
      }
    };
    fetchStatus();
  }, [accessToken, apiBaseUrl]);

  // 3. Real-time Socket.IO synchronization
  useEffect(() => {
    if (!accessToken) return;

    console.log(`Connecting Socket.IO client to server: ${apiBaseUrl}`);
    const socket: Socket = io(apiBaseUrl, {
      transports: ['websocket'],
      upgrade: false
    });

    socket.on('connect', () => {
      console.log('Socket.IO connection established.');
      setSocketConnected(true);
      
      // Join targeted user room for personal alerts
      if (user?.id) {
        socket.emit('join_user_channel', user.id);
      }
    });

    socket.on('disconnect', () => {
      console.warn('Socket.IO connection lost.');
      setSocketConnected(false);
    });

    // Real-time synchronization events
    socket.on('LEAD_CREATED', (newLead: any) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardData'] });

      const shouldAlert = user && (
        user.role !== 'EXECUTIVE' || 
        newLead.assignedEmployeeId === user.id
      );

      if (shouldAlert) {
        playAlertSound();
        if (window.electronAPI) {
          window.electronAPI.sendNotification({
            title: 'New Lead Auto-Assigned',
            body: `Lead "${newLead.name}" has been registered. Project: ${newLead.project || 'N/A'}`
          });
        }
      }
    });

    socket.on('LEAD_UPDATED', () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardData'] });
      queryClient.invalidateQueries({ queryKey: ['leadDetails'] });
    });

    socket.on('meta:status_change', (data: { status: 'GREEN' | 'YELLOW' | 'RED'; message: string }) => {
      setMetaStatus(data.status);
      setMetaStatusMessage(data.message);
    });

    socket.on('lead:new', () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardData'] });
    });

    socket.on('lead:update', () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardData'] });
      queryClient.invalidateQueries({ queryKey: ['leadDetails'] });
    });

    socket.on('dashboard:update', () => {
      queryClient.invalidateQueries({ queryKey: ['dashboardData'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    });

    socket.on('LEAD_DELETED', () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardData'] });
      queryClient.invalidateQueries({ queryKey: ['leadDetails'] });
    });

    socket.on('BOOKING_CREATED', () => {
      queryClient.invalidateQueries({ queryKey: ['bookingsList'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardData'] });
    });

    socket.on('BOOKING_UPDATED', () => {
      queryClient.invalidateQueries({ queryKey: ['bookingsList'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardData'] });
    });

    socket.on('PAYMENT_CREATED', () => {
      queryClient.invalidateQueries({ queryKey: ['bookingsList'] });
      queryClient.invalidateQueries({ queryKey: ['bookingDetails'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardData'] });
    });

    socket.on('PAYMENT_UPDATED', () => {
      queryClient.invalidateQueries({ queryKey: ['bookingsList'] });
      queryClient.invalidateQueries({ queryKey: ['bookingDetails'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardData'] });
    });

    socket.on('LEAD_SYNC_STATUS', (data: { status: 'SYNCING' | 'IDLE' }) => {
      setSyncStatus(data.status);
    });

    socket.on('LEAD_SYNC_COMPLETE', (data: { count: number; lastSyncAt: string; lastSyncLeadName: string; message: string }) => {
      setSyncStatus('IDLE');
      setLastSyncNewLeads(data.count);
      setLastSyncLeadName(data.lastSyncLeadName || 'None');
      if (data.lastSyncAt) {
        const date = new Date(data.lastSyncAt);
        setLastSyncTimeStr(
          date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + 
          date.toLocaleDateString([], { month: 'short', day: 'numeric' })
        );
      }

      // Invalidate layouts to refresh lists
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardData'] });

      if (window.electronAPI) {
        window.electronAPI.sendNotification({
          title: 'Facebook Leads Synced',
          body: data.message
        });
      }
    });

    socket.on('LEAD_SYNC_ERROR', (data: { error: string }) => {
      setSyncStatus('ERROR');
      if (window.electronAPI) {
        window.electronAPI.sendNotification({
          title: 'Facebook Sync Issue',
          body: data.error
        });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [accessToken, apiBaseUrl, queryClient, user]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput || !passwordInput) {
      setLoginError('Please enter both email and password.');
      return;
    }

    try {
      setIsLoggingIn(true);
      setLoginError(null);
      
      const response = await axios.post(`${apiBaseUrl}/auth/login`, {
        email: emailInput,
        password: passwordInput
      });

      const { user: userData, accessToken: access, refreshToken: refresh } = response.data;
      
      // Save credentials for subsequent silent auto-logins
      localStorage.setItem('SB_CRM_LOGIN_CREDENTIALS', JSON.stringify({
        email: emailInput,
        password: passwordInput
      }));

      setAuth(userData, access, refresh);
      console.log('Manual login success. Saved credentials.');
    } catch (err: any) {
      setLoginError(err.response?.data?.error || err.message || 'Login failed. Please check backend connection.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Render authenticating screen if no token session is active yet
  if (!accessToken) {
    if (!hasCheckedAutoLogin) {
      return (
        <div className="h-screen w-screen bg-slate-950 flex flex-col items-center justify-center text-white relative font-sans">
          <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-slate-400 mt-4">Connecting to Swaranbhumi CRM...</p>
        </div>
      );
    }

    return (
      <div className="h-screen w-screen bg-slate-950 flex flex-col items-center justify-center text-white relative overflow-hidden font-sans">
        {/* Decorative Gradients */}
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-brand-500/10 blur-[100px] pointer-events-none" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-indigo-500/10 blur-[100px] pointer-events-none" />

        <div className="w-full max-w-md p-8 bg-slate-900 border border-slate-800 rounded-3xl shadow-xl space-y-6 relative z-10 mx-4">
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-brand-500 flex items-center justify-center font-bold text-3xl text-white mx-auto shadow-lg shadow-brand-500/20">
              S
            </div>
            <h2 className="text-xl font-bold tracking-tight">Swaranbhumi CRM</h2>
            <p className="text-xs text-slate-400">Enterprise Real Estate Management Desk</p>
          </div>

          <form onSubmit={handleLoginSubmit} className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Email Address</label>
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 focus:border-brand-500 rounded-xl px-4 py-3 text-xs text-slate-200 outline-none transition-all"
                placeholder="Enter email address"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Password</label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 focus:border-brand-500 rounded-xl px-4 py-3 text-xs text-slate-200 outline-none transition-all"
                placeholder="Enter account password"
                required
              />
            </div>

            {loginError && (
              <div className="p-3 bg-red-950/20 border border-red-900/30 rounded-xl text-[10px] text-red-400 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <p>{loginError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-3 bg-brand-500 hover:bg-brand-600 rounded-xl text-xs font-bold text-white shadow-lg shadow-brand-500/10 flex items-center justify-center gap-2 transition-all active:scale-[0.99] disabled:bg-slate-800 disabled:text-slate-500"
            >
              {isLoggingIn ? 'Verifying Account...' : 'Sign In'}
            </button>
          </form>

          <p className="text-[10px] text-center text-slate-500">
            For initial testing, Admin credentials are pre-filled.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Layout 
      activePage={activePage} 
      setActivePage={setActivePage} 
      socketConnected={socketConnected}
      syncStatus={syncStatus}
      lastSyncTimeStr={lastSyncTimeStr}
      lastSyncLeadName={lastSyncLeadName}
      lastSyncNewLeads={lastSyncNewLeads}
      onSyncTrigger={triggerSync}
      metaStatus={metaStatus}
      metaStatusMessage={metaStatusMessage}
    >
      {activePage === 'dashboard' && <Dashboard />}
      {activePage === 'leads' && <Leads />}
      {activePage === 'employees' && <Employees />}
      {activePage === 'bookings' && <Bookings />}
      {activePage === 'reports' && <Reports />}
      {activePage === 'whatsapp' && <WhatsappMarketing />}
      {activePage === 'settings' && <Settings />}

      {/* Auto Updater Modal */}
      {updateDownloaded && (
        <div className="fixed inset-0 z-[100] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-gray-200 rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden text-center p-8 animate-fade-in">
            <div className="w-16 h-16 bg-brand-100 text-brand-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">Update Ready!</h3>
            <p className="text-xs text-gray-500 mb-6">A new version of Swaranbhumi CRM has been downloaded and is ready to install.</p>
            <button 
              onClick={() => window.electronAPI?.restartAppForUpdate()}
              className="w-full py-3 bg-brand-600 hover:bg-brand-700 rounded-xl text-xs font-bold text-white shadow-lg transition-all active:scale-[0.98]"
            >
              Restart & Install Update
            </button>
          </div>
        </div>
      )}
      
      {updateAvailable && !updateDownloaded && (
        <div className="fixed bottom-4 right-4 z-50 bg-slate-900 text-white text-[10px] font-semibold px-4 py-2 rounded-full shadow-lg flex items-center gap-2 animate-fade-in border border-slate-700">
          <div className="w-2.5 h-2.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          Downloading new update in background...
        </div>
      )}
    </Layout>
  );
}
