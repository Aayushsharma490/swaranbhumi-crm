import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { 
  Plus, 
  X, 
  Wallet, 
  ClipboardCheck, 
  Banknote,
  Percent,
  CheckCircle,
  AlertCircle
} from 'lucide-react';

const bookingSchema = z.object({
  leadId: z.string().min(1, 'Lead selection is required'),
  propertyDetails: z.string().min(5, 'Property details are required'),
  agreementNumber: z.string().optional(),
  totalAmount: z.number().positive('Total value must be positive'),
  status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED']).optional()
});

const paymentSchema = z.object({
  amount: z.number().positive('Payment amount must be positive'),
  paymentMode: z.string().min(1, 'Payment mode is required'),
  referenceNumber: z.string().optional(),
  status: z.enum(['PENDING', 'PAID', 'FAILED']).optional()
});

type BookingFormData = z.infer<typeof bookingSchema>;
type PaymentFormData = z.infer<typeof paymentSchema>;

export default function Bookings() {
  const { accessToken, apiBaseUrl } = useAuthStore();
  const queryClient = useQueryClient();

  const [isAddBookingOpen, setIsAddBookingOpen] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [isAddPaymentOpen, setIsAddPaymentOpen] = useState(false);

  // Form setups
  const { register: registerBooking, handleSubmit: handleSubmitBooking, reset: resetBooking, formState: { errors: bookingErrors } } = useForm<BookingFormData>({
    resolver: zodResolver(bookingSchema),
    defaultValues: { status: 'PENDING' }
  });

  const { register: registerPayment, handleSubmit: handleSubmitPayment, reset: resetPayment, formState: { errors: paymentErrors } } = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { paymentMode: 'BANK_TRANSFER', status: 'PAID' }
  });

  // Queries
  const { data: bookingsData, isLoading: isBookingsLoading } = useQuery({
    queryKey: ['bookingsList'],
    queryFn: async () => {
      const response = await axios.get(`${apiBaseUrl}/customers/bookings`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return response.data;
    }
  });

  const { data: leadsData } = useQuery({
    queryKey: ['leadsForBooking'],
    queryFn: async () => {
      const response = await axios.get(`${apiBaseUrl}/leads`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      // Filter out duplicate, booked, or lost leads for new booking selection
      return response.data.leads.filter((l: any) => l.status !== 'BOOKED' && l.status !== 'DUPLICATE' && l.status !== 'LOST');
    }
  });

  const { data: selectedBookingDetails, isLoading: isDetailsLoading } = useQuery({
    queryKey: ['bookingDetails', selectedBookingId],
    queryFn: async () => {
      if (!selectedBookingId) return null;
      const response = await axios.get(`${apiBaseUrl}/customers/bookings/${selectedBookingId}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return response.data.booking;
    },
    enabled: !!selectedBookingId
  });

  // Mutations
  const createBookingMutation = useMutation({
    mutationFn: async (data: BookingFormData) => {
      await axios.post(`${apiBaseUrl}/customers/bookings`, data, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookingsList'] });
      queryClient.invalidateQueries({ queryKey: ['leadsForBooking'] });
      setIsAddBookingOpen(false);
      resetBooking();
    }
  });

  const createPaymentMutation = useMutation({
    mutationFn: async (data: PaymentFormData) => {
      await axios.post(`${apiBaseUrl}/customers/bookings/${selectedBookingId}/payments`, data, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookingsList'] });
      queryClient.invalidateQueries({ queryKey: ['bookingDetails', selectedBookingId] });
      setIsAddPaymentOpen(false);
      resetPayment();
    }
  });

  const updatePaymentStatusMutation = useMutation({
    mutationFn: async ({ paymentId, status }: { paymentId: string; status: string }) => {
      await axios.put(`${apiBaseUrl}/customers/bookings/payments/${paymentId}`, { status }, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookingsList'] });
      queryClient.invalidateQueries({ queryKey: ['bookingDetails', selectedBookingId] });
    }
  });

  const handleBookingSubmit = (data: BookingFormData) => {
    createBookingMutation.mutate(data);
  };

  const handlePaymentSubmit = (data: PaymentFormData) => {
    createPaymentMutation.mutate(data);
  };

  return (
    <div className="h-full flex gap-6 overflow-hidden relative">
      {/* Bookings table list */}
      <div className="flex-1 flex flex-col min-w-0 bg-white border border-gray-150 rounded-2xl shadow-sm overflow-hidden">
        
        {/* Header bar */}
        <div className="p-5 border-b border-gray-150 flex justify-between items-center bg-gray-50/50">
          <div>
            <h3 className="font-bold text-gray-800 text-sm uppercase tracking-wider">Bookings & Ledgers</h3>
            <p className="text-[10px] text-gray-400 font-medium">Log property allocation files, check agreement papers, and compile accounts receipts.</p>
          </div>
          <button 
            onClick={() => setIsAddBookingOpen(true)}
            className="crm-button-primary flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Book Property Unit
          </button>
        </div>

        {/* List data */}
        <div className="flex-1 overflow-auto">
          {isBookingsLoading ? (
            <div className="h-64 w-full flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : !bookingsData?.bookings || bookingsData.bookings.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-gray-400">
              <AlertCircle className="w-10 h-10 mb-2 stroke-1" />
              <p className="text-sm">No unit bookings found.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-gray-50 border-b border-gray-150 text-xs font-semibold text-gray-500 uppercase tracking-wider sticky top-0 z-10">
                <tr>
                  <th className="py-3 px-4">Client Name</th>
                  <th className="py-3 px-4">Project</th>
                  <th className="py-3 px-4">Allocated Unit</th>
                  <th className="py-3 px-4">Agreement Code</th>
                  <th className="py-3 px-4">Unit Pricing</th>
                  <th className="py-3 px-4">Paid Installments</th>
                  <th className="py-3 px-4">Ledger Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bookingsData.bookings.map((booking: any) => {
                  const isSelected = selectedBookingId === booking.id;
                  
                  // Calculate total paid payments
                  const totalPaid = booking.payments
                    ?.filter((p: any) => p.status === 'PAID')
                    .reduce((sum: number, p: any) => sum + p.amount, 0) || 0;

                  return (
                    <tr 
                      key={booking.id}
                      onClick={() => setSelectedBookingId(booking.id)}
                      className={`hover:bg-brand-50/20 cursor-pointer transition ${isSelected ? 'bg-brand-100/30' : ''}`}
                    >
                      <td className="py-3 px-4 font-bold text-gray-800">{booking.lead?.name}</td>
                      <td className="py-3 px-4 text-gray-500 font-medium">{booking.lead?.project || 'N/A'}</td>
                      <td className="py-3 px-4 text-gray-600 font-medium truncate max-w-[140px]">{booking.propertyDetails}</td>
                      <td className="py-3 px-4 text-gray-600 font-mono text-xs">{booking.agreementNumber || 'PENDING'}</td>
                      <td className="py-3 px-4 font-semibold text-slate-700">INR {booking.totalAmount.toLocaleString('en-IN')}</td>
                      <td className="py-3 px-4 text-emerald-600 font-bold">
                        INR {totalPaid.toLocaleString('en-IN')}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          booking.status === 'CONFIRMED' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                        }`}>
                          {booking.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Booking Details / Payment Ledger Sidebar Panel */}
      {selectedBookingId && (
        <div className="w-96 bg-white border border-gray-150 rounded-2xl shadow-lg flex flex-col overflow-hidden animate-fade-in z-20">
          <div className="p-4 border-b border-gray-150 bg-gray-50 flex items-center justify-between">
            <h3 className="font-bold text-gray-800 text-sm tracking-wide">Client Ledger Details</h3>
            <button 
              onClick={() => setSelectedBookingId(null)}
              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {isDetailsLoading ? (
            <div className="p-8 flex items-center justify-center flex-1">
              <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : !selectedBookingDetails ? (
            <div className="p-6 text-gray-400 text-center">Booking ledger file not found</div>
          ) : (
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              
              {/* Profile Card */}
              <div>
                <h4 className="font-bold text-sm text-gray-800">{selectedBookingDetails.lead?.name}</h4>
                <p className="text-xs text-gray-500 mt-0.5">{selectedBookingDetails.lead?.phone}</p>
                <div className="mt-3 p-3 bg-gray-50 border border-gray-100 rounded-lg space-y-1.5 text-xs text-gray-700 font-sans">
                  <p><span className="font-semibold text-gray-500">Unit:</span> {selectedBookingDetails.propertyDetails}</p>
                  <p><span className="font-semibold text-gray-500">Agreement No:</span> {selectedBookingDetails.agreementNumber || 'PENDING'}</p>
                  <p><span className="font-semibold text-gray-500">Total Price:</span> INR {selectedBookingDetails.totalAmount.toLocaleString('en-IN')}</p>
                </div>
              </div>

              {/* Installment logging */}
              <div className="pt-4 border-t border-gray-100">
                <div className="flex justify-between items-center mb-3">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1">
                    <Wallet className="w-3.5 h-3.5 text-gray-400" />
                    Ledger install logs
                  </label>
                  <button 
                    onClick={() => setIsAddPaymentOpen(true)}
                    className="text-xs text-brand-500 hover:text-brand-600 font-bold flex items-center gap-0.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> Log Installment
                  </button>
                </div>

                {/* Ledger ledger data list */}
                <div className="space-y-3">
                  {selectedBookingDetails.payments?.map((pay: any) => (
                    <div key={pay.id} className="p-3 bg-gray-50 border border-gray-100 rounded-xl space-y-2 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-gray-800">INR {pay.amount.toLocaleString('en-IN')}</span>
                        <select 
                          value={pay.status}
                          onChange={(e) => updatePaymentStatusMutation.mutate({ paymentId: pay.id, status: e.target.value })}
                          className={`px-2 py-0.5 text-[10px] font-bold rounded-full focus:outline-none ${
                            pay.status === 'PAID' ? 'bg-green-100 text-green-700' :
                            pay.status === 'FAILED' ? 'bg-red-100 text-red-700' :
                            'bg-amber-100 text-amber-700'
                          }`}
                        >
                          <option value="PENDING">PENDING</option>
                          <option value="PAID">PAID</option>
                          <option value="FAILED">FAILED</option>
                        </select>
                      </div>

                      <div className="flex justify-between items-center text-[9px] text-gray-400 font-mono">
                        <span>Ref: {pay.referenceNumber || 'N/A'} | {pay.paymentMode}</span>
                        <span>{new Date(pay.paymentDate).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add Booking Modal */}
      {isAddBookingOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-md shadow-xl overflow-hidden animate-fade-in">
            <div className="p-5 border-b border-gray-150 bg-gray-50 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 text-sm tracking-wide">Register Unit Allocation</h3>
              <button 
                onClick={() => setIsAddBookingOpen(false)}
                className="p-1 hover:bg-gray-200 text-gray-400 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitBooking(handleBookingSubmit)} className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Select Qualified Client Lead</label>
                <select {...registerBooking('leadId')} className="crm-select">
                  <option value="">Choose Lead...</option>
                  {leadsData?.map((lead: any) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.name} ({lead.project || 'No project'} | {lead.phone})
                    </option>
                  ))}
                </select>
                {bookingErrors.leadId && <p className="text-[10px] text-red-500 mt-0.5">{bookingErrors.leadId.message}</p>}
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Property details (Plot, Unit, RowHouse No.)</label>
                <input type="text" {...registerBooking('propertyDetails')} placeholder="e.g. Highlands Plot No. B-12" className="crm-input" />
                {bookingErrors.propertyDetails && <p className="text-[10px] text-red-500 mt-0.5">{bookingErrors.propertyDetails.message}</p>}
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Sales Agreement Code</label>
                <input type="text" {...registerBooking('agreementNumber')} placeholder="e.g. SB-2026-H-0012" className="crm-input" />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Total Unit Selling Cost (INR)</label>
                <input 
                  type="number" 
                  step="any"
                  {...registerBooking('totalAmount', { valueAsNumber: true })} 
                  placeholder="e.g. 7500000" 
                  className="crm-input" 
                />
                {bookingErrors.totalAmount && <p className="text-[10px] text-red-500 mt-0.5">{bookingErrors.totalAmount.message}</p>}
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Booking Allocation Status</label>
                <select {...registerBooking('status')} className="crm-select">
                  <option value="PENDING">PENDING</option>
                  <option value="CONFIRMED">CONFIRMED</option>
                </select>
              </div>

              <div className="pt-4 border-t border-gray-150 flex justify-end gap-3">
                <button 
                  type="button" 
                  onClick={() => setIsAddBookingOpen(false)}
                  className="crm-button-secondary"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="crm-button-primary"
                >
                  Save Booking file
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Log Payment Installment Modal */}
      {isAddPaymentOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-md shadow-xl overflow-hidden animate-fade-in">
            <div className="p-5 border-b border-gray-150 bg-gray-50 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 text-sm tracking-wide">Record Payment installment</h3>
              <button 
                onClick={() => setIsAddPaymentOpen(false)}
                className="p-1 hover:bg-gray-200 text-gray-400 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitPayment(handlePaymentSubmit)} className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Installment Amount (INR)</label>
                <input 
                  type="number" 
                  step="any"
                  {...registerPayment('amount', { valueAsNumber: true })} 
                  className="crm-input" 
                />
                {paymentErrors.amount && <p className="text-[10px] text-red-500 mt-0.5">{paymentErrors.amount.message}</p>}
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Payment Mode</label>
                <select {...registerPayment('paymentMode')} className="crm-select">
                  <option value="BANK_TRANSFER">Bank Wire / RTGS / NEFT</option>
                  <option value="ONLINE">UPI / Cards</option>
                  <option value="CHEQUE">Bank Check</option>
                  <option value="CASH">Cash</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Transaction Ref code / Check number</label>
                <input type="text" {...registerPayment('referenceNumber')} className="crm-input" />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 block mb-1">Installment Status</label>
                <select {...registerPayment('status')} className="crm-select">
                  <option value="PAID">PAID</option>
                  <option value="PENDING">PENDING</option>
                </select>
              </div>

              <div className="pt-4 border-t border-gray-150 flex justify-end gap-3">
                <button 
                  type="button" 
                  onClick={() => setIsAddPaymentOpen(false)}
                  className="crm-button-secondary"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="crm-button-primary"
                >
                  Log Installment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
