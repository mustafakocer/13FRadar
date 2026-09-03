export function AuthProvider({ children }) { return children; }
export const useAuth = () => ({ isPro: true, user: null, configured: true, plan: 'pro' });
