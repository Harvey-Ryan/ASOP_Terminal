import 'express-session';

// Extend express-session's SessionData with our application fields.
declare module 'express-session' {
  interface SessionData {
    /** Internal DB user ID (cuid) – set after successful OAuth login */
    userId?: string;
    /** CSRF state token stored during /auth/login, verified in /auth/callback */
    oauthState?: string;
    /** CSRF state token for the FleetYards OAuth flow */
    fyOAuthState?: string;
    /** PKCE code_verifier generated at the start of the FleetYards OAuth flow */
    fyCodeVerifier?: string;
    /** Guild ID to redirect back to after FleetYards OAuth completes */
    fyReturnGuildId?: string;
    /** Cached list of Discord guild IDs the user can manage */
    managedGuildIds?: string[];
    /** Unix ms timestamp of when managedGuildIds was last refreshed */
    managedGuildsCachedAt?: number;
  }
}
