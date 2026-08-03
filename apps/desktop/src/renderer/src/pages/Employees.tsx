import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { 
  Plus, 
  Trash2, 
  UserX, 
  ShieldCheck, 
  X, 
  User, 
  Mail,
  Award,
  AlertCircle
} from 'lucide-react';

const employeeSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['ADMIN', 'MANAGER', 'EXECUTIVE']),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional()
});

type EmployeeFormData = z.infer<typeof employeeSchema>;

export default function Employees() {
  const { accessToken, apiBaseUrl, user: currentUser } = useAuthStore();
  const queryClient = useQueryClient();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Form setup
  const { register, handleSubmit, reset, formState: { errors } } = useForm<EmployeeFormData>({
    resolver: zodResolver(employeeSchema),
    defaultValues: {
      role: 'EXECUTIVE',
      status: 'ACTIVE'
    }
  });

  // Queries
  const { data: employeesData, isLoading: isEmployeesLoading } = useQuery({
    queryKey: ['employeesList'],
    queryFn: async () => {
      const response = await axios.get(`${apiBaseUrl}/employees`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return response.data;
    }
  });

  const { data: performanceData } = useQuery({
    queryKey: ['performanceList'],
    queryFn: async () => {
      const response = await axios.get(`${apiBaseUrl}/employees/performance`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return response.data;
    }
  });

  // Mutations
  const createEmployeeMutation = useMutation({
    mutationFn: async (data: EmployeeFormData) => {
      await axios.post(`${apiBaseUrl}/employees`, data, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employeesList'] });
      queryClient.invalidateQueries({ queryKey: ['performanceList'] });
      setIsAddModalOpen(false);
      reset();
    }
  });

  const deactivateEmployeeMutation = useMutation({
    mutationFn: async (id: string) => {
      await axios.delete(`${apiBaseUrl}/employees/${id}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employeesList'] });
      queryClient.invalidateQueries({ queryKey: ['performanceList'] });
    }
  });

  const handleCreateEmployee = (data: EmployeeFormData) => {
    createEmployeeMutation.mutate(data);
  };

  return (
    <div className="space-y-8">
      {/* Overview stats cards for active staff counts */}
      <div className="flex justify-between items-center bg-white p-6 border border-gray-150 rounded-2xl shadow-sm">
        <div>
          <h3 className="font-bold text-gray-800 text-sm uppercase tracking-wider">Staff Management Desk</h3>
          <p className="text-xs text-gray-500 mt-1">Configure internal access rules, assign permissions, and trace lead conversion rates.</p>
        </div>
        {currentUser?.role === 'ADMIN' && (
          <button 
            onClick={() => setIsAddModalOpen(true)}
            className="crm-button-primary flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Add Staff Profile
          </button>
        )}
      </div>

      {/* Grid Layout: Left Column = Staff List. Right Column = Conversion performance */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        
        {/* Staff Table */}
        <div className="xl:col-span-2 bg-white border border-gray-150 rounded-2xl shadow-sm overflow-hidden flex flex-col">
          <div className="p-4 border-b border-gray-150 bg-gray-50/50">
            <h4 className="font-bold text-xs uppercase tracking-wider text-gray-500">Active Staff Profiles</h4>
          </div>

          <div className="overflow-x-auto">
            {isEmployeesLoading ? (
              <div className="h-48 w-full flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            ) : !employeesData?.employees || employeesData.employees.length === 0 ? (
              <div className="p-12 text-center text-gray-400 text-xs">No employees found.</div>
            ) : (
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-gray-50 border-b border-gray-150 text-xs text-gray-500 font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="p-4">Name</th>
                    <th className="p-4">Email</th>
                    <th className="p-4">Authorization</th>
                    <th className="p-4">Status</th>
                    {currentUser?.role === 'ADMIN' && <th className="p-4 text-center">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {employeesData.employees.map((emp: any) => (
                    <tr key={emp.id} className="hover:bg-gray-50/30">
                      <td className="p-4 font-bold text-gray-800 flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-brand-50 border border-brand-100 flex items-center justify-center font-bold text-xs text-brand-600">
                          {emp.name.charAt(0)}
                        </div>
                        {emp.name}
                      </td>
                      <td className="p-4 text-gray-500 font-mono text-xs">{emp.email}</td>
                      <td className="p-4 font-semibold text-xs text-slate-700">
                        <span className="px-2 py-0.5 bg-slate-100 rounded flex items-center gap-1 w-fit">
                          <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                          {emp.role}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          emp.status === 'ACTIVE' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                        }`}>
                          {emp.status}
                        </span>
                      </td>
                      {currentUser?.role === 'ADMIN' && (
                        <td className="p-4 text-center">
                          {emp.id !== currentUser.id && emp.status === 'ACTIVE' && (
                            <button
                              onClick={() => {
                                if (confirm(`Are you sure you want to deactivate ${emp.name}'s workspace access?`)) {
                                  deactivateEmployeeMutation.mutate(emp.id);
                                }
                              }}
                              title="Deactivate Account"
                              className="p-1 text-red-600 hover:bg-red-50 rounded transition"
                            >
                              <UserX className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Conversion Performance leaderboard panel */}
        <div className="bg-white border border-gray-150 rounded-2xl shadow-sm p-6 flex flex-col">
          <h4 className="font-bold text-xs uppercase tracking-wider text-gray-500 mb-4 flex items-center gap-1">
            <Award className="w-4 h-4 text-brand-500" />
            Conversion Leaderboard
          </h4>

          <div className="space-y-4 flex-1 overflow-y-auto pr-1">
            {!performanceData?.performance || performanceData.performance.length === 0 ? (
              <div className="text-center text-gray-400 text-xs py-12">No conversion stats.</div>
            ) : (
              performanceData.performance.map((item: any) => (
                <div key={item.id} className="p-4 bg-gray-50 border border-gray-100 rounded-xl space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-xs text-gray-800">{item.name}</span>
                    <span className="text-[10px] bg-brand-500 text-white font-bold px-2 py-0.5 rounded">
                      {item.conversionRate}% Conv
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                    <div className="bg-white border border-gray-100 rounded p-1">
                      <span className="text-gray-400 block uppercase font-semibold">Assigned</span>
                      <span className="font-bold text-gray-700">{item.totalAssigned}</span>
                    </div>
                    <div className="bg-white border border-gray-100 rounded p-1">
                      <span className="text-emerald-400 block uppercase font-semibold">Sales</span>
                      <span className="font-bold text-emerald-600">{item.convertedCount}</span>
                    </div>
                    <div className="bg-white border border-gray-100 rounded p-1">
                      <span className="text-red-400 block uppercase font-semibold">Lost</span>
                      <span className="font-bold text-red-600">{item.lostCount}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Add Staff Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-md shadow-xl overflow-hidden animate-fade-in">
            <div className="p-5 border-b border-gray-150 bg-gray-50 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 text-sm tracking-wide">Register Staff Profile</h3>
              <button 
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 hover:bg-gray-200 text-gray-400 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit(handleCreateEmployee)} className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <input type="text" {...register('name')} className="crm-input pl-9" />
                </div>
                {errors.name && <p className="text-[10px] text-red-500 mt-0.5">{errors.name.message}</p>}
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Corporate Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <input type="email" {...register('email')} className="crm-input pl-9" />
                </div>
                {errors.email && <p className="text-[10px] text-red-500 mt-0.5">{errors.email.message}</p>}
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Secure Password</label>
                <input type="password" {...register('password')} className="crm-input" />
                {errors.password && <p className="text-[10px] text-red-500 mt-0.5">{errors.password.message}</p>}
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Role / Authorization Level</label>
                <select {...register('role')} className="crm-select">
                  <option value="EXECUTIVE">Sales Executive (Standard Limits)</option>
                  <option value="MANAGER">Manager (Read all leads, reports)</option>
                  <option value="ADMIN">System Administrator (Full access)</option>
                </select>
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
                  Save Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
