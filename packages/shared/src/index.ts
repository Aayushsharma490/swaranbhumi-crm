export type Role = 'ADMIN' | 'MANAGER' | 'EXECUTIVE';

export type UserStatus = 'ACTIVE' | 'INACTIVE';

export type LeadStatus = 
  | 'NEW' 
  | 'CONTACTED' 
  | 'INTERESTED' 
  | 'SITE_VISIT' 
  | 'NEGOTIATION' 
  | 'BOOKED' 
  | 'LOST' 
  | 'DUPLICATE';

export type LeadPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED';

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
}

export interface LeadDTO {
  id: string;
  name: string;
  phone: string;
  alternatePhone?: string;
  email?: string;
  city?: string;
  state?: string;
  budget?: string;
  project?: string;
  propertyType?: string;
  leadSource: string;
  priority: LeadPriority;
  status: LeadStatus;
  followUpDate?: string;
  assignedEmployeeId?: string;
  createdAt: string;
  updatedAt: string;
}

export const PROJECT_OPTIONS = [
  'Swaranbhumi Highlands',
  'Swaranbhumi Residency',
  'Swaranbhumi Smart Villas',
  'Swaranbhumi Heights'
];

export const BUDGET_OPTIONS = [
  'Under 30L',
  '30L - 50L',
  '50L - 75L',
  '75L - 1Cr',
  '1Cr - 1.5Cr',
  '1.5Cr - 2Cr',
  'Above 2Cr'
];
