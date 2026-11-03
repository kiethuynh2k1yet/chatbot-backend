export type EmployeeIdentity = {
  userId: number;
  employeeId: number;
  employeeCode: string;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  position: string | null;
};

export type AuthenticatedEmployee = EmployeeIdentity;

export type AccessTokenPayload = {
  employeeId: number;
  employeeCode: string;
  tokenVersion: number;
};

export type LoginRow = {
  user_id: number;
  employee_id: number;
  employee_code: string;
  username: string;
  password_hash: string;
  failed_login_count: number;
  locked_until: Date | null;
  token_version: number;
  full_name: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  position: string | null;
};
