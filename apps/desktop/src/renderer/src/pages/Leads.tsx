import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { 
  Plus, 
  Search, 
  Merge, 
  X, 
  Tag, 
  Paperclip, 
  MessageSquareCode, 
  Calendar,
  AlertCircle,
  PhoneMissed,
  PhoneOff,
  Check
} from 'lucide-react';

const leadSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  phone: z.string().min(10, 'Valid phone number required'),
  alternatePhone: z.string().optional(),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  city: z.string().optional(),
  state: z.string().optional(),
  budget: z.string().optional(),
  project: z.string().optional(),
  propertyType: z.string().optional(),
  leadSource: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  status: z.enum(['NEW', 'CONTACTED', 'INTERESTED', 'SITE_VISIT', 'NEGOTIATION', 'BOOKED', 'LOST', 'DUPLICATE']).optional(),
  followUpDate: z.string().optional(),
  assignedEmployeeId: z.string().optional()
});

type LeadFormData = z.infer<typeof leadSchema>;

export default function Leads() {
  const { accessToken, apiBaseUrl, user: currentUser } = useAuthStore();
  const queryClient = useQueryClient();

  // Component UI State
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [ageFilter, setAgeFilter] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedLeadsForMerge, setSelectedLeadsForMerge] = useState<string[]>([]);
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [noteContent, setNoteContent] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // Form setup
  const { register, handleSubmit, reset, formState: { errors } } = useForm<LeadFormData>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      leadSource: 'DIRECT',
      priority: 'MEDIUM',
      status: 'NEW'
    }
  });

  // Queries
  const { data: leadsData, isLoading: isLeadsLoading } = useQuery({
    queryKey: ['leads', search, statusFilter, priorityFilter, ageFilter, campaignFilter],
    queryFn: async () => {
      const response = await axios.get(`${apiBaseUrl}/leads`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { search, status: statusFilter, priority: priorityFilter, age: ageFilter, campaign: campaignFilter }
      });
      return response.data;
    }
  });

  const { data: employeesData } = useQuery({
    queryKey: ['employees'],
    queryFn: async () => {
      const response = await axios.get(`${apiBaseUrl}/employees`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return response.data;
    },
    enabled: currentUser?.role !== 'EXECUTIVE'
  });

  const { data: selectedLeadDetails, isLoading: isDetailsLoading } = useQuery({
    queryKey: ['leadDetails', selectedLeadId],
    queryFn: async () => {
      if (!selectedLeadId) return null;
      const response = await axios.get(`${apiBaseUrl}/leads/${selectedLeadId}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return response.data.lead;
    },
    enabled: !!selectedLeadId
  });

  // Mutations
  const createLeadMutation = useMutation({
    mutationFn: async (data: LeadFormData) => {
      await axios.post(`${apiBaseUrl}/leads`, data, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setIsAddModalOpen(false);
      reset();
    }
  });

  const updateLeadMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      await axios.put(`${apiBaseUrl}/leads/${id}`, data, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['leadDetails', selectedLeadId] });
    }
  });

  const deleteLeadMutation = useMutation({
    mutationFn: async (id: string) => {
      await axios.delete(`${apiBaseUrl}/leads/${id}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setSelectedLeadId(null);
    }
  });

  const mergeLeadsMutation = useMutation({
    mutationFn: async (payload: { primaryLeadId: string; duplicateLeadId: string }) => {
      await axios.post(`${apiBaseUrl}/leads/merge`, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setIsMergeModalOpen(false);
      setSelectedLeadsForMerge([]);
    }
  });

  const addNoteMutation = useMutation({
    mutationFn: async (content: string) => {
      await axios.post(`${apiBaseUrl}/leads/${selectedLeadId}/notes`, { content }, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leadDetails', selectedLeadId] });
      setNoteContent('');
    }
  });

  const quickActionMutation = useMutation({
    mutationFn: async ({ leadId, action }: { leadId: string; action: 'MISSED' | 'NOT_ANSWERED' | 'INTERESTED' }) => {
      let status = 'CONTACTED';
      let note = '';
      if (action === 'MISSED') note = 'Quick Action: Call missed by customer.';
      if (action === 'NOT_ANSWERED') note = 'Quick Action: Called but not answered.';
      if (action === 'INTERESTED') {
        status = 'INTERESTED';
        note = 'Quick Action: Customer showed interest.';
      }
      
      // Update Status
      await axios.put(`${apiBaseUrl}/leads/${leadId}`, { status }, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      // Add Note
      await axios.post(`${apiBaseUrl}/leads/${leadId}/notes`, { content: note }, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    }
  });

  const uploadAttachmentMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      await axios.post(`${apiBaseUrl}/leads/${selectedLeadId}/attachments`, formData, {
        headers: { 
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'multipart/form-data'
        }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leadDetails', selectedLeadId] });
      setUploadFile(null);
    }
  });

  // Handlers
  const handleCreateLead = (data: LeadFormData) => {
    createLeadMutation.mutate(data);
  };

  const handleMergeSubmit = () => {
    if (selectedLeadsForMerge.length !== 2) return;
    mergeLeadsMutation.mutate({
      primaryLeadId: selectedLeadsForMerge[0],
      duplicateLeadId: selectedLeadsForMerge[1]
    });
  };

  const handleLeadCheckbox = (id: string) => {
    setSelectedLeadsForMerge(prev => {
      if (prev.includes(id)) {
        return prev.filter(item => item !== id);
      }
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  return (
    <div className="h-full flex gap-6 overflow-hidden relative">
      {/* Main Table view */}
      <div className="flex-1 flex flex-col min-w-0 bg-white border border-gray-150 rounded-2xl shadow-sm overflow-hidden">
        
        {/* Filter bar */}
        <div className="p-5 border-b border-gray-150 flex flex-col md:flex-row gap-4 items-center justify-between bg-gray-50/50">
          
          {/* Searching */}
          <div className="relative w-full md:w-72">
            <Search className="absolute left-3.5 top-2.5 w-4 h-4 text-gray-400" />
            <input 
              type="text" 
              placeholder="Search leads by name or phone..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-gray-100 hover:bg-gray-200 focus:bg-white border-transparent focus:border-brand-500 focus:ring-4 focus:ring-brand-500/20 text-gray-800 text-sm font-medium rounded-full py-2 pl-10 pr-4 transition-all outline-none placeholder:font-normal placeholder:text-gray-500 shadow-sm"
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto overflow-hidden">
            <input 
              type="text"
              placeholder="Filter Campaign"
              value={campaignFilter}
              onChange={(e) => setCampaignFilter(e.target.value)}
              className="crm-input !w-[140px] text-xs"
            />
            <select 
              value={statusFilter} 
              onChange={(e) => setStatusFilter(e.target.value)}
              className="crm-select !w-[130px] text-xs"
            >
              <option value="">All Statuses</option>
              <option value="NEW">New</option>
              <option value="CONTACTED">Contacted</option>
              <option value="INTERESTED">Interested</option>
              <option value="SITE_VISIT">Site Visit</option>
              <option value="NEGOTIATION">Negotiation</option>
              <option value="BOOKED">Booked</option>
              <option value="LOST">Lost</option>
              <option value="DUPLICATE">Duplicate</option>
            </select>

            <select 
              value={priorityFilter} 
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="crm-select !w-[120px] text-xs"
            >
              <option value="">All Priorities</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>

            <select 
              value={ageFilter} 
              onChange={(e) => setAgeFilter(e.target.value)}
              className="crm-select !w-[110px] text-xs"
            >
              <option value="">All Time</option>
              <option value="1">Today</option>
              <option value="3">Last 3 Days</option>
              <option value="7">Last 7 Days</option>
              <option value="30">Last 30 Days</option>
            </select>

            {/* Merge duplicates trigger */}
            {selectedLeadsForMerge.length === 2 && (
              <button 
                onClick={() => setIsMergeModalOpen(true)}
                className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg flex items-center gap-1.5 text-xs font-semibold shadow-sm transition"
              >
                <Merge className="w-3.5 h-3.5" />
                Merge ({selectedLeadsForMerge.length})
              </button>
            )}

            <button 
              onClick={() => setIsAddModalOpen(true)}
              className="crm-button-primary flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              New Lead
            </button>
          </div>
        </div>

        {/* Table Body */}
        <div className="flex-1 overflow-auto">
          {isLeadsLoading ? (
            <div className="h-64 w-full flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : !leadsData?.leads || leadsData.leads.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-gray-400">
              <AlertCircle className="w-10 h-10 mb-2 stroke-1" />
              <p className="text-sm">No lead profiles match criteria.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-slate-800 border-b border-slate-900 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="py-3 px-3 text-left text-[11px] font-bold text-white uppercase tracking-wider">Lead Info</th>
                  <th className="py-3 px-3 text-left text-[11px] font-bold text-white uppercase tracking-wider">Contact</th>
                  <th className="py-3 px-3 text-left text-[11px] font-bold text-white uppercase tracking-wider">Message/District</th>
                  <th className="py-3 px-3 text-left text-[11px] font-bold text-white uppercase tracking-wider">Campaign/Source</th>
                  <th className="py-3 px-3 text-left text-[11px] font-bold text-white uppercase tracking-wider">Priority</th>
                  <th className="py-3 px-3 text-left text-[11px] font-bold text-white uppercase tracking-wider">Status</th>
                  <th className="py-3 px-3 text-left text-[11px] font-bold text-white uppercase tracking-wider">Assignee</th>
                  <th className="py-3 px-3 text-center text-[11px] font-bold text-white uppercase tracking-wider">Quick Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {leadsData.leads.map((lead: any) => {
                  const isChecked = selectedLeadsForMerge.includes(lead.id);
                  const isSelected = selectedLeadId === lead.id;
                  
                  // Highlight leads created in the last 24 hours
                  const isNew = (new Date().getTime() - new Date(lead.createdAt).getTime()) < 24 * 60 * 60 * 1000;
                  
                  return (
                    <tr 
                      key={lead.id}
                      onClick={() => setSelectedLeadId(lead.id)}
                      className={`hover:bg-brand-50/50 cursor-pointer transition ${isSelected ? 'bg-brand-100/30' : (isNew ? 'bg-amber-50/30' : '')}`}
                    >
                      <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input 
                          type="checkbox" 
                          checked={isChecked}
                          onChange={() => handleLeadCheckbox(lead.id)}
                          className="rounded border-gray-300 text-brand-500 focus:ring-brand-500 w-4 h-4 cursor-pointer"
                        />
                      </td>
                      <td className="py-2.5 px-3 font-bold text-gray-800 text-xs">{lead.name}</td>
                      <td className="py-2.5 px-3 text-gray-500 font-mono text-[11px]">
                        {lead.phone}
                        {lead.email && <div className="text-[9px] text-gray-400 font-sans mt-0.5">{lead.email}</div>}
                      </td>
                      <td className="py-2.5 px-3 text-gray-600 font-medium text-xs max-w-[180px] whitespace-normal break-words" title={lead.city || ''}>
                        <div className="line-clamp-2 leading-snug">{lead.city || 'N/A'}</div>
                      </td>
                      <td className="py-2.5 px-3 text-gray-600 text-xs font-medium">
                        <div className="line-clamp-1 max-w-[150px]">{lead.facebookCampaign ? lead.facebookCampaign.replace('Lead Generation - ', '') : (lead.project || 'N/A')}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide ${
                          lead.priority === 'HIGH' ? 'bg-red-50 text-red-600' :
                          lead.priority === 'MEDIUM' ? 'bg-amber-50 text-amber-600' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {lead.priority}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          lead.status === 'NEW' ? 'bg-brand-100 text-brand-700' :
                          lead.status === 'BOOKED' ? 'bg-green-100 text-green-700' :
                          lead.status === 'LOST' ? 'bg-red-100 text-red-700' :
                          lead.status === 'DUPLICATE' ? 'bg-purple-100 text-purple-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {lead.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-gray-600 font-medium text-[11px]">
                        <div className="line-clamp-1 max-w-[100px]">{lead.assignedEmployee?.name || 'Unassigned'}</div>
                      </td>
                      <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <button 
                            onClick={() => quickActionMutation.mutate({ leadId: lead.id, action: 'MISSED' })}
                            className="p-1.5 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded transition group relative"
                            title="Call Missed"
                          >
                            <PhoneMissed className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => quickActionMutation.mutate({ leadId: lead.id, action: 'NOT_ANSWERED' })}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition group relative"
                            title="Not Answered"
                          >
                            <PhoneOff className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => quickActionMutation.mutate({ leadId: lead.id, action: 'INTERESTED' })}
                            className="p-1.5 text-gray-400 hover:text-green-500 hover:bg-green-50 rounded transition group relative"
                            title="Mark Interested"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Details Slide-out Drawer */}
      {selectedLeadId && (
        <div className="w-96 bg-white border border-gray-150 rounded-2xl shadow-lg flex flex-col overflow-hidden animate-fade-in z-20">
          {/* Header */}
          <div className="p-4 border-b border-gray-150 bg-gray-50 flex items-center justify-between">
            <h3 className="font-bold text-gray-800 text-sm tracking-wide">Lead File Details</h3>
            <button 
              onClick={() => setSelectedLeadId(null)}
              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {isDetailsLoading ? (
            <div className="p-8 flex items-center justify-center flex-1">
              <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : !selectedLeadDetails ? (
            <div className="p-6 text-gray-400 text-center">Lead not found</div>
          ) : (
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Quick Summary Card */}
              <div>
                <h4 className="font-extrabold text-base text-gray-900">{selectedLeadDetails.name}</h4>
                <p className="text-xs text-gray-400 font-mono mt-0.5">Phone: {selectedLeadDetails.phone}</p>
                {selectedLeadDetails.email && <p className="text-xs text-gray-500 mt-0.5">Email: {selectedLeadDetails.email}</p>}
                
                {/* Meta Integration Data Callout */}
                {selectedLeadDetails.leadSource === 'FACEBOOK' && (
                  <div className="mt-3 p-3 bg-blue-50 border border-blue-100 rounded-lg text-[10px] text-blue-700">
                    <p className="font-bold uppercase tracking-wider flex items-center gap-1 mb-1">
                      <Tag className="w-3 h-3" />
                      Meta Lead Adgen Sync
                    </p>
                    <p>Form: {selectedLeadDetails.facebookFormName}</p>
                    <p>ID: {selectedLeadDetails.facebookLeadId}</p>
                  </div>
                )}
              </div>

              {/* Editable Parameters */}
              <div className="space-y-3 pt-4 border-t border-gray-100">
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Assignee</label>
                  {currentUser?.role !== 'EXECUTIVE' ? (
                    <select
                      value={selectedLeadDetails.assignedEmployeeId || ''}
                      onChange={(e) => updateLeadMutation.mutate({ id: selectedLeadDetails.id, data: { assignedEmployeeId: e.target.value || null } })}
                      className="crm-select"
                    >
                      <option value="">Unassigned</option>
                      {employeesData?.employees
                        ?.filter((emp: any) => emp.status === 'ACTIVE')
                        .map((emp: any) => (
                          <option key={emp.id} value={emp.id}>{emp.name}</option>
                        ))}
                    </select>
                  ) : (
                    <span className="text-xs text-gray-700">{selectedLeadDetails.assignedEmployee?.name || 'Unassigned'}</span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Status</label>
                    <select
                      value={selectedLeadDetails.status}
                      onChange={(e) => updateLeadMutation.mutate({ id: selectedLeadDetails.id, data: { status: e.target.value } })}
                      className="crm-select"
                    >
                      <option value="NEW">New</option>
                      <option value="CONTACTED">Contacted</option>
                      <option value="INTERESTED">Interested</option>
                      <option value="SITE_VISIT">Site Visit</option>
                      <option value="NEGOTIATION">Negotiation</option>
                      <option value="BOOKED">Booked</option>
                      <option value="LOST">Lost</option>
                      <option value="DUPLICATE">Duplicate</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Priority</label>
                    <select
                      value={selectedLeadDetails.priority}
                      onChange={(e) => updateLeadMutation.mutate({ id: selectedLeadDetails.id, data: { priority: e.target.value } })}
                      className="crm-select"
                    >
                      <option value="LOW">Low</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="HIGH">High</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Next Follow-up Date</label>
                  <input
                    type="date"
                    value={selectedLeadDetails.followUpDate ? selectedLeadDetails.followUpDate.split('T')[0] : ''}
                    onChange={(e) => updateLeadMutation.mutate({ id: selectedLeadDetails.id, data: { followUpDate: e.target.value || null } })}
                    className="crm-input"
                  />
                </div>
              </div>

              {/* Notes Drawer Section */}
              <div className="pt-4 border-t border-gray-100">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-2 flex items-center gap-1">
                  <MessageSquareCode className="w-3.5 h-3.5 text-gray-400" />
                  Conversation logs
                </label>
                
                <div className="flex gap-1.5 mb-3">
                  <input 
                    type="text" 
                    placeholder="Enter call outcome..." 
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    className="crm-input"
                  />
                  <button 
                    onClick={() => addNoteMutation.mutate(noteContent)}
                    disabled={!noteContent}
                    className="crm-button-primary"
                  >
                    Add
                  </button>
                </div>
                
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {['Interested', 'Call Back Later', 'Not Reachable', 'Switched Off', 'Not Interested'].map(qn => (
                    <button
                      key={qn}
                      onClick={() => {
                        setNoteContent(qn);
                        addNoteMutation.mutate(qn);
                      }}
                      className="px-2 py-1 text-[9px] font-semibold bg-gray-100 text-gray-600 hover:bg-brand-50 hover:text-brand-600 rounded-full transition"
                    >
                      {qn}
                    </button>
                  ))}
                </div>

                <div className="space-y-2.5 max-h-40 overflow-y-auto">
                  {selectedLeadDetails.notes?.map((note: any) => (
                    <div key={note.id} className="p-2 bg-gray-50 border border-gray-100 rounded-lg text-xs">
                      <p className="text-gray-700">{note.content}</p>
                      <div className="flex justify-between items-center text-[9px] text-gray-400 mt-1 font-mono">
                        <span>By {note.author?.name}</span>
                        <span>{new Date(note.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Attachments Section */}
              <div className="pt-4 border-t border-gray-100">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-2 flex items-center gap-1">
                  <Paperclip className="w-3.5 h-3.5 text-gray-400" />
                  Documents & ID Attachments
                </label>

                <div className="flex flex-col gap-2 mb-3">
                  <input 
                    type="file" 
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    className="text-xs text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-brand-50 file:text-brand-600 hover:file:bg-brand-100 cursor-pointer"
                  />
                  {uploadFile && (
                    <button 
                      onClick={() => uploadAttachmentMutation.mutate(uploadFile)}
                      className="crm-button-primary text-xs py-1"
                    >
                      Upload File
                    </button>
                  )}
                </div>

                <div className="space-y-1.5">
                  {selectedLeadDetails.attachments?.map((file: any) => (
                    <a
                      key={file.id}
                      href={`${apiBaseUrl}${file.filePath}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block p-2 border border-gray-150 rounded-lg text-xs font-semibold text-brand-600 hover:bg-brand-50/30 transition flex items-center gap-1.5 truncate"
                    >
                      <Paperclip className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      {file.filename}
                    </a>
                  ))}
                </div>
              </div>

              {/* Audit Timeline Logs */}
              <div className="pt-4 border-t border-gray-100">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-2 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                  Audit Action Timeline
                </label>
                <div className="space-y-3 pl-1">
                  {selectedLeadDetails.timeline?.map((evt: any) => (
                    <div key={evt.id} className="text-[10px] flex gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1"></div>
                      <div>
                        <p className="text-gray-700 font-medium">{evt.description}</p>
                        <span className="text-[8px] text-gray-400 font-mono">By {evt.createdBy?.name} | {new Date(evt.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Deletion Control (Only Admin/Manager) */}
              {currentUser?.role !== 'EXECUTIVE' && (
                <div className="pt-4 border-t border-gray-150">
                  <button
                    onClick={() => {
                      if (confirm('Are you sure you want to permanently delete this lead?')) {
                        deleteLeadMutation.mutate(selectedLeadId);
                      }
                    }}
                    className="w-full py-2 border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold rounded-lg transition"
                  >
                    Delete Lead File
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* New Lead Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-lg shadow-xl overflow-hidden animate-fade-in">
            <div className="p-5 border-b border-gray-150 bg-gray-50 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 text-sm tracking-wide">Register New Lead Profile</h3>
              <button 
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 hover:bg-gray-200 text-gray-400 hover:text-gray-600 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit(handleCreateLead)} className="p-6 space-y-4 max-h-[500px] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Full Name</label>
                  <input type="text" {...register('name')} className="crm-input" />
                  {errors.name && <p className="text-[10px] text-red-500 mt-0.5">{errors.name.message}</p>}
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Contact Phone</label>
                  <input type="text" {...register('phone')} className="crm-input" />
                  {errors.phone && <p className="text-[10px] text-red-500 mt-0.5">{errors.phone.message}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Alternate Contact</label>
                  <input type="text" {...register('alternatePhone')} className="crm-input" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Email Address</label>
                  <input type="email" {...register('email')} className="crm-input" />
                  {errors.email && <p className="text-[10px] text-red-500 mt-0.5">{errors.email.message}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">City</label>
                  <input type="text" {...register('city')} className="crm-input" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">State</label>
                  <input type="text" {...register('state')} className="crm-input" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Project Interest</label>
                  <input type="text" {...register('project')} placeholder="e.g. Highlands" className="crm-input" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Property Type</label>
                  <input type="text" {...register('propertyType')} placeholder="e.g. Villa" className="crm-input" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Purchase Budget</label>
                  <input type="text" {...register('budget')} placeholder="e.g. 80L" className="crm-input" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Lead Source</label>
                  <select {...register('leadSource')} className="crm-select">
                    <option value="DIRECT">Direct visit</option>
                    <option value="WEBSITE">Website Enq</option>
                    <option value="FACEBOOK">Meta campaigns</option>
                    <option value="REFERRAL">Referrals</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Priority</label>
                  <select {...register('priority')} className="crm-select">
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Initial Status</label>
                  <select {...register('status')} className="crm-select">
                    <option value="NEW">New</option>
                    <option value="CONTACTED">Contacted</option>
                    <option value="INTERESTED">Interested</option>
                    <option value="SITE_VISIT">Site Visit</option>
                    <option value="NEGOTIATION">Negotiation</option>
                  </select>
                </div>
              </div>

              {currentUser?.role !== 'EXECUTIVE' && (
                <div>
                  <label className="text-xs font-semibold text-gray-600 block mb-1">Assign Employee</label>
                  <select {...register('assignedEmployeeId')} className="crm-select">
                    <option value="">Auto-Assign round-robin</option>
                    {employeesData?.employees
                      ?.filter((emp: any) => emp.status === 'ACTIVE')
                      .map((emp: any) => (
                        <option key={emp.id} value={emp.id}>{emp.name}</option>
                      ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Follow-up Date</label>
                <input type="date" {...register('followUpDate')} className="crm-input" />
              </div>

              <div className="pt-4 border-t border-gray-150 flex justify-end gap-3">
                <button 
                  type="button" 
                  onClick={() => setIsAddModalOpen(false)}
                  className="crm-button-secondary"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="crm-button-primary"
                >
                  Save Lead Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Merge Duplicates Confirmation Modal */}
      {isMergeModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-md shadow-xl overflow-hidden animate-fade-in">
            <div className="p-5 border-b border-gray-150 bg-gray-50 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 text-sm tracking-wide flex items-center gap-1">
                <Merge className="w-4 h-4 text-purple-600" />
                Merge Lead Overlaps
              </h3>
              <button 
                onClick={() => setIsMergeModalOpen(false)}
                className="p-1 hover:bg-gray-200 text-gray-400 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-sm">
              <div className="p-3 bg-purple-50 text-purple-700 rounded-lg flex items-start gap-2 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold mb-1">Merge Operation Rules:</p>
                  <p>All comments, discussion details, timeline logs, and attachment paths will be ported to the **Primary Lead** file. The **Duplicate Lead** is marked as `DUPLICATE` status and removed from the active desk pipeline.</p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Select Primary Lead (Keeps settings & credentials)</p>
                  <div className="space-y-2">
                    {leadsData?.leads
                      ?.filter((l: any) => selectedLeadsForMerge.includes(l.id))
                      .map((lead: any, index: number) => (
                        <label key={lead.id} className="p-3 border border-gray-200 rounded-lg flex items-center gap-3 cursor-pointer hover:bg-gray-50 font-sans block">
                          <input 
                            type="radio" 
                            name="primary_lead" 
                            checked={selectedLeadsForMerge[0] === lead.id}
                            onChange={() => {
                              // Swap target items to set index 0 as primary
                              if (index !== 0) {
                                setSelectedLeadsForMerge([selectedLeadsForMerge[1], selectedLeadsForMerge[0]]);
                              }
                            }}
                            className="text-brand-500 focus:ring-brand-500 w-4 h-4"
                          />
                          <div>
                            <span className="font-bold text-gray-800 block text-xs">{lead.name}</span>
                            <span className="text-[10px] text-gray-500 font-mono">{lead.phone} | {lead.project || 'Unspecified'}</span>
                          </div>
                        </label>
                      ))}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-150 flex justify-end gap-3">
                <button 
                  onClick={() => setIsMergeModalOpen(false)}
                  className="crm-button-secondary"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleMergeSubmit}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium text-sm transition"
                >
                  Confirm & Merge
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
