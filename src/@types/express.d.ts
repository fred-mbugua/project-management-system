// ══════════════════════════════════════════════════════════════════════
// Express Request Augmentation - Custom Session & User Types
// ══════════════════════════════════════════════════════════════════════

import { UserRole, Tenant, ProjectScope, UserModulePermissions } from '../models/types';

declare global {
  namespace Express {
    interface User {
      id: string;
      tenantId: string | null;
      email: string;
      firstName: string;
      lastName: string;
      role: UserRole;
      phone: string | null;
      avatarUrl: string | null;
      projectScope?: ProjectScope;
      permissions?: UserModulePermissions;
    }

    interface Request {
      user?: Express.User;
      tenantId?: string;
      tenant?: Tenant | null;
      flash(type: string, message?: string): string[] | undefined;
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    userId: string;
    tenantId: string | null;
    role: UserRole;
    returnTo?: string;
  }
}

declare module 'express-ejs-layouts';

export {};
