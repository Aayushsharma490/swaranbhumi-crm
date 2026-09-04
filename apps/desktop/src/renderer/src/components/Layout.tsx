import React from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { 
  LayoutDashboard, 
  Users, 
  UserCheck, 
  TrendingUp, 
  Settings, 
  LogOut, 
  Shield, 
  Radio, 
  FolderLock,
  MessageCircle
} from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  activePage: string;
  setActivePage: (page: string) => void;
  socketConnected: boolean;
  syncStatus: 'IDLE' | 'SYNCING' | 'ERROR';
  lastSyncTimeStr: string;
  lastSyncLeadName: string;
  lastSyncNewLeads: number;
  onSyncTrigger: () => void;
  metaStatus?: 'GREEN' | 'YELLOW' | 'RED';
  metaStatusMessage?: string;
}

export default function Layout({ 
  children, 
  activePage, 
  setActivePage, 
  socketConnected,
  syncStatus,
  lastSyncTimeStr,
  lastSyncLeadName,
  lastSyncNewLeads,
  onSyncTrigger,
  metaStatus = 'RED',
  metaStatusMessage = 'Meta integration details'
}: LayoutProps) {
  const { user, logout } = useAuthStore();

  const menuItems = [
    { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard, roles: ['ADMIN', 'MANAGER', 'EXECUTIVE'] },
    { id: 'leads', name: 'Leads Board', icon: Users, roles: ['ADMIN', 'MANAGER', 'EXECUTIVE'] },
    { id: 'employees', name: 'Employees', icon: UserCheck, roles: ['ADMIN', 'MANAGER'] },
    { id: 'bookings', name: 'Bookings & Customers', icon: FolderLock, roles: ['ADMIN', 'MANAGER', 'EXECUTIVE'] },
    { id: 'reports', name: 'Reports & Exports', icon: TrendingUp, roles: ['ADMIN', 'MANAGER', 'EXECUTIVE'] },
    { id: 'whatsapp', name: 'WhatsApp Marketing', icon: MessageCircle, roles: ['ADMIN', 'MANAGER'] },
    { id: 'whatsapp_chat', name: 'WhatsApp Chat', icon: MessageCircle, roles: ['ADMIN', 'MANAGER', 'EXECUTIVE'] },
    { id: 'settings', name: 'Meta & System Settings', icon: Settings, roles: ['ADMIN'] },
  ];

  return (
    <div className="h-screen w-screen flex bg-brand-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col justify-between border-r border-slate-800">
        <div>
          {/* Logo */}
          <div className="p-6 border-b border-slate-800 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center font-bold text-lg text-white font-sans shadow-md">
              S
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-wide text-gray-100 font-sans">Swaranbhumi</h1>
              <p className="text-[10px] text-brand-300 font-medium tracking-widest uppercase">Enterprise CRM</p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="p-4 space-y-1">
            {menuItems.map((item) => {
              if (user && !item.roles.includes(user.role)) return null;
              const Icon = item.icon;
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActivePage(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-150 ${
                    isActive 
                      ? 'bg-brand-500 text-white shadow-md shadow-brand-500/10' 
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  {item.name}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Facebook Sync Status Bar */}
        <div className="mx-4 p-4 bg-slate-950/60 border border-slate-800 rounded-xl space-y-3 font-sans text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Facebook Sync</span>
            <div className="flex items-center gap-1.5 font-semibold">
              {syncStatus === 'SYNCING' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-yellow-400 animate-ping inline-block"></span>
                  <span className="text-yellow-400 text-[10px]">Syncing...</span>
                </>
              ) : syncStatus === 'ERROR' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-red-500 inline-block"></span>
                  <span className="text-red-400 text-[10px]">Sync Failed</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
                  <span className="text-green-400 text-[10px]">Connected</span>
                </>
              )}
            </div>
          </div>

          <div className="space-y-1.5 text-[11px] text-slate-300 border-t border-slate-800/60 pt-2.5">
            <div className="flex justify-between">
              <span className="text-slate-500">Last Sync:</span>
              <span className="font-medium text-slate-200">{lastSyncTimeStr}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">New Leads:</span>
              <span className="font-bold text-brand-400">{lastSyncNewLeads}</span>
            </div>
            <div className="flex justify-between min-w-0">
              <span className="text-slate-500 shrink-0 mr-2">Last Lead:</span>
              <span className="font-medium text-slate-200 truncate" title={lastSyncLeadName}>{lastSyncLeadName}</span>
            </div>
          </div>

          <button
            onClick={onSyncTrigger}
            disabled={syncStatus === 'SYNCING'}
            className={`w-full py-1.5 px-3 rounded-lg text-[10px] font-bold tracking-wide flex items-center justify-center gap-1.5 transition-all text-white ${
              syncStatus === 'SYNCING'
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : 'bg-brand-600 hover:bg-brand-500 active:scale-[0.98]'
            }`}
          >
            <Radio className={`w-3.5 h-3.5 ${syncStatus === 'SYNCING' ? 'animate-spin' : ''}`} />
            Sync Facebook Leads
          </button>
        </div>

        {/* Sidebar Footer User Details */}
        <div className="p-4 border-t border-slate-800 space-y-3 bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
              <Shield className="w-4 h-4 text-brand-300" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-200 truncate">{user?.name}</p>
              <p className="text-xs text-slate-400 font-mono tracking-wider flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-400 inline-block"></span>
                {user?.role}
              </p>
            </div>
          </div>

          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-slate-800 hover:bg-red-950/20 hover:text-red-400 border border-slate-700 hover:border-red-900/30 rounded-lg text-xs font-semibold text-slate-300 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header Bar */}
        <header className="h-16 bg-white border-b border-gray-150 flex items-center justify-between px-8 shadow-sm z-10">
          <h2 className="text-lg font-bold text-gray-800 capitalize font-sans">
            {menuItems.find(m => m.id === activePage)?.name || activePage}
          </h2>

          {/* Telemetry and WebSockets Status */}
          <div className="flex items-center gap-4 text-xs font-medium">
            {/* Meta Integration Status Badge */}
            <div 
              className={`flex items-center gap-2 px-3 py-1.5 border border-gray-150 rounded-full font-sans cursor-help`}
              title={metaStatusMessage}
            >
              <span className={`w-2 h-2 rounded-full inline-block ${
                metaStatus === 'GREEN' 
                  ? 'bg-green-500 animate-pulse' 
                  : metaStatus === 'YELLOW' 
                    ? 'bg-yellow-400' 
                    : 'bg-red-500'
              }`} />
              <span className="text-gray-500">Meta Webhook:</span>
              <span className={`font-semibold ${
                metaStatus === 'GREEN' 
                  ? 'text-green-600' 
                  : metaStatus === 'YELLOW' 
                    ? 'text-yellow-500' 
                    : 'text-red-500'
              }`}>
                {metaStatus === 'GREEN' 
                  ? 'Connected' 
                  : metaStatus === 'YELLOW' 
                    ? 'Waiting Permission' 
                    : 'Token Invalid'}
              </span>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-100 rounded-full text-gray-600">
              <Radio className={`w-3.5 h-3.5 ${socketConnected ? 'text-green-500 animate-pulse' : 'text-red-400'}`} />
              <span>Real-time Link:</span>
              <span className={socketConnected ? 'text-green-600 font-semibold' : 'text-red-500 font-semibold'}>
                {socketConnected ? 'Active' : 'Offline'}
              </span>
            </div>
          </div>
        </header>

        {/* Content body */}
        <main className="flex-1 overflow-y-auto p-8 animate-fade-in">
          {children}
        </main>
      </div>
    </div>
  );
}
