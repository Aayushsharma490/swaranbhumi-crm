import React from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';
import { 
  Users, 
  CheckCircle2, 
  XCircle, 
  CalendarClock, 
  IndianRupee, 
  TrendingUp,
  FileSpreadsheet,
  Megaphone
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell,
  LineChart,
  Line
} from 'recharts';

const COLORS = ['#2b6cb0', '#48bb78', '#ecc94b', '#f56565', '#ed64a6', '#9f7aea'];

export default function Dashboard() {
  const { accessToken, apiBaseUrl } = useAuthStore();

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboardData', accessToken],
    queryFn: async () => {
      const response = await axios.get(`${apiBaseUrl}/reports/dashboard`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return response.data;
    },
    enabled: !!accessToken,
    refetchInterval: 10000 // Refetch every 10s as a secondary sync mechanism
  });

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-semibold text-gray-500">Compiling Swaranbhumi intelligence...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 text-red-700 rounded-lg">
        <h3 className="font-bold">Error loading dashboard</h3>
        <p className="text-sm">Please check if the backend API service is running locally on port 5000.</p>
      </div>
    );
  }

  const { metrics, sources, projects, recentActivities, notifications } = data;

  const statCards = [
    { title: "Today's Leads", value: metrics.todayLeads, color: 'border-brand-500 text-brand-600 bg-brand-50/50', icon: Users },
    { title: 'Monthly Leads', value: metrics.monthLeads, color: 'border-blue-500 text-blue-600 bg-blue-50/50', icon: Megaphone },
    { title: 'Total Leads', value: metrics.totalLeads, color: 'border-purple-500 text-purple-600 bg-purple-50/50', icon: Users },
    { title: 'Converted Leads', value: metrics.convertedLeads, color: 'border-green-500 text-green-600 bg-green-50/50', icon: CheckCircle2 },
    { title: 'Lost Leads', value: metrics.lostLeads, color: 'border-red-500 text-red-600 bg-red-50/50', icon: XCircle },
    { title: 'Follow-ups Due', value: metrics.followUpDue, color: 'border-amber-500 text-amber-600 bg-amber-50/50', icon: CalendarClock },
  ];

  return (
    <div className="space-y-8">
      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        {statCards.map((card, i) => {
          const Icon = card.icon;
          return (
            <div key={i} className={`p-4 bg-white border border-gray-150 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 flex flex-col justify-between ${card.color}`}>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{card.title}</span>
                <Icon className="w-4 h-4 text-gray-400" />
              </div>
              <span className="text-2xl font-bold tracking-tight text-slate-800">{card.value}</span>
            </div>
          );
        })}
      </div>

      {/* Revenue callout card */}
      <div className="p-6 bg-gradient-to-r from-brand-600 to-indigo-700 rounded-2xl text-white shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-brand-200">Reconciled Sales Earnings</span>
          <h3 className="text-3xl font-extrabold tracking-tight mt-1 flex items-center gap-1">
            <IndianRupee className="w-7 h-7" />
            {metrics.revenue.toLocaleString('en-IN')}
          </h3>
          <p className="text-xs text-brand-100 mt-1">Sum of all confirmed customer installments.</p>
        </div>
        <div className="flex gap-2">
          <div className="px-4 py-2 bg-white/10 rounded-lg text-xs font-semibold backdrop-blur-md">
            Target Conversion: 85%
          </div>
          <div className="px-4 py-2 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-semibold backdrop-blur-md">
            Excellent Pace
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Lead Sources Pie Chart */}
        <div className="p-6 bg-white border border-gray-150 rounded-2xl shadow-sm">
          <h3 className="font-bold text-gray-800 mb-6 text-sm uppercase tracking-wider">Leads By Acquisition Channel</h3>
          <div className="h-64 flex flex-col md:flex-row items-center justify-around">
            <div className="w-48 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={sources.length > 0 ? sources : [{ source: 'No Data', count: 1 }]}
                    dataKey="count"
                    nameKey="source"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={3}
                  >
                    {sources.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => [`${value} Leads`]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            
            {/* Custom Legend */}
            <div className="space-y-2 mt-4 md:mt-0">
              {sources.map((item: any, idx: number) => (
                <div key={idx} className="flex items-center gap-2 text-xs">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }}></div>
                  <span className="font-semibold text-gray-700">{item.source}</span>
                  <span className="text-gray-400 font-mono">({item.count})</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Project Wise Demand Bar Chart */}
        <div className="p-6 bg-white border border-gray-150 rounded-2xl shadow-sm">
          <h3 className="font-bold text-gray-800 mb-6 text-sm uppercase tracking-wider">Project-wise Interest Distribution</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={projects}>
                <XAxis dataKey="project" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#2b6cb0" radius={[4, 4, 0, 0]}>
                  {projects.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Lists Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Today's Follow-up list */}
        <div className="p-6 bg-white border border-gray-150 rounded-2xl shadow-sm flex flex-col max-h-[420px]">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-gray-800 text-sm uppercase tracking-wider flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-amber-500" />
              Follow-up Agenda (Today)
            </h3>
            <span className="px-2.5 py-0.5 bg-amber-50 text-amber-700 font-semibold rounded-full text-xs">
              {notifications.length} Scheduled
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-2">
            {notifications.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center py-12 text-gray-400">
                <CalendarClock className="w-8 h-8 mb-2 stroke-1" />
                <p className="text-xs">No follow-ups scheduled for today.</p>
              </div>
            ) : (
              notifications.map((notif: any) => (
                <div key={notif.id} className="p-3 bg-gray-50 hover:bg-gray-100/70 border border-gray-100 rounded-xl transition-all duration-150 flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-xs text-gray-800">{notif.name}</h4>
                    <p className="text-[10px] text-gray-500 mt-0.5">Project: {notif.project || 'Unspecified'} | {notif.phone}</p>
                  </div>
                  <span className="text-[10px] bg-brand-50 text-brand-600 px-2 py-1 rounded font-semibold font-mono">
                    {new Date(notif.followUpDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Live System Activity Feed */}
        <div className="p-6 bg-white border border-gray-150 rounded-2xl shadow-sm flex flex-col max-h-[420px]">
          <h3 className="font-bold text-gray-800 mb-4 text-sm uppercase tracking-wider flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-brand-500" />
            Live Activity Stream
          </h3>

          <div className="flex-1 overflow-y-auto space-y-4 pr-2 font-sans">
            {recentActivities.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center py-12 text-gray-400">
                <Users className="w-8 h-8 mb-2 stroke-1" />
                <p className="text-xs">No activities recorded yet.</p>
              </div>
            ) : (
              recentActivities.map((act: any) => (
                <div key={act.id} className="flex gap-3 text-xs">
                  <div className="flex flex-col items-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-brand-500 border-2 border-white ring-2 ring-brand-100"></div>
                    <div className="w-0.5 flex-1 bg-gray-100 my-1"></div>
                  </div>
                  <div className="flex-1 pb-1">
                    <p className="text-gray-700 font-medium">
                      <span className="font-bold text-gray-900">{act.createdBy?.name}</span> {act.description.toLowerCase()}{' '}
                      <span className="text-brand-600 font-semibold">{act.lead?.name}</span>
                    </p>
                    <span className="text-[9px] text-gray-400 font-mono">
                      {new Date(act.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
